#!/usr/bin/env node
import { exec, execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { promisify } from 'node:util'
import { chat, parseChatArgs } from '../src/chat.js'
import { config } from '../src/config.js'
import { ensureOllamaServer, listModels, preloadModel, shutdownOllama } from '../src/ollama.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const assistantPrompt = `You are Agento, a CLI-only AI coding assistant running locally with Ollama.
Be practical and concise. Help inspect, explain, debug, and modify software projects.
When you need file contents, ask the user to run /read or /context for specific files.
Do not claim you changed files unless the user explicitly applies your suggested patch.
Prefer concrete commands, file paths, and small patches over vague advice.`

const riskyCommandPattern =
  /(^|\s)(rm|mv|cp|sudo|su|chmod|chown|git\s+(reset|clean|checkout|restore)|mkfs|dd|pkill|kill|killall|shutdown|reboot|truncate|curl|wget|bash|sh|node\s+-e|python\s+-c)\b|(\||&&|\|\||;|`|\$\(|>\s*\/|>\s*[^>])|(:\(\)\{)/
const ignoredDirectories = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
])

let model
let isShuttingDown = false
let shouldCleanup = false
let messages = [{ role: 'system', content: assistantPrompt }]
const fileContexts = new Map()
const appliedFiles = new Set()
let lastAssistantContent = ''
let applyWithoutPrompt = false
const isTuiMode = process.env.AGENTO_TUI === '1'
const promptLabel = process.env.AGENTO_PROMPT || 'agento> '

function debug(message) {
  if (config.debug) {
    console.error(`[debug] ${message}`)
  }
}

function shouldPrintCliHelp() {
  return process.argv.includes('--help') || process.argv.includes('-h')
}

function printCliHelp() {
  console.log(`Usage:
  agento
  agento doctor
  agento --model llama3.2

Commands:
  /help             Show commands
  /status           Show session status
  /pwd              Show current working directory
  /ls [dir]         List files in a directory
  /files [dir]      List project files recursively
  /models           List local Ollama models
  /model <name>     Switch model during the session
  /read <file>      Print file contents
  /context <files>  Add one or more files to chat context
  /context-list     Show files currently in context
  /forget <file>    Remove one file from chat context
  /run <command>    Run a shell command and add output to context
  /edit <file> <task> Ask for a unified diff for a file
  /apply [file]     Apply a unified diff from a file or last assistant reply
  /changed          Show files changed in the working tree
  /save [file]      Save session
  /load [file]      Load session
  /clear            Clear chat history and file context
  /exit             Stop model and exit`)
}

function printHelp() {
  printCliHelp()
}

if (shouldPrintCliHelp()) {
  printCliHelp()
  process.exit(0)
}

let pipedInput = null
let rl = null

function readIgnoreDirectories() {
  const ignoreFile = resolve(process.cwd(), '.agentoignore')
  if (!existsSync(ignoreFile)) {
    return ignoredDirectories
  }

  const customIgnored = new Set(ignoredDirectories)
  for (const line of readFileSync(ignoreFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.includes('*')) {
      customIgnored.add(trimmed.replace(/\/$/, ''))
    }
  }

  return customIgnored
}

function resolveInsideCwd(target = '.') {
  const cwd = process.cwd()
  const resolved = resolve(cwd, target)

  if (resolved !== cwd && !resolved.startsWith(`${cwd}/`)) {
    throw new Error(`Path is outside the current project: ${target}`)
  }

  return resolved
}

function formatPath(path) {
  const rel = relative(process.cwd(), path)
  return rel || '.'
}

function parseCommandLine(inputLine) {
  const parts = []
  let current = ''
  let quote = null
  let escaping = false

  for (const char of inputLine.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  if (quote) {
    throw new Error(`Unclosed quote: ${quote}`)
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

function isProbablyText(buffer) {
  return !buffer.includes(0)
}

function readTextFile(target) {
  const filePath = resolveInsideCwd(target)
  const stats = statSync(filePath)

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${target}`)
  }

  if (stats.size > config.maxFileBytes) {
    throw new Error(
      `File is too large (${stats.size} bytes). Limit: ${config.maxFileBytes} bytes.`
    )
  }

  const buffer = readFileSync(filePath)

  if (!isProbablyText(buffer)) {
    throw new Error(`File appears to be binary: ${target}`)
  }

  return {
    path: formatPath(filePath),
    content: buffer.toString('utf8'),
  }
}

function listDirectory(target = '.') {
  const dirPath = resolveInsideCwd(target)
  const entries = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.git'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`)

  console.log(entries.join('\n') || '(empty)')
}

function collectFiles(dirPath, files = []) {
  const ignored = readIgnoreDirectories()
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) {
      continue
    }

    const fullPath = resolve(dirPath, entry.name)

    if (entry.isDirectory()) {
      collectFiles(fullPath, files)
      continue
    }

    files.push(formatPath(fullPath))

    if (files.length >= config.maxFileList) {
      return files
    }
  }

  return files
}

