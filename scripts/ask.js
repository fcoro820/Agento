import { ensureOllamaServer, stopManagedOllamaServer } from '../src/ollama.js'
import { chat, parseChatArgs } from '../src/chat.js'

try {
  const { model, prompt } = parseChatArgs(process.argv.slice(2))

  if (!prompt) {
    throw new Error('Prompt is required. Example: npm run ask -- "Hello!"')
  }

  await ensureOllamaServer()
  const content = await chat({
    model,
    prompt,
    keepAlive: 0,
  })

  console.log(content)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  stopManagedOllamaServer()
}
