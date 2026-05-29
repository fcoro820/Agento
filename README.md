# Agento

Agento is a local, CLI-only AI coding assistant powered by Ollama.

It starts Ollama when needed, loads a local coding model, keeps the model alive during the session, and cleans up when you exit.

## Requirements

- Node.js 22 or newer
- Ollama installed locally
- A local Ollama model already pulled

Default model:

```text
deepseek-coder
```

## Install

```bash
npm install
npm link
```

`npm link` makes the `agento` command available on your shell `PATH`.

## Start

```bash
agento
```

Use another model:

```bash
agento --model llama3.2
```

Non-interactive helpers:

```bash
agento ask "review this project"
agento run "npm test"
agento models
```

Exit the session:

```text
/exit
```

## Validate

Run local checks:

```bash
npm test
```

This checks JavaScript syntax and command help output. It does not require a model request.

## Coding Assistant Commands

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
/save [file]      Save session
/load [file]      Load session
/clear            Clear chat history and file context
/exit             Stop model and exit
```

Typical flow:

```text
/files
/context package.json interactive.js
/context "file with spaces.js"
/run npm test
/status
review this CLI and suggest improvements
```

Patch flow:

```text
ask Agento to return a unified diff
/apply
```

Or apply a patch file:

```text
/apply changes.patch
```

## Configuration

Copy `.env.example` to `.env` and adjust the values:

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

Environment variables override defaults:

```bash
OLLAMA_MODEL=llama3.2 agento
```

`.env` is loaded from the directory where you run `agento`.

## Ollama Helpers

```bash
npm run ask -- "quick one-shot prompt"
npm run dev
npm run ollama:serve
npm run ollama:models
npm run ollama:run -- "Hello!"
npm run ollama:stop
```

## Safety Note

`/run` executes real shell commands in the current working directory. Agento asks for confirmation before commands that look risky, but the detection is heuristic and not a security sandbox. Read commands before confirming them.

`/apply` runs `git apply --check` first, then asks for confirmation before applying the patch.

`.agentoignore` controls directories skipped by `/files`.

By default, `/exit` unloads the selected model and stops only the Ollama server Agento started. Set `AGENTO_KILL_ALL_OLLAMA=1` only if you want `/exit` to also stop external `ollama serve` and `ollama runner` processes.