function listProjectFiles(target = '.') {
  const dirPath = resolveInsideCwd(target)
  const files = collectFiles(dirPath).sort()
  const truncated = files.length >= config.maxFileList
  console.log(files.join('\n') || '(empty)')
  if (truncated) {
    console.log(`... file list truncated at ${config.maxFileList} entries ...`)
  }
}

function addFileContext(target) {
  const file = readTextFile(target)
  const nextSize = getContextBytes() + Buffer.byteLength(file.content)
  if (!fileContexts.has(file.path) && nextSize > config.maxContextBytes) {
    throw new Error(
      `Context would exceed ${config.maxContextBytes} bytes. Use /forget or /clear first.`
    )
  }
  fileContexts.set(file.path, file.content)
  console.log(`Added context: ${file.path}`)
}

function removeFileContext(target, options = {}) {
  let filePath = target
  if (!fileContexts.has(filePath)) {
    try {
      const resolved = resolveInsideCwd(target)
      if (existsSync(resolved)) {
        filePath = formatPath(resolved)
      }
    } catch {
      // Keep the raw label so /forget can remove context names without requiring a real file.
    }
  }

  const removed = fileContexts.delete(filePath)

  if (!options.silent) {
    console.log(removed ? `Removed context: ${filePath}` : `No context found for: ${filePath}`)
  }
}

function printStatus() {
  console.log(`Model: ${model}
CWD: ${process.cwd()}
Context files: ${fileContexts.size}
Context bytes: ${getContextBytes()} / ${config.maxContextBytes}
History messages: ${Math.max(messages.length - 1, 0)}
File limit: ${config.maxFileBytes} bytes
File list limit: ${config.maxFileList}
Command timeout: ${config.commandTimeoutMs}ms
Debug: ${config.debug ? 'on' : 'off'}`)
}

function printContextList() {
  const files = [...fileContexts.keys()].sort()
  console.log(files.length > 0 ? files.join('\n') : '(no files in context)')
}

function trimOutput(output) {
  const buffer = Buffer.from(output)

  if (buffer.length <= config.maxCommandOutputBytes) {
    return output
  }

  return `${buffer.subarray(0, config.maxCommandOutputBytes).toString('utf8')}\n... output truncated ...`
}

function getContextBytes() {
  let total = 0
  for (const content of fileContexts.values()) {
    total += Buffer.byteLength(content)
  }
  return total
}

function isRiskyCommand(command) {
  return riskyCommandPattern.test(command.trim())
}

