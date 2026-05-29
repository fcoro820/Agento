import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(path = resolve(process.cwd(), '.env')) {
  if (!existsSync(path)) {
    return
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if (!key || process.env[key] !== undefined) {
      continue
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readBoolean(name, fallback = false) {
  const value = process.env[name]

  if (value === undefined) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

loadEnvFile()

export const config = {
  model: process.env.OLLAMA_MODEL || 'deepseek-coder',
  host: (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  requestTimeoutMs: readInteger('OLLAMA_REQUEST_TIMEOUT_MS', 180000),
  startupTimeoutMs: readInteger('OLLAMA_STARTUP_TIMEOUT_MS', 30000),
  maxFileBytes: readInteger('AGENTO_MAX_FILE_BYTES', 20000),
  maxHistoryMessages: readInteger('AGENTO_MAX_HISTORY_MESSAGES', 24),
  commandTimeoutMs: readInteger('AGENTO_COMMAND_TIMEOUT_MS', 120000),
  maxCommandOutputBytes: readInteger('AGENTO_MAX_COMMAND_OUTPUT_BYTES', 20000),
  maxFileList: readInteger('AGENTO_MAX_FILE_LIST', 500),
  maxContextBytes: readInteger('AGENTO_MAX_CONTEXT_BYTES', 120000),
  sessionFile: process.env.AGENTO_SESSION_FILE || '.agento-session.json',
  killAllOllama: readBoolean('AGENTO_KILL_ALL_OLLAMA', false),
  debug: readBoolean('AGENTO_DEBUG', false),
}
