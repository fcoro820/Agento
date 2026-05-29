import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const DEFAULT_MODEL = config.model

export function parseChatArgs(argv) {
  let model = DEFAULT_MODEL
  const promptParts = []

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--model' || value === '-m') {
      if (!argv[index + 1] || argv[index + 1].startsWith('-')) {
        throw new Error(`Missing value for ${value}. Example: --model llama3.2`)
      }

      model = argv[index + 1]
      index += 1
      continue
    }

    promptParts.push(value)
  }

  return {
    model,
    prompt: promptParts.join(' ').trim(),
  }
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs).unref()
  return controller.signal
}

export async function chat({
  model = DEFAULT_MODEL,
  prompt,
  messages,
  keepAlive,
  timeoutMs = config.requestTimeoutMs,
}) {
  if (!prompt) {
    throw new Error('Prompt is required. Example: npm run ask -- "Hello!"')
  }

  if (!model) {
    throw new Error('Model is required.')
  }

  try {
    const response = await fetch(`${config.host}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      signal: createTimeoutSignal(timeoutMs),
      body: JSON.stringify({
        model,
        messages: messages || [{ role: 'user', content: prompt }],
        stream: false,
        keep_alive: keepAlive,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama chat failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const content = data.message?.content?.trim()

    if (!content) {
      throw new Error('Ollama returned an empty response.')
    }

    return content
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to Ollama server at ${config.host}.`)
    }

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms.`)
    }

    throw error
  }
}

async function main() {
  const { model, prompt } = parseChatArgs(process.argv.slice(2))
  const content = await chat({ model, prompt })
  console.log(content)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
