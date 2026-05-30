#!/usr/bin/env node
import { spawn } from 'node:child_process'

const checks = [
  ['node', ['--check', 'src/config.js']],
  ['node', ['--check', 'src/chat.js']],
  ['node', ['--check', 'src/commands.js']],
  ['node', ['--check', 'scripts/ask.js']],
  ['node', ['--check', 'scripts/test.js']],
  ['node', ['--check', 'bin/agento.js']],
  ['node', ['--check', 'src/ollama.js']],
  ['node', ['--check', 'src/patches.js']],
  ['node', ['--check', 'bin/ollama.js']],
  ['node', ['--check', 'bin/agento-tui.js']],
  ['node', ['--check', 'src/doctor.js']],
  ['node', ['bin/agento.js', '--help']],
  ['node', ['bin/ollama.js', '--help']],
  ['node', ['bin/agento-tui.js', '--help']],
  ['node', ['bin/agento-tui.js', '--config']],
  ['node', ['--test', 'test/*.test.js']],
]

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: true,
      stdio: 'inherit',
    })

    child.on('error', (error) => {
      console.error(error.message)
      resolve(1)
    })

    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

for (const [command, args] of checks) {
  const label = [command, ...args].join(' ')
  console.log(`\n$ ${label}`)
  const exitCode = await run(command, args)

  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