function riskyCommandReasons(command) {
  const trimmed = command.trim()
  const reasons = []

  if (/(^|\s)(rm|mv|cp|sudo|su|chmod|chown|mkfs|dd|truncate)\b/.test(trimmed)) {
    reasons.push('can modify files or permissions')
  }
  if (/(^|\s)git\s+(reset|clean|checkout|restore)\b/.test(trimmed)) {
    reasons.push('can discard or replace Git worktree changes')
  }
  if (/(^|\s)(pkill|kill|killall|shutdown|reboot)\b/.test(trimmed)) {
    reasons.push('can stop processes or the machine')
  }
  if (/(^|\s)(curl|wget|bash|sh|node\s+-e|python\s+-c)\b/.test(trimmed)) {
    reasons.push('can execute downloaded or inline code')
  }
  if (/(\||&&|\|\||;|`|\$\()/.test(trimmed)) {
    reasons.push('contains shell control operators')
  }
  if (/(>\s*\/|>\s*[^>])/.test(trimmed)) {
    reasons.push('redirects output and may overwrite files')
  }

  return reasons.length > 0 ? reasons : ['matches the risky-command heuristic']
}

async function confirmRiskyCommand(command) {
  if (!isRiskyCommand(command)) {
    return true
  }

  if (!rl) {
    console.error(`Risky command blocked in non-interactive mode: ${command}`)
    return false
  }

  console.log(`Risky command detected: ${command}`)
  console.log(`CWD: ${process.cwd()}`)
  console.log(`Reason: ${riskyCommandReasons(command).join('; ')}`)
  const answer = await new Promise((resolveAnswer) => {
    rl.question('Type "run" to execute it, or anything else to cancel: ', resolveAnswer)
  })

  return answer.trim() === 'run'
}

async function confirmApplyPatch() {
  if (applyWithoutPrompt) {
    return true
  }

  if (!rl) {
    console.error('Apply patch? Blocked in non-interactive mode.')
    return false
  }

  const answer = await new Promise((resolveAnswer) => {
    rl.question('Apply patch? [yes / always / no] ', resolveAnswer)
  })
  const normalized = answer.trim().toLowerCase()

  if (['yes', 'y'].includes(normalized)) {
    return true
  }

  if (
    [
      'a',
      'always',
      'yes and dont ask again',
      "yes and don't ask again",
      'yes, dont ask again',
      "yes, don't ask again",
    ].includes(normalized)
  ) {
    applyWithoutPrompt = true
    console.log('Apply confirmation disabled for this session.')
    return true
  }

  if (['no', 'n'].includes(normalized)) {
    return false
  }

  console.log('Patch cancelled. Use yes, always, or no.')
  return false
}

async function runShellCommand(command) {
  if (!(await confirmRiskyCommand(command))) {
    console.log('Command cancelled.')
    return
  }

  let stdout = ''
  let stderr = ''
  let exitInfo = ''

  try {
    debug(`running command: ${command}`)
    const result = await execAsync(command, {
      cwd: process.cwd(),
      timeout: config.commandTimeoutMs,
      maxBuffer: config.maxCommandOutputBytes * 2,
    })
    stdout = result.stdout
    stderr = result.stderr
  } catch (error) {
    stdout = error.stdout || ''
    stderr = error.stderr || error.message
    exitInfo = `exit ${error.code ?? 'unknown'}`
  }

  const outputText = trimOutput(
    [`$ ${command}`, exitInfo, stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
  )

  messages.push({
    role: 'user',
    content: `Command output:\n\n\`\`\`\n${outputText}\n\`\`\``,
  })
  trimHistory()
  console.log(outputText || '(no output)')
}

async function listAvailableModels() {
  const names = await listModels()
  console.log(names.length > 0 ? names.join('\n') : 'No local Ollama models found.')
}

async function switchModel(nextModel) {
  if (!nextModel) {
    throw new Error('Usage: /model <name>')
  }

  await shutdownOllama(model)
  model = nextModel
  shouldCleanup = true
  await ensureOllamaServer()
  await preloadModel(model)
  console.log(`Switched model: ${model}`)
}

async function requestEdit(file, task) {
  if (!file || !task) {
    throw new Error('Usage: /edit <file> <task>')
  }

  addFileContext(file)
  const prompt = `Return only a unified diff for ${file}. Task: ${task}`
  messages.push({ role: 'user', content: prompt })
  trimHistory()
  const content = await chat({
    model,
    prompt,
    messages: buildMessagesForRequest(),
    keepAlive: -1,
  })
  lastAssistantContent = content
  messages.push({ role: 'assistant', content })
  trimHistory()
  console.log(`\n${content}\n`)
}

function sessionPath(target) {
  return resolveInsideCwd(target || config.sessionFile)
}

function saveSession(target) {
  const targetPath = sessionPath(target)
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(
    targetPath,
    JSON.stringify(
      {
        model,
        messages,
        fileContexts: [...fileContexts.entries()],
        lastAssistantContent,
      },
      null,
      2
    )
  )
  console.log(`Saved session: ${formatPath(targetPath)}`)
}

async function runOneShotPrompt(prompt) {
  shouldCleanup = true
  await ensureOllamaServer()
  await preloadModel(model)
  const content = await chat({
    model,
    prompt,
    messages: [{ role: 'system', content: assistantPrompt }, { role: 'user', content: prompt }],
    keepAlive: 0,
  })
  console.log(content)
}

async function runNonInteractiveCommand(argv) {
  const [subcommand, ...rest] = argv

  if (!subcommand || subcommand.startsWith('-')) {
    return false
  }

  ;({ model } = parseChatArgs([]))

  if (subcommand === 'doctor') {
    if (rest.length > 0) {
      throw new Error('Usage: agento doctor')
    }

    const { runDoctor } = await import('../src/doctor.js')
    process.exitCode = await runDoctor()
    return true
  }

  if (subcommand === 'ask') {
    const prompt = rest.join(' ').trim()
    if (!prompt) {
      throw new Error('Usage: agento ask <prompt>')
    }
    await runOneShotPrompt(prompt)
    return true
  }

  if (subcommand === 'run') {
    const command = rest.join(' ').trim()
    if (!command) {
      throw new Error('Usage: agento run <command>')
    }
    await runShellCommand(command)
    return true
  }

  if (subcommand === 'models') {
    shouldCleanup = true
    await ensureOllamaServer()
    await listAvailableModels()
    return true
  }

  return false
}

