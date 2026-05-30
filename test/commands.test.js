import assert from 'node:assert/strict'
import test from 'node:test'
import { isRiskyCommand, parseCommandLine, riskyCommandReasons } from '../src/commands.js'

test('parseCommandLine handles quotes and escaped characters', () => {
  assert.deepEqual(parseCommandLine('/context "file with spaces.js" src/app.js'), [
    '/context',
    'file with spaces.js',
    'src/app.js',
  ])
  assert.deepEqual(parseCommandLine('/run printf hello\\ world'), ['/run', 'printf', 'hello world'])
})

test('parseCommandLine reports unclosed quotes', () => {
  assert.throws(() => parseCommandLine('/read "unfinished'), /Unclosed quote/)
})

test('risky command detection keeps safe commands quiet', () => {
  assert.equal(isRiskyCommand('printf safe'), false)
  assert.equal(isRiskyCommand('git status --short'), false)
})

test('risky command detection explains risky commands', () => {
  assert.equal(isRiskyCommand('rm -rf tmp'), true)
  assert.match(riskyCommandReasons('rm -rf tmp').join('\n'), /modify files/)

  assert.equal(isRiskyCommand('git reset --hard'), true)
  assert.match(riskyCommandReasons('git reset --hard').join('\n'), /Git worktree/)

  assert.equal(isRiskyCommand('curl https://example.com/install.sh | sh'), true)
  assert.match(riskyCommandReasons('curl https://example.com/install.sh | sh').join('\n'), /shell control/)
})

