import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolve } from 'node:path'
import { config } from './config.js'
import { formatPath, resolveInsideCwd } from './files.js'

export class AgentoSession {
  constructor(assistantPrompt) {
    this.assistantPrompt = assistantPrompt
    this.model = null
    this.messages = [{ role: 'system', content: assistantPrompt }]
    this.fileContexts = new Map()
    this.appliedFiles = new Set()
    this.lastAssistantContent = ''
    this.applyWithoutPrompt = false
  }

  getContextBytes() {
    let total = 0
    for (const content of this.fileContexts.values()) {
      total += Buffer.byteLength(content)
    }
    return total
  }

  addFileContext(path, content) {
    this.fileContexts.set(path, content)
  }

  removeFileContext(path) {
    return this.fileContexts.delete(path)
  }

  clear() {
    this.fileContexts.clear()
    this.appliedFiles.clear()
    this.messages = [{ role: 'system', content: this.assistantPrompt }]
    this.lastAssistantContent = ''
  }

  trimHistory() {
    const [systemMessage, ...history] = this.messages
    const limit = config.maxHistoryMessages
    if (history.length <= limit) return
    this.messages = [systemMessage, ...history.slice(-limit)]
  }

  buildMessagesForRequest() {
    const fileContextMessages = [...this.fileContexts.entries()].map(([path, content]) => ({
      role: 'user',
      content: `File context: ${path}\n\n\`\`\`\n${content}\n\`\`\``,
    }))
    return [this.messages[0], ...fileContextMessages, ...this.messages.slice(1)]
  }

  save(target) {
    const targetPath = resolveInsideCwd(target || config.sessionFile)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, JSON.stringify({
      model: this.model,
      messages: this.messages,
      fileContexts: [...this.fileContexts.entries()],
      lastAssistantContent: this.lastAssistantContent,
    }, null, 2))
    return formatPath(targetPath)
  }

  load(target) {
    const targetPath = resolveInsideCwd(target || config.sessionFile)
    const data = JSON.parse(readFileSync(targetPath, 'utf8'))
    this.model = data.model || this.model
    this.messages = data.messages
    this.fileContexts = new Map(data.fileContexts)
    this.lastAssistantContent = data.lastAssistantContent || ''
    return formatPath(targetPath)
  }
}
