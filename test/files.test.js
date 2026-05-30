import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatPath,
  listDirectoryEntries,
  listProjectFiles,
  readIgnoreDirectories,
  readTextFile,
  resolveInsideCwd,
} from '../src/files.js'

test('resolveInsideCwd rejects path traversal', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'agento-files-'))

  assert.equal(resolveInsideCwd('.', cwd), cwd)
  assert.throws(() => resolveInsideCwd('../outside.txt', cwd), /outside the current project/)
})

test('formatPath returns repo-relative labels', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'agento-files-'))

  assert.equal(formatPath(resolve(cwd, 'src/app.js'), cwd), 'src/app.js')
  assert.equal(formatPath(cwd, cwd), '.')
})

test('readTextFile enforces file type, size, and binary checks', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'agento-files-'))
  await writeFile(resolve(cwd, 'note.txt'), 'hello')
  await writeFile(resolve(cwd, 'large.txt'), 'hello')
  await writeFile(resolve(cwd, 'binary.bin'), Buffer.from([0, 1, 2]))
  await mkdir(resolve(cwd, 'dir'))

  assert.deepEqual(readTextFile('note.txt', { cwd, maxFileBytes: 10 }), {
    path: 'note.txt',
    content: 'hello',
  })
  assert.throws(() => readTextFile('dir', { cwd }), /Not a file/)
  assert.throws(() => readTextFile('large.txt', { cwd, maxFileBytes: 2 }), /File is too large/)
  assert.throws(() => readTextFile('binary.bin', { cwd }), /appears to be binary/)
})

test('readIgnoreDirectories includes defaults and .agentoignore entries', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'agento-files-'))
  await writeFile(resolve(cwd, '.agentoignore'), 'tmp/\n# comment\n*.ignored\nlogs\n')

  const ignored = readIgnoreDirectories(cwd)

  assert.equal(ignored.has('node_modules'), true)
  assert.equal(ignored.has('tmp'), true)
  assert.equal(ignored.has('logs'), true)
  assert.equal(ignored.has('*.ignored'), false)
})

test('listDirectoryEntries and listProjectFiles return stable project-relative output', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'agento-files-'))
  await mkdir(resolve(cwd, 'src'))
  await mkdir(resolve(cwd, 'node_modules'))
  await writeFile(resolve(cwd, 'README.md'), 'readme')
  await writeFile(resolve(cwd, 'src/app.js'), 'app')
  await writeFile(resolve(cwd, 'node_modules/ignored.js'), 'ignored')

  assert.deepEqual(listDirectoryEntries('.', { cwd }), ['- README.md', 'd src'])
  assert.deepEqual(listProjectFiles('.', { cwd }), ['README.md', 'src/app.js'])
})

