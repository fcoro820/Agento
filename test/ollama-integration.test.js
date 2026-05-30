import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function startFakeOllama() {
  const requests = []
  const server = createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      requests.push({ url: request.url, method: request.method })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: 'zeta:latest' }, { name: 'alpha:latest' }] }))
      return
    }

    if (request.url === '/api/generate') {
      const body = await readJson(request)
      requests.push({ url: request.url, method: request.method, body })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ response: '' }))
      return
    }

    if (request.url === '/api/chat') {
      const body = await readJson(request)
      requests.push({ url: request.url, method: request.method, body })
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
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function importFresh(relativePath) {
  const url = new URL(`../${relativePath}?test=${Date.now()}-${Math.random()}`, import.meta.url)
  return import(url.href)
}

let fakeOllama

test.before(async () => {
  fakeOllama = await startFakeOllama()
  process.env.OLLAMA_HOST = fakeOllama.url
})

test.after(async () => {
  delete process.env.OLLAMA_HOST
  await fakeOllama.close()
})

test('chat sends a non-streaming Ollama chat request', async () => {
  const { chat } = await importFresh('src/chat.js')
  const content = await chat({ model: 'unit-model', prompt: 'hello', keepAlive: 0 })

  assert.equal(content, 'fake response')
  assert.deepEqual(fakeOllama.requests.at(-1), {
    url: '/api/chat',
    method: 'POST',
    body: {
      model: 'unit-model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      keep_alive: 0,
    },
  })
})

test('Ollama helpers list models and preload the selected model', async () => {
  const { isOllamaReady, listModels, preloadModel } = await importFresh('src/ollama.js')

  assert.equal(await isOllamaReady(), true)
  assert.deepEqual(await listModels(), ['alpha:latest', 'zeta:latest'])
  await preloadModel('unit-model')

  assert.deepEqual(fakeOllama.requests.at(-1), {
    url: '/api/generate',
    method: 'POST',
    body: {
      model: 'unit-model',
      prompt: '',
      stream: false,
      keep_alive: -1,
    },
  })
})
