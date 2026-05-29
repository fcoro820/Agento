import { spawn } from 'node:child_process'
import { config } from './config.js'

const OLLAMA_TAGS_URL = `${config.host}/api/tags`
const OLLAMA_GENERATE_URL = `${config.host}/api/generate`
const RETRY_INTERVAL_MS = 500

let managedServer = null

export async function isOllamaReady() {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForOllama() {
  const startTime = Date.now()

  while (Date.now() - startTime < config.startupTimeoutMs) {
    if (await isOllamaReady()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS))
  }

  throw new Error(`Ollama server did not become ready within ${config.startupTimeoutMs}ms.`)
}

export async function ensureOllamaServer() {
  if (await isOllamaReady()) {
    console.log('Ollama server already running.')
    return false
  }

  console.log('Starting Ollama server...')

  managedServer = spawn('ollama', ['serve'], {
    stdio: 'ignore',
  })

  managedServer.on('error', (error) => {
    console.error(`Failed to start Ollama server: ${error.message}`)
  })

  managedServer.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`Ollama server exited unexpectedly: ${code ?? signal}`)
    }
  })

  await waitForOllama()
  return true
}

export function stopManagedOllamaServer() {
  if (managedServer && !managedServer.killed) {
    managedServer.kill('SIGTERM')
  }
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio || 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0 || options.allowFailure) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} failed: ${code ?? signal}`))
    })
  })
}

async function stopAllOllamaProcesses() {
  const patterns = [
    ['pkill', ['-TERM', '-f', '(^|/)ollama serve$']],
    ['pkill', ['-TERM', '-f', '(^|/)ollama[[:space:]]+serve']],
    ['pkill', ['-TERM', '-f', '(^|/)ollama[[:space:]]+runner']],
  ]

  for (const [command, args] of patterns) {
    try {
      await runCommand(command, args, { stdio: 'ignore', allowFailure: true })
    } catch {
      // Ignore missing pkill on non-Linux systems; managed process cleanup still runs.
    }
  }
}

export async function preloadModel(model = config.model) {
  console.log(`Loading model ${model}...`)

  const response = await fetch(OLLAMA_GENERATE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
    body: JSON.stringify({
      model,
      prompt: '',
      stream: false,
      keep_alive: -1,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Could not load model ${model}: ${response.status} ${errorText}`)
  }

  console.log(`Model ${model} is ready.`)
}

export async function unloadModel(model = config.model) {
  try {
    await runCommand('ollama', ['stop', model], { stdio: 'ignore' })
  } catch (error) {
    console.error(`Could not stop model ${model}: ${error.message}`)
  }
}

export async function listModels() {
  const response = await fetch(OLLAMA_TAGS_URL, {
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Could not list models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.models?.map((model) => model.name).sort() || []
}

export async function shutdownOllama(model = config.model) {
  await unloadModel(model)
  stopManagedOllamaServer()
  if (config.killAllOllama) {
    await stopAllOllamaProcesses()
  }
}
