import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFile, readFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { AgentoSession } from '../src/session.js'
import { AgentoEngine } from '../src/engine.js'
import { AgentoCLI } from '../src/cli.js'
import { config } from '../src/config.js'

test('Agento Comprehensive Suite', async (t) => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'agento-test-'))
  
  await t.test('Session Layer: Save and Load', async () => {
    const session = new AgentoSession('Test Prompt')
    session.model = 'test-model'
    session.addFileContext('test.txt', 'hello world')
    
    const path = session.save('test-session.json')
    const newSession = new AgentoSession('Test Prompt')
    newSession.load('test-session.json')
    
    assert.equal(newSession.model, 'test-model')
    assert.equal(newSession.fileContexts.get('test.txt'), 'hello world')
  })

  await t.test('Engine Layer: Security Jail', async () => {
    const session = new AgentoSession('Test Prompt')
    const engine = new AgentoEngine(session)
    
    const result = await engine.runShell('cat /etc/passwd', () => true)
    assert.equal(result.success, false)
    assert.match(result.error, /Security Violation/)
  })

  await t.test('Engine Layer: Shell Execution', async () => {
    const session = new AgentoSession('Test Prompt')
    const engine = new AgentoEngine(session)
    
    const result = await engine.runShell('echo "hello"', () => true)
    assert.equal(result.success, true)
    assert.match(result.output, /hello/)
  })

  await t.test('Engine Layer: Patching', async () => {
    const session = new AgentoSession('Test Prompt')
    const engine = new AgentoEngine(session)
    
    const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`
    try {
      await engine.applyPatch(patch, () => true)
    } catch (e) {
      assert.match(e.message, /Patch failed/)
    }
  })

  await t.test('Interface Layer: CLI Command Dispatch', async () => {
    const session = new AgentoSession('Test Prompt')
    const engine = new AgentoEngine(session)
    const cli = new AgentoCLI(session, engine)
    
    const res = await cli.handleCommand('/pwd')
    assert.equal(res.shouldContinue, true)
  })
})
