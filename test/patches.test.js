import assert from 'node:assert/strict'
import test from 'node:test'
import { extractPatchFiles, extractPatchFromText } from '../src/patches.js'

const patch = [
  'diff --git a/src/old.js b/src/new.js',
  '--- a/src/old.js',
  '+++ b/src/new.js',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n')

test('extractPatchFromText returns a raw unified diff', () => {
  assert.equal(extractPatchFromText(patch), patch.trim())
})

test('extractPatchFromText unwraps fenced diff blocks', () => {
  assert.equal(extractPatchFromText(`Here is a patch:\n\n\`\`\`diff\n${patch}\`\`\``), patch.trim())
})

test('extractPatchFromText rejects unsupported apply_patch blocks', () => {
  assert.throws(
    () => extractPatchFromText('*** Begin Patch\n*** Update File: file.js\n*** End Patch'),
    /apply_patch blocks are not supported/
  )
})

test('extractPatchFiles returns touched files from git diff metadata', () => {
  assert.deepEqual(extractPatchFiles(patch), ['src/new.js'])
})

test('extractPatchFiles ignores deleted file marker', () => {
  const deletedPatch = [
    'diff --git a/deleted.js b/deleted.js',
    '--- a/deleted.js',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-old',
    '',
  ].join('\n')

  assert.deepEqual(extractPatchFiles(deletedPatch), ['deleted.js'])
})

