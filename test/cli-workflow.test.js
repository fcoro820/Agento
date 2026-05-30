import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter } from 'node:path'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function startFakeOllama() {
  const server = createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: 'deepseek-coder:latest' }] }))
      return
    }

    if (request.url === '/api/generate') {
      await readJson(request)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ response: '' }))
      return
    }

    if (request.url === '/api/chat') {
      await readJson(request)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ message: { content: 'fake response' } }))
      return
    }

    response.statusCode = 404
    response.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function runNode(args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || rootDir,
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('exit', (code, signal) => {
      resolveRun({ code: code ?? (signal ? 1 : 0), stdout, stderr })
    })

    if (options.input) {
      child.stdin.end(options.input)
    } else {
      child.stdin.end()
    }
  })
}

async function createFakeOllamaCommand(tempDir) {
  const binDir = resolve(tempDir, 'bin')
  const commandPath = resolve(binDir, 'ollama')
  await mkdir(binDir, { recursive: true })
  await writeFile(
    commandPath,
    '#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "ollama fake"; fi\nexit 0\n'
  )
  await chmod(commandPath, 0o755)
  return binDir
}

test('non-interactive run executes safe commands and blocks risky commands', async () => {
  const safe = await runNode([resolve(rootDir, 'bin/agento.js'), 'run', 'printf safe'])
  assert.equal(safe.code, 0)
  assert.match(safe.stdout, /\$ printf safe/)
  assert.match(safe.stdout, /safe/)

  const risky = await runNode([resolve(rootDir, 'bin/agento.js'), 'run', 'rm -rf tmp'])
  assert.equal(risky.code, 0)
  assert.match(risky.stderr, /Risky command blocked in non-interactive mode/)
  assert.match(risky.stdout, /Command cancelled/)
})

test('interactive commands can save, load, validate patches, and show changed files', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'agento-cli-workflow-'))
  const fakeOllama = await startFakeOllama()
  const fakeBin = await createFakeOllamaCommand(tempDir)

  try {
    await execFileAsync('git', ['init'], { cwd: tempDir })
    await writeFile(resolve(tempDir, 'tracked.txt'), 'original\n')
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: tempDir })
    await execFileAsync('git', ['commit', '-m', 'initial'], {
      cwd: tempDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Agento Test',
        GIT_AUTHOR_EMAIL: 'agento@example.com',
        GIT_COMMITTER_NAME: 'Agento Test',
        GIT_COMMITTER_EMAIL: 'agento@example.com',
      },
    })
    await writeFile(resolve(tempDir, 'notes.txt'), 'untracked\n')
    await writeFile(
      resolve(tempDir, 'change.patch'),
      [
        'diff --git a/tracked.txt b/tracked.txt',
        '--- a/tracked.txt',
        '+++ b/tracked.txt',
        '@@ -1 +1 @@',
        '-original',
        '+patched',
        '',
      ].join('\n')
    )

    const result = await runNode([resolve(rootDir, 'bin/agento.js')], {
      cwd: tempDir,
      input: '/save session.json\n/load session.json\n/apply change.patch\n/changed\n/exit\n',
      env: {
        ...process.env,
        OLLAMA_HOST: fakeOllama.url,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      },
    })

    assert.equal(result.code, 0)
    assert.match(result.stdout, /Saved session: session\.json/)
    assert.match(result.stdout, /Loaded session: session\.json/)
    assert.match(result.stdout, /Patch is valid|tracked\.txt/)
    assert.match(result.stderr, /Apply patch\? Blocked in non-interactive mode\./)
    assert.match(result.stdout, /Working tree changes:/)
    assert.match(result.stdout, /\?\? notes\.txt/)
    assert.equal(await readFile(resolve(tempDir, 'session.json'), 'utf8').then(Boolean), true)
  } finally {
    await fakeOllama.close()
  }
})
