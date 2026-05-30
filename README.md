# Agento

Agento is a local, CLI-only coding assistant powered by Ollama.

It is intentionally small: it starts or reuses a local Ollama server, loads a local model, lets you add project files and command output to context, asks the model for help, and can validate/apply unified diffs after confirmation.

## Honest Status

Agento is usable as a personal local coding helper, but it is not a hardened multi-user agent platform.

What is in decent shape:

- Node-only runtime; no npm package dependencies are required.
- CLI help, command parsing, patch parsing, fake Ollama integration, and core workflows have automated tests.
- `doctor` checks the Agento installation separately from the Git project where you run it.
- Git corruption and risky shell commands have basic safeguards.

Known limits:

- `/run` executes real shell commands. Risk detection is heuristic, not a sandbox.
- `/apply` supports unified diffs only. `apply_patch` blocks are rejected.
- The TUI is a launcher with hints, not a full terminal UI.
- The main interactive session still lives mostly in `bin/agento.js`; more internals can be extracted over time.
- Quality depends heavily on the local Ollama model you choose.

## Requirements

- Node.js 22 or newer
- Ollama installed locally
- A local Ollama model already pulled

Default model:

```text
deepseek-coder
```

Pull a model with Ollama if needed:

```bash
ollama pull deepseek-coder
```

## Run Without npm

From the repository root:

```bash
node bin/agento.js
```

Run the TUI launcher:

```bash
node bin/agento-tui.js
```

Run one-shot helpers:

```bash
node bin/agento.js ask "review this project"
node bin/agento.js run "node scripts/test.js"
node bin/agento.js models
node bin/agento.js doctor
```

## Optional PATH Setup

To use `agento` and `agento-tui` as shell commands without `npm link`:

```bash
mkdir -p ~/.local/bin
chmod +x bin/agento.js bin/agento-tui.js
ln -s "$PWD/bin/agento.js" ~/.local/bin/agento
ln -s "$PWD/bin/agento-tui.js" ~/.local/bin/agento-tui
```

Make sure `~/.local/bin` is on your `PATH`.

`npm link` also works, but it is optional:

```bash
npm install
npm link
```

## Interactive Commands

Inside `agento`:

```text
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
/changed          Show changed files and Agento-applied files
/save [file]      Save session
/load [file]      Load session
/clear            Clear chat history and file context
/exit             Stop model and exit
```

Typical flow:

```text
/files
/context package.json bin/agento.js src/chat.js
/run node scripts/test.js
/status
review this CLI and suggest improvements
```

Patch flow:

```text
ask Agento to return a unified diff
/apply
/changed
```

Apply a patch file:

```text
/apply changes.patch
```

## Validation

Run the full local check suite:

```bash
node scripts/test.js
```

This runs JavaScript syntax checks, command help checks, unit tests, CLI workflow tests, and fake Ollama integration tests. It does not require a real model request.

`npm test` is only a shortcut:

```bash
npm test
```

Check the local Agento/Ollama environment:

```bash
node bin/agento.js doctor
```

`doctor` checks:

- Node.js version
- Agento installation files
- current directory Git health
- linked `agento` and `agento-tui` commands
- Ollama command availability
- Ollama server/model availability when reachable
- configured Agento limits

It does not start Ollama and does not send a chat request.

## Configuration

Agento loads `.env` from the directory where you run it. Environment variables override defaults.

Example:

```env
OLLAMA_MODEL=deepseek-coder
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_REQUEST_TIMEOUT_MS=180000
OLLAMA_STARTUP_TIMEOUT_MS=30000
AGENTO_MAX_FILE_BYTES=20000
AGENTO_MAX_HISTORY_MESSAGES=24
AGENTO_COMMAND_TIMEOUT_MS=120000
AGENTO_MAX_COMMAND_OUTPUT_BYTES=20000
AGENTO_MAX_FILE_LIST=500
AGENTO_MAX_CONTEXT_BYTES=120000
AGENTO_SESSION_FILE=.agento-session.json
AGENTO_KILL_ALL_OLLAMA=0
AGENTO_DEBUG=0
```

Use another model for one session:

```bash
OLLAMA_MODEL=llama3.2 node bin/agento.js
```

Or after installing/linking:

```bash
OLLAMA_MODEL=llama3.2 agento
```

## Ollama Helpers

```bash
node scripts/ask.js "quick one-shot prompt"
node bin/ollama.js serve
node bin/ollama.js models
node bin/ollama.js run "Hello!"
node bin/ollama.js run --model llama3.2 "Hello!"
node bin/ollama.js stop
```

## Safety Model

Agento is not a sandbox.

`/run` executes real shell commands in the current working directory. If a command looks risky, Agento prints the command, the current working directory, why it was flagged, and requires typing `run` before execution. In non-interactive mode, risky commands are blocked.

`/apply` runs `git apply --check` before applying a patch. It then asks for confirmation:

- `yes` applies once
- `always` applies future patches without asking again for the current session
- `no` cancels

Use `/changed` to inspect working tree changes and files applied by Agento during the current session.

By default, `/exit` unloads the selected model and stops only the Ollama server Agento started. Set `AGENTO_KILL_ALL_OLLAMA=1` only if you want `/exit` to also stop external `ollama serve` and `ollama runner` processes.

## Project Layout

```text
bin/                 CLI entrypoints
scripts/             Node-only helper scripts
src/chat.js          Ollama chat API client
src/commands.js      command parsing and risky-command detection
src/config.js        .env and environment config
src/doctor.js        health checks
src/ollama.js        Ollama server/model lifecycle helpers
src/patches.js       unified diff extraction helpers
test/                node:test suites
tui.json             TUI launcher text/config
```

`.agentoignore` controls directories skipped by `/files`.

## Current Health

As of this README update:

- `node scripts/test.js` passes.
- Test coverage includes command parsing, patch parsing, CLI smoke checks, CLI workflow checks, fake Ollama integration, and Git health failure detection.
- The project is suitable for local use and iterative improvement.
- The next valuable refactor is continuing to move interactive session behavior out of `bin/agento.js` into testable `src/` modules.
