#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { stdin as input } from 'node:process'
import { parseChatArgs } from '../src/chat.js'
import { config } from '../src/config.js'
import { ensureOllamaServer, listModels, preloadModel, shutdownOllama } from '../src/ollama.js'
import { AgentoSession } from '../src/session.js'
import { AgentoEngine } from '../src/engine.js'
import { AgentoCLI, COLORS } from '../src/cli.js'

const PROMPT = `You are Agento, a CLI-only AI coding assistant. Be concise and practical. Prefer unified diffs for changes.`

let currentModel = null

async function runNonInteractive(args, engine) {
  const [sub, ...rest] = args
  if (!sub || sub.startsWith('-')) return false

  if (sub === 'doctor') {
    const { runDoctor } = await import('../src/doctor.js')
    const exitCode = await runDoctor()
    if (exitCode !== 0) throw new Error(`Doctor failed with exit code ${exitCode}`)
    process.exitCode = exitCode
    return true
  }

  if (sub === 'ask') {
    const p = rest.join(' ').trim()
    if (!p) throw new Error('Usage: agento ask <prompt>')
    await ensureOllamaServer()
    await preloadModel(engine.session.model)
    console.log(await engine.requestAI(p))
    return true
  }

  if (sub === 'run') {
    const cmd = rest.join(' ').trim()
    if (!cmd) throw new Error('Usage: agento run <command>')
    const res = await engine.runShell(cmd, () => true)
    console.log(res.output || res.error || '(no output)')
    return true
  }

  if (sub === 'models') {
    await ensureOllamaServer()
    console.log((await listModels()).join('\\n') || 'No models found.')
    return true
  }
  return false
}

async function main() {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--help') || args.includes('-h')) {
      const session = new AgentoSession(PROMPT)
      const engine = new AgentoEngine(session)
      const cli = new AgentoCLI(session, engine)
      cli.printHelp()
      process.exit(0)
    }

    const session = new AgentoSession(PROMPT)
    const isInteractive = input.isTTY
    const engine = new AgentoEngine(session, { interactive: isInteractive })

    if (await runNonInteractive(args, engine)) return

    const chatArgs = parseChatArgs(args)
    currentModel = chatArgs.model
    session.model = currentModel
    
    await ensureOllamaServer()
    await preloadModel(currentModel)

    const cli = new AgentoCLI(session, engine, { 
      promptLabel: `${COLORS.bold}${COLORS.cyan}agento${COLORS.reset}> ` 
    })
    cli.init()
    
    console.log(`\n${COLORS.bold}${COLORS.green}🚀 Agento coding assistant ready.${COLORS.reset}`)
    console.log(`${COLORS.gray}Model: ${COLORS.white}${currentModel}${COLORS.gray} | ${COLORS.white}Interactive Mode${COLORS.reset}\n`)
    
    if (process.env.AGENTO_TUI !== '1') {
      cli.printHelp()
    }

    const pipedInput = input.isTTY ? null : readFileSync(0, 'utf8')
    const source = pipedInput === null ? cli.rl : pipedInput.split('\\n').filter(l => l.trim())

    if (cli.rl) cli.rl.prompt()

    for await (const line of source) {
      const prompt = line.trim()
      if (!prompt) { cli.rl?.prompt(); continue }
      try {
        if (prompt.startsWith('/')) {
          const result = await cli.handleCommand(prompt)
          if (!result.shouldContinue) break
        } else {
          const content = await engine.requestAI(prompt)
          console.log(`\n${COLORS.bold}${COLORS.green}🤖 AGENTO:${COLORS.reset}`)
          console.log(`${COLORS.gray}──────────────────────────────────────────────────${COLORS.reset}`)
          console.log(`${content}\n`)
          console.log(`${COLORS.gray}──────────────────────────────────────────────────${COLORS.reset}\n`)
        }
      } catch (e) {
        console.error(`${COLORS.bold}${COLORS.red}❌ Error:${COLORS.reset} ${e.message}`)
      }
      cli.rl?.prompt()
    }
  } catch (e) {
    console.error(`${COLORS.bold}${COLORS.red}❌ Fatal Error:${COLORS.reset} ${e.message}`)
    process.exitCode = 1
  } finally {
    if (currentModel) await shutdownOllama(currentModel)
  }
}

main()
