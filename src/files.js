import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export const defaultIgnoredDirectories = new Set([
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

export function readIgnoreDirectories(cwd = process.cwd()) {
  const ignoreFile = resolve(cwd, '.agentoignore')
  if (!existsSync(ignoreFile)) {
    return defaultIgnoredDirectories
  }

  const customIgnored = new Set(defaultIgnoredDirectories)
  for (const line of readFileSync(ignoreFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.includes('*')) {
      customIgnored.add(trimmed.replace(/\/$/, ''))
    }
  }

  return customIgnored
}

export function resolveInsideCwd(target = '.', cwd = process.cwd()) {
  const resolved = resolve(cwd, target)

  if (resolved !== cwd && !resolved.startsWith(`${cwd}/`)) {
    throw new Error(`Path is outside the current project: ${target}`)
  }

  return resolved
}

export function formatPath(path, cwd = process.cwd()) {
  const rel = relative(cwd, path)
  return rel || '.'
}

export function isProbablyText(buffer) {
  return !buffer.includes(0)
}

export function readTextFile(target, options = {}) {
  const cwd = options.cwd || process.cwd()
  const maxFileBytes = options.maxFileBytes || 20000
  const filePath = resolveInsideCwd(target, cwd)
  const stats = statSync(filePath)

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${target}`)
  }

  if (stats.size > maxFileBytes) {
    throw new Error(`File is too large (${stats.size} bytes). Limit: ${maxFileBytes} bytes.`)
  }

  const buffer = readFileSync(filePath)

  if (!isProbablyText(buffer)) {
    throw new Error(`File appears to be binary: ${target}`)
  }

  return {
    path: formatPath(filePath, cwd),
    content: buffer.toString('utf8'),
  }
}

export function listDirectoryEntries(target = '.', options = {}) {
  const cwd = options.cwd || process.cwd()
  const dirPath = resolveInsideCwd(target, cwd)
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.git'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`)
}

function collectFiles(dirPath, files, options) {
  const ignored = readIgnoreDirectories(options.cwd)
  const maxFileList = options.maxFileList || 500

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) {
      continue
    }

    const fullPath = resolve(dirPath, entry.name)

    if (entry.isDirectory()) {
      collectFiles(fullPath, files, options)
      continue
    }

    files.push(formatPath(fullPath, options.cwd))

    if (files.length >= maxFileList) {
      return files
    }
  }

  return files
}

export function listProjectFiles(target = '.', options = {}) {
  const cwd = options.cwd || process.cwd()
  const dirPath = resolveInsideCwd(target, cwd)
  return collectFiles(dirPath, [], {
    cwd,
    maxFileList: options.maxFileList || 500,
  }).sort()
}

