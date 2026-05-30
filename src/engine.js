import { exec, execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { chat } from './chat.js'
import { isRiskyCommand, riskyCommandReasons } from './commands.js'
import { config } from './config.js'
import {
  listDirectoryEntries,
  listProjectFiles as collectProjectFiles,
  readTextFile as readProjectTextFile,
  resolveInsideCwd,
  formatPath
} from './files.js'
import { extractPatchFiles, extractPatchFromText } from './patches.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export class AgentoEngine {
  constructor(session, options = {}) {
    this.session = session
    this.interactive = options.interactive ?? true
    this.protectedPaths = ['/etc', '/root', '/boot', '/sys', '/proc', '/dev', '/.ssh']
  }

  validateSecurity(command) {
    const root = process.cwd()
    const absolutePathRegex = /\/[a-zA-Z0-9._\/-]+/g
    const matches = command.match(absolutePathRegex) || []
    for (const path of matches) {
      if (!path.startsWith(root)) return { ok: false, error: `Security Violation: Path ${path} is outside project root.` }
    }
    for (const p of this.protectedPaths) {
      if (command.includes(p)) return { ok: false, error: `Security Violation: Access to ${p} is forbidden.` }
    }
    return { ok: true }
  }

  async runShell(command, confirmCb) {
    const security = this.validateSecurity(command)
    if (!security.ok) return { success: false, error: security.error }
    
    if (!this.interactive && isRiskyCommand(command)) {
      return { success: false, error: `Risky command blocked in non-interactive mode: ${command}` }
    }

    if (this.interactive && typeof confirmCb === 'function') {
      const confirmed = await confirmCb(command, riskyCommandReasons(command))
      if (!confirmed) return { success: false, error: 'Command cancelled.' }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: config.commandTimeoutMs,
        maxBuffer: config.maxCommandOutputBytes * 2,
      })
      const output = this._trimOutput([`$ ${command}`, stdout.trim(), stderr.trim()].filter(Boolean).join('\n'))
      this.session.messages.push({ role: 'user', content: `Command output:\n\n\`\`\`\n${output}\n\`\`\`` })
      this.session.trimHistory()
      return { success: true, output }
    } catch (e) {
      const output = this._trimOutput([`$ ${command}`, e.stderr || e.message].filter(Boolean).join('\n'))
      return { success: false, output, error: e.message }
    }
  }

  async applyPatch(patchText, confirmCb) {
    const dir = mkdtempSync(resolve(tmpdir(), 'agento-'))
    const patchPath = resolve(dir, 'change.patch')
    writeFileSync(patchPath, `${patchText}\n`)
    const patchFiles = extractPatchFiles(patchText)

    try {
      await execFileAsync('git', ['apply', '--check', patchPath], { cwd: process.cwd(), timeout: config.commandTimeoutMs })
      const { stdout: summary } = await execFileAsync('git', ['apply', '--stat', patchPath], { cwd: process.cwd() })

      if (!this.interactive) {
        return { success: false, error: 'Apply patch? Blocked in non-interactive mode.' }
      }

      if (typeof confirmCb === 'function') {
        if (!(await confirmCb(summary.trim() || 'Patch is valid.'))) return { success: false, error: 'Patch cancelled.' }
      }

      await execFileAsync('git', ['apply', patchPath], { cwd: process.cwd(), timeout: config.commandTimeoutMs })
      patchFiles.forEach(f => this.session.appliedFiles.add(f))
      return { success: true, patchFiles }
    } catch (e) {
      throw new Error(`Patch failed: ${(e.stderr || e.message).trim()}`)
    } finally {
      try { unlinkSync(patchPath) } catch {}
    }
  }

  async requestAI(prompt, isEdit = false, file = null, task = null) {
    if (isEdit && file) {
      const content = readProjectTextFile(file, { maxFileBytes: config.maxFileBytes })
      this.session.addFileContext(file, content.content)
      prompt = `Return only a unified diff for ${file}. Task: ${task}`
    }

    this.session.messages.push({ role: 'user', content: prompt })
    this.session.trimHistory()

    const response = await chat({
      model: this.session.model,
      prompt,
      messages: this.session.buildMessagesForRequest(),
      keepAlive: -1,
    })

    this.session.lastAssistantContent = response
    this.session.messages.push({ role: 'assistant', content: response })
    this.session.trimHistory()
    return response
  }

  _trimOutput(text) {
    const buf = Buffer.from(text)
    return buf.length <= config.maxCommandOutputBytes ? text : `${buf.subarray(0, config.maxCommandOutputBytes).toString('utf8')}\n... truncated ...`
  }

  getFile(path) { return readProjectTextFile(path, { maxFileBytes: config.maxFileBytes }) }
  getDir(path = '.') { return listDirectoryEntries(path).join('\n') || '(empty)' }
  getProjectFiles(path = '.') { 
    const files = collectProjectFiles(path, { maxFileList: config.maxFileList })
    return files.join('\n') || '(empty)'
  }
  extractPatch() { return extractPatchFromText(this.session.lastAssistantContent) }
}