function loadSession(target) {
  const targetPath = sessionPath(target)
  const data = JSON.parse(readFileSync(targetPath, 'utf8'))
  if (!Array.isArray(data.messages) || !Array.isArray(data.fileContexts)) {
    throw new Error('Invalid session file.')
  }
  model = data.model || model
  messages = data.messages
  fileContexts.clear()
  for (const [path, content] of data.fileContexts) {
    fileContexts.set(path, content)
  }
  lastAssistantContent = data.lastAssistantContent || ''
  console.log(`Loaded session: ${formatPath(targetPath)}`)
}

function clearContext() {
  fileContexts.clear()
  appliedFiles.clear()
  messages = [{ role: 'system', content: assistantPrompt }]
  lastAssistantContent = ''
  console.log('Cleared chat history and file context.')
}

function trimHistory() {
  const [systemMessage, ...history] = messages
  const limit = config.maxHistoryMessages

  if (history.length <= limit) {
    return
  }

  messages = [systemMessage, ...history.slice(-limit)]
}

function buildMessagesForRequest() {
  const fileContextMessages = [...fileContexts.entries()].map(([path, content]) => ({
    role: 'user',
    content: `File context: ${path}\n\n\`\`\`\n${content}\n\`\`\``,
  }))

  return [messages[0], ...fileContextMessages, ...messages.slice(1)]
}

function extractPatchFromText(text) {
  const fencedPatch = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/i)
  const candidate = fencedPatch ? fencedPatch[1].trim() : text.trim()

  if (!candidate.includes('diff --git') && !candidate.includes('*** Begin Patch')) {
    throw new Error('No unified diff or apply_patch block found.')
  }

  if (candidate.includes('*** Begin Patch')) {
    throw new Error('apply_patch blocks are not supported by Agento CLI yet. Ask for a unified diff.')
  }

  return candidate
}

function extractPatchFiles(patchText) {
  const files = new Set()

  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      if (match) {
        files.add(match[2])
      }
      continue
    }

    if (line.startsWith('+++ b/')) {
      files.add(line.slice('+++ b/'.length))
    }
  }

  files.delete('/dev/null')
  return [...files].sort()
}

async function getChangedFiles() {
  try {
    const result = await execFileAsync('git', ['status', '--short'], {
      cwd: process.cwd(),
      timeout: config.commandTimeoutMs,
    })
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
  } catch (error) {
    throw new Error(`Could not read changed files: ${(error.stderr || error.message).trim()}`)
  }
}

async function printChangedFiles() {
  const changedFiles = await getChangedFiles()

  console.log('Working tree changes:')
  console.log(changedFiles.length > 0 ? changedFiles.join('\n') : '(none)')

  console.log('\nApplied by Agento this session:')
  console.log(appliedFiles.size > 0 ? [...appliedFiles].sort().join('\n') : '(none)')
}

async function applyUnifiedDiff(patchText) {
  const dir = mkdtempSync(resolve(tmpdir(), 'agento-'))
  const patchPath = resolve(dir, 'change.patch')
  const patchFiles = extractPatchFiles(patchText)
  writeFileSync(patchPath, `${patchText}\n`)

  try {
    await execFileAsync('git', ['apply', '--check', patchPath], {
      cwd: process.cwd(),
      timeout: config.commandTimeoutMs,
    })

    const summary = await execFileAsync('git', ['apply', '--stat', patchPath], {
      cwd: process.cwd(),
      timeout: config.commandTimeoutMs,
    })
    console.log(summary.stdout.trim() || 'Patch is valid.')

    if (!(await confirmApplyPatch())) {
      console.log('Patch cancelled.')
      return
    }

    await execFileAsync('git', ['apply', patchPath], {
      cwd: process.cwd(),
      timeout: config.commandTimeoutMs,
    })
    for (const file of patchFiles) {
      appliedFiles.add(file)
    }
    console.log('Patch applied.')
    if (patchFiles.length > 0) {
      console.log(`Changed files:\n${patchFiles.join('\n')}`)
    }
  } catch (error) {
    const stderr = error.stderr || error.message
    throw new Error(`Patch failed: ${stderr.trim()}`)
  } finally {
    try {
      unlinkSync(patchPath)
    } catch {
      // Temporary file cleanup best effort.
    }
  }
}

