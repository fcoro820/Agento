import { createInterface } from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { parseCommandLine } from './commands.js'

export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
}

export class AgentoCLI {
  constructor(session, engine, options = {}) {
    this.session = session
    this.engine = engine
    this.promptLabel = options.promptLabel || 'agento> '
    this.rl = null
  }

  init() {
    this.rl = createInterface({ input, output })
    this.rl.setPrompt(this.promptLabel)
  }

  async prompt() { this.rl?.prompt() }

  async ask(q, cb) {
    return new Promise(res => this.rl.question(q, ans => res(cb(ans))))
  }

  printHelp() {
    console.log(`Usage: agento [doctor|ask|run|models]
Commands:
  /help, /status, /pwd, /ls, /files, /models, /model <name>
  /read <file>, /context <files>, /context-list, /forget <file>
  /run <cmd>, /edit <file> <task>, /apply [file], /changed
  /save [file], /load [file], /clear, /exit`)
  }

  async confirmRiskyCommand(command, reasons) {
    if (!this.rl) {
      console.error(`Risky command blocked in non-interactive mode: ${command}`)
      return false
    }
    console.log(`Risky command detected: ${command}`)
    console.log(`CWD: ${process.cwd()}`)
    console.log(`Reason: ${reasons.join('; ')}`)
    const answer = await this.ask('Type "run" to execute it, or anything else to cancel: ', (ans) => ans.trim())
    return answer === 'run'
  }

  async confirmApplyPatch(summary) {
    if (this.session.applyWithoutPrompt) return true
    if (!this.rl) {
      console.error('Apply patch? Blocked in non-interactive mode.')
      return false
    }
    console.log(summary)
    const answer = await this.ask('Apply patch? [yes / always / no] ', (ans) => ans.trim().toLowerCase())
    if (['yes', 'y'].includes(answer)) return true
    if (['a', 'always', 'yes and dont ask again', "yes and don't ask again", 'yes, dont ask again', "yes, don't ask again"].includes(answer)) {
      this.session.applyWithoutPrompt = true
      console.log('Apply confirmation disabled for this session.')
      return true
    }
    if (['no', 'n'].includes(answer)) return false
    console.log('Patch cancelled. Use yes, always, or no.')
    return false
  }

  async handleCommand(line) {
    const [cmd, ...args] = parseCommandLine(line)
    const val = args.join(' ')

    switch (cmd) {
      case '/exit': return { shouldContinue: false }
      case '/help': this.printHelp(); return { shouldContinue: true }
      case '/pwd': console.log(process.cwd()); return { shouldContinue: true }
      case '/ls': console.log(this.engine.getDir(val || '.')); return { shouldContinue: true }
      case '/files': console.log(this.engine.getProjectFiles(val || '.')); return { shouldContinue: true }
      case '/read': 
        const f = this.engine.getFile(args[0])
        console.log(`--- ${f.path} ---\\n${f.content}`)
        return { shouldContinue: true }
      case '/context':
        for (const file of args) {
          const content = this.engine.getFile(file).content
          this.session.addFileContext(file, content)
          console.log(`Added: ${file}`)
        }
        return { shouldContinue: true }
      case '/context-list':
        console.log([...this.session.fileContexts.keys()].sort().join('\\n') || '(none)')
        return { shouldContinue: true }
      case '/forget':
        args.forEach(f => {
          const removed = this.session.removeFileContext(f)
          console.log(removed ? `Removed: ${f}` : `Not found: ${f}`)
        })
        return { shouldContinue: true }
      case '/run':
        const res = await this.engine.runShell(line.slice(cmd.length).trim(), (c, r) => this.confirmRiskyCommand(c, r))
        console.log(res.output || res.error || '(no output)')
        return { shouldContinue: true }
      case '/edit':
        const editContent = await this.engine.requestAI(null, true, args[0], args.slice(1).join(' '))
        console.log(`\\n${editContent}\\n`)
        return { shouldContinue: true }
      case '/apply':
        const patch = args[0] ? this.engine.getFile(args[0]).content : this.engine.extractPatch()
        if (!patch) throw new Error('No patch available.')
        const aRes = await this.engine.applyPatch(patch, (sum) => this.confirmApplyPatch(sum))
        console.log(aRes.success ? `Applied changes to: ${aRes.patchFiles.join(', ')}` : aRes.error)
        return { shouldContinue: true }
      case '/changed':
        const changed = await this.engine.getChangedFiles()
        console.log(`Changes:\\n${changed.join('\\n') || '(none)'}`)
        console.log(`\\nApplied by Agento this session:\\n${[...this.session.appliedFiles].sort().join('\\n') || '(none)'}`)
        return { shouldContinue: true }
      case '/save': console.log(`Saved session: ${this.session.save(args[0])}`); return { shouldContinue: true }
      case '/load': console.log(`Loaded session: ${this.session.load(args[0])}`); return { shouldContinue: true }
      case '/clear': this.session.clear(); console.log('Cleared.'); return { shouldContinue: true }
      default: throw new Error(`Unknown command: ${cmd}`)
    }
  }

  close() { this.rl?.close() }
}
