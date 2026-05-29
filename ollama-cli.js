import { fileURLToPath } from 'node:url'
import { chat } from './agento.js'
import { config } from './config.js'
import {
  ensureOllamaServer,
  isOllamaReady,
  listModels,
  preloadModel,
  runCommand,
  shutdownOllama,
  stopManagedOllamaServer,
  unloadModel,
} from './ollama.js'

function printHelp() {
  console.log(`Usage:
  npm run ollama:serve
  npm run ollama:run -- "Hello!"
  npm run ollama:run -- --model llama3.2 "Hello!"
  npm run ollama:models
  npm run ollama:stop
  npm run ollama:stop -- --model llama3.2

Default model: ${config.model}
Ollama host: ${config.host}`)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  let model = config.model
  const promptParts = []

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]

    if (value === '--model' || value === '-m') {
      if (!rest[index + 1] || rest[index + 1].startsWith('-')) {
        throw new Error(`Missing value for ${value}. Example: --model llama3.2`)
      }

      model = rest[index + 1]
      index += 1
      continue
    }

    promptParts.push(value)
  }

  return { command, model, promptParts }
}

async function serve() {
  await runCommand('ollama', ['serve'])
}

async function run(model, promptParts) {
  if (promptParts.length === 0) {
    throw new Error('Prompt is required. Example: npm run ollama:run -- "Hello!"')
  }

  const startedServer = await ensureOllamaServer()

  try {
    await preloadModel(model)
    const content = await chat({ model, prompt: promptParts.join(' ') })
    console.log(content)
  } finally {
    if (startedServer) {
      await shutdownOllama(model)
    }
  }
}

async function models() {
  const startedServer = await ensureOllamaServer()

  try {
    const names = await listModels()
    console.log(names.length > 0 ? names.join('\n') : 'No local Ollama models found.')
  } finally {
    if (startedServer) {
      stopManagedOllamaServer()
    }
  }
}

async function stop(model) {
  if (!(await isOllamaReady())) {
    console.log('Ollama server is not running.')
    return
  }

  await unloadModel(model)
}

async function main() {
  const { command, model, promptParts } = parseArgs(process.argv.slice(2))

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h' ||
    promptParts.includes('--help') ||
    promptParts.includes('-h')
  ) {
    printHelp()
    return
  }

  if (command === 'serve') {
    await serve()
    return
  }

  if (command === 'run') {
    await run(model, promptParts)
    return
  }

  if (command === 'models') {
    await models()
    return
  }

  if (command === 'stop') {
    await stop(model)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
