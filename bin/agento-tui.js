#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const binDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(binDir, '..')
const configPath = resolve(rootDir, 'tui.json')
const colors = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
}
const reset = '\x1b[0m'

function usage() {
  console.log(`Usage:
  agento-tui
  agento-tui --model llama3.2
  node bin/agento-tui.js --config

Options:
  --help, -h      Show this help
  --config        Print loaded TUI configuration`)
}

function loadTuiConfig() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing TUI config: ${configPath}`)
  }

  const data = JSON.parse(readFileSync(configPath, 'utf8'))
  const commands = Array.isArray(data.commands) ? data.commands : []
  const quickStart = Array.isArray(data.quickStart) ? data.quickStart : []

  return {
    title: data.title || 'Agento',
    subtitle: data.subtitle || 'Local CLI-only AI coding assistant',
    prompt: data.prompt || 'agento> ',
    accent: data.accent || 'cyan',
    showCommandHints: data.showCommandHints !== false,
    quickStart,
    commands,
  }
}

function colorize(text, accent) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    return text
  }

  return `${colors[accent] || colors.cyan}${text}${reset}`
}

function printSection(title, lines) {
  if (lines.length === 0) {
    return
  }

  console.log(title)
  for (const line of lines) {
    console.log(`  ${line}`)
  }
}

function renderTui(config) {
  const width = Math.min(process.stdout.columns || 80, 88)
  const rule = '─'.repeat(Math.max(width - 2, 20))
  console.log(colorize(`┌${rule}┐`, config.accent))
  console.log(colorize(`│ ${config.title.padEnd(Math.max(width - 4, 0)).slice(0, width - 4)} │`, config.accent))
  console.log(colorize(`│ ${config.subtitle.padEnd(Math.max(width - 4, 0)).slice(0, width - 4)} │`, config.accent))
  console.log(colorize(`└${rule}┘`, config.accent))
  console.log()

  printSection('Quick start:', config.quickStart)

  if (config.showCommandHints) {
    const commandLines = config.commands.map((entry) => {
      const command = String(entry.command || '').padEnd(24)
      return `${command} ${entry.description || ''}`.trimEnd()
    })
    printSection('Common commands:', commandLines)
  }

  console.log()
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    usage()
    return
  }

  const config = loadTuiConfig()

  if (args.includes('--config')) {
    console.log(JSON.stringify(config, null, 2))
    return
  }

  renderTui(config)

  const child = spawn(process.execPath, [resolve(binDir, 'agento.js'), ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENTO_TUI: '1',
      AGENTO_PROMPT: config.prompt,
    },
    stdio: 'inherit',
  })

  const exitCode = await new Promise((resolveExit) => {
    child.on('error', (error) => {
      console.error(error.message)
      resolveExit(1)
    })
    child.on('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0))
    })
  })

  process.exitCode = exitCode
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
