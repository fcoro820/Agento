import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function runNode(args) {
  return execFileAsync(process.execPath, args, {
    cwd: rootDir,
    timeout: 5000,
  })
}

test('CLI help entrypoints load without starting Ollama', async () => {
  const entrypoints = [
    ['bin/agento.js', '--help'],
    ['bin/ollama.js', '--help'],
    ['bin/agento-tui.js', '--config'],
  ]

  for (const args of entrypoints) {
    const { stdout } = await runNode(args)
    assert.notEqual(stdout.trim(), '')
  }
})

test('Agento CLI imports Ollama helpers from the core module', async () => {
  const source = await readFile(resolve(rootDir, 'bin/agento.js'), 'utf8')

  assert.match(source, /from '\.\.\/src\/ollama\.js'/)
  assert.doesNotMatch(source, /import\('\.\/ollama\.js'\)/)
})

test('Agento CLI does not bypass cleanup after non-interactive commands', async () => {
  const source = await readFile(resolve(rootDir, 'bin/agento.js'), 'utf8')

  assert.doesNotMatch(source, /if \(await runNonInteractiveCommand\(process\.argv\.slice\(2\)\)\) \{\s*process\.exit\(0\)/)
})

test('Ollama helper help documents direct node usage', async () => {
  const { stdout } = await runNode(['bin/ollama.js', '--help'])

  assert.match(stdout, /node bin\/ollama\.js serve/)
  assert.doesNotMatch(stdout, /npm run ollama:serve/)
})

test('doctor fails a repository with an unreadable HEAD object', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'agento-broken-git-'))
  const gitDir = resolve(tempDir, '.git')
  const missingCommit = '1111111111111111111111111111111111111111'

  await mkdir(resolve(gitDir, 'objects'), { recursive: true })
  await mkdir(resolve(gitDir, 'refs', 'heads'), { recursive: true })
  await writeFile(
    resolve(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n'
  )
  await writeFile(resolve(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(resolve(gitDir, 'refs', 'heads', 'main'), `${missingCommit}\n`)

  await assert.rejects(
    execFileAsync(process.execPath, [resolve(rootDir, 'bin/agento.js'), 'doctor'], {
      cwd: tempDir,
      timeout: 5000,
    }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stdout, /FAIL Git repository/)
      return true
    }
  )
})