async function applyPatchFromSource(target) {
  const patchText = target ? readTextFile(target).content : extractPatchFromText(lastAssistantContent)
  await applyUnifiedDiff(patchText)
}

async function shutdownAndExit(exitCode = 0) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  rl?.close()
  if (shouldCleanup) {
    await shutdownOllama(model)
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  shutdownAndExit(130).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
})

process.on('SIGTERM', () => {
  shutdownAndExit(143).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
})

async function handleCommand(inputLine) {
  const [command, ...args] = parseCommandLine(inputLine)
  const value = args.join(' ')

  if (command === '/exit') {
    return false
  }

  if (command === '/help') {
    printHelp()
    return true
  }

  if (command === '/status') {
    printStatus()
    return true
  }

  if (command === '/pwd') {
    console.log(process.cwd())
    return true
  }

  if (command === '/ls') {
    listDirectory(value || '.')
    return true
  }

  if (command === '/files') {
    listProjectFiles(value || '.')
    return true
  }

  if (command === '/models') {
    await listAvailableModels()
    return true
  }

  if (command === '/model') {
    await switchModel(args[0])
    return true
  }

  if (command === '/read') {
    if (args.length !== 1) {
      throw new Error('Usage: /read <file>')
    }

    const file = readTextFile(args[0])
    console.log(`--- ${file.path} ---\n${file.content}`)
    return true
  }

  if (command === '/context') {
    if (!value) {
      throw new Error('Usage: /context <file> [file...]')
    }

    for (const file of args) {
      addFileContext(file)
    }
    return true
  }

  if (command === '/context-list') {
    printContextList()
    return true
  }

  if (command === '/forget') {
    if (args.length === 0) {
      throw new Error('Usage: /forget <file> [file...]')
    }

    for (const file of args) {
      removeFileContext(file)
    }
    return true
  }

  if (command === '/run') {
    const rawCommand = inputLine.slice(command.length).trim()

    if (!rawCommand) {
      throw new Error('Usage: /run <command>')
    }

    await runShellCommand(rawCommand)
    return true
  }

  if (command === '/edit') {
    if (args.length < 2) {
      throw new Error('Usage: /edit <file> <task>')
    }

    await requestEdit(args[0], args.slice(1).join(' '))
    return true
  }

  if (command === '/apply') {
    if (args.length > 1) {
      throw new Error('Usage: /apply [patch-file]')
    }

    await applyPatchFromSource(args[0])
    return true
  }

  if (command === '/changed') {
    await printChangedFiles()
    return true
  }

  if (command === '/save') {
    saveSession(args[0])
    return true
  }

  if (command === '/load') {
    loadSession(args[0])
    return true
  }

  if (command === '/clear') {
    clearContext()
    return true
  }

  throw new Error(`Unknown command: ${command}. Use /help.`)
}

try {
  const handledNonInteractive = await runNonInteractiveCommand(process.argv.slice(2))

  if (!handledNonInteractive) {
    pipedInput = input.isTTY ? null : readFileSync(0, 'utf8')
    rl = pipedInput === null ? createInterface({ input, output }) : null

    ;({ model } = parseChatArgs(process.argv.slice(2)))
    shouldCleanup = true
    await ensureOllamaServer()
    await preloadModel(model)
    console.log(`Agento coding assistant ready. Model: ${model}`)
    if (!isTuiMode) {
      printHelp()
    }
    const source =
      pipedInput === null
        ? rl
        : pipedInput.split(/\r?\n/).filter((line) => line.length > 0)

    if (rl) {
      rl.setPrompt(promptLabel)
      rl.prompt()
    }

    for await (const line of source) {
      const prompt = line.trim()

      if (!prompt) {
        rl?.prompt()
        continue
      }

      try {
        if (prompt.startsWith('/')) {
          const shouldContinue = await handleCommand(prompt)
          if (!shouldContinue) {
            break
          }
          rl?.prompt()
          continue
        }

        messages.push({ role: 'user', content: prompt })
        trimHistory()

        const content = await chat({
          model,
          prompt,
          messages: buildMessagesForRequest(),
          keepAlive: -1,
        })
        lastAssistantContent = content
        messages.push({ role: 'assistant', content })
        trimHistory()
        console.log(`\n${content}\n`)
      } catch (error) {
        if (!prompt.startsWith('/')) {
          messages.pop()
        }
        console.error(error.message)
      }

      rl?.prompt()
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (!isShuttingDown) {
    isShuttingDown = true
    rl?.close()
    if (shouldCleanup) {
      await shutdownOllama(model)
    }
  }
}
