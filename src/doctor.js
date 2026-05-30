import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.js'
import { isOllamaReady, listModels } from './ollama.js'

const execFileAsync = promisify(execFile)
const MIN_NODE_MAJOR = 22

function printCheck(status, label, detail = '') {
  const marker = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
  }[status]
  console.log(`${marker} ${label}${detail ? ` - ${detail}` : ''}`)
}

async function capture(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      timeout: options.timeout || 5000,
    })
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || '').trim(),
      stderr: (error.stderr || error.message).trim(),
    }
  }
}

async function commandPath(command) {
  const result = await capture('sh', ['-lc', `command -v ${command}`])
  return result.ok ? result.stdout : ''
}

function readPackageJson() {
  const path = resolve(process.cwd(), 'package.json')
  if (!existsSync(path)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function modelMatches(modelName, availableModel) {
  return (
    availableModel === modelName ||
    availableModel === `${modelName}:latest` ||
    availableModel.startsWith(`${modelName}:`)
  )
}

function checkNode(results) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (major >= MIN_NODE_MAJOR) {
    printCheck('pass', 'Node.js', process.version)
    return
  }

  results.failed = true
  printCheck('fail', 'Node.js', `${process.version}; requires >= ${MIN_NODE_MAJOR}`)
}

function checkPackage(results) {
  const packageJson = readPackageJson()
  if (!packageJson) {
    results.failed = true
    printCheck('fail', 'package.json', 'missing or invalid')
    return
  }

  printCheck('pass', 'package.json', `${packageJson.name || 'unknown'}@${packageJson.version || '0.0.0'}`)

  if (packageJson.bin?.agento === './bin/agento.js') {
    printCheck('pass', 'agento binary config', packageJson.bin.agento)
  } else {
    results.failed = true
    printCheck('fail', 'agento binary config', 'missing bin.agento')
  }

  if (packageJson.bin?.['agento-tui'] === './bin/agento-tui.js') {
    printCheck('pass', 'agento-tui binary config', packageJson.bin['agento-tui'])
  } else {
    printCheck('warn', 'agento-tui binary config', 'missing bin.agento-tui')
  }
}

function checkLocalFiles(results) {
  const requiredFiles = [
    'bin/agento.js',
    'bin/agento-tui.js',
    'bin/ollama.js',
    'scripts/ask.js',
    'src/chat.js',
    'src/config.js',
    'src/doctor.js',
    'src/ollama.js',
    'tui.json',
  ]

  for (const file of requiredFiles) {
    if (existsSync(resolve(process.cwd(), file))) {
      printCheck('pass', file, 'found')
    } else {
      results.failed = true
      printCheck('fail', file, 'missing')
    }
  }

  if (existsSync(resolve(process.cwd(), '.env'))) {
    printCheck('pass', '.env', 'found')
  } else {
    printCheck('warn', '.env', 'not found; using defaults and environment variables')
  }
}

function checkConfig() {
  printCheck('pass', 'configured model', config.model)
  printCheck('pass', 'Ollama host', config.host)
  printCheck('pass', 'request timeout', `${config.requestTimeoutMs}ms`)
  printCheck('pass', 'startup timeout', `${config.startupTimeoutMs}ms`)
  printCheck('pass', 'max file bytes', `${config.maxFileBytes}`)
  printCheck('pass', 'max context bytes', `${config.maxContextBytes}`)
}

async function checkGit(results) {
  const root = await capture('git', ['rev-parse', '--show-toplevel'])
  if (!root.ok) {
    printCheck('warn', 'Git repository', 'not inside a git repository')
    return
  }

  const head = await capture('git', ['rev-parse', '--verify', 'HEAD'])
  const status = await capture('git', ['status', '--short'])

  if (!head.ok || !status.ok) {
    results.failed = true
    const detail = [head.stderr, status.stderr].filter(Boolean).join('; ')
    printCheck('fail', 'Git repository', detail || 'repository metadata is not readable')
    return
  }

  printCheck('pass', 'Git repository', root.stdout)
}

async function checkLinkedCommands() {
  const agentoPath = await commandPath('agento')
  if (agentoPath) {
    printCheck('pass', 'agento command', agentoPath)
  } else {
    printCheck('warn', 'agento command', 'not on PATH; run npm link if needed')
  }

  const tuiPath = await commandPath('agento-tui')
  if (tuiPath) {
    printCheck('pass', 'agento-tui command', tuiPath)
  } else {
    printCheck('warn', 'agento-tui command', 'not on PATH; run npm link if needed')
  }
}

async function checkOllama(results) {
  const ollamaPath = await commandPath('ollama')
  if (!ollamaPath) {
    results.failed = true
    printCheck('fail', 'ollama command', 'not found on PATH')
    return
  }

  printCheck('pass', 'ollama command', ollamaPath)

  const version = await capture('ollama', ['--version'])
  if (version.ok) {
    const versionText = [version.stdout, version.stderr]
      .filter(Boolean)
      .join('\n')
      .split(/\r?\n/)
      .find((line) => !line.toLowerCase().startsWith('warning:'))
    printCheck('pass', 'ollama version', versionText || 'available')
  } else {
    printCheck('warn', 'ollama version', version.stderr)
  }

  const ready = await isOllamaReady()
  if (!ready) {
    printCheck('warn', 'Ollama server', `not reachable at ${config.host}; Agento can start it when needed`)
    return
  }

  printCheck('pass', 'Ollama server', `reachable at ${config.host}`)

  try {
    const models = await listModels()
    if (models.length === 0) {
      printCheck('warn', 'Ollama models', 'no local models found')
      return
    }

    printCheck('pass', 'Ollama models', `${models.length} local model(s)`)

    const hasConfiguredModel = models.some((availableModel) => modelMatches(config.model, availableModel))
    if (hasConfiguredModel) {
      printCheck('pass', 'configured model available', config.model)
    } else {
      printCheck('warn', 'configured model available', `${config.model} not found locally`)
    }
  } catch (error) {
    printCheck('warn', 'Ollama models', error.message)
  }
}

export async function runDoctor() {
  const results = { failed: false }

  console.log('Agento doctor')
  console.log(`CWD: ${process.cwd()}`)
  console.log('')

  checkNode(results)
  checkPackage(results)
  checkLocalFiles(results)
  checkConfig()
  await checkGit(results)
  await checkLinkedCommands()
  await checkOllama(results)

  console.log('')
  if (results.failed) {
    console.log('Doctor finished with failures.')
    return 1
  }

  console.log('Doctor finished without blocking failures.')
  return 0
}
