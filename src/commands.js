const riskyCommandPattern =
  /(^|\s)(rm|mv|cp|sudo|su|chmod|chown|git\s+(reset|clean|checkout|restore)|mkfs|dd|pkill|kill|killall|shutdown|reboot|truncate|curl|wget|bash|sh|node\s+-e|python\s+-c)\b|(\||&&|\|\||;|`|\$\(|>\s*\/|>\s*[^>])|(:\(\)\{)/

export function parseCommandLine(inputLine) {
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

export function isRiskyCommand(command) {
  return riskyCommandPattern.test(command.trim())
}

export function riskyCommandReasons(command) {
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

