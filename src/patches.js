export function extractPatchFromText(text) {
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

export function extractPatchFiles(patchText) {
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

