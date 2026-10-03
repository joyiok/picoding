# PiCoding

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Confirmed by the user: TypeScript, React + Vite frontend, Node.js backend, official pi coding-agent SDK, Linux + Docker task environments with Chromium, Git, Node.js and Python.

## Users
Confirmed: a privately deployed, single-workspace coding workbench, with one separate installation per customer. The user describes tasks in Chinese and wants to see and take over the agent's browser.

## Product Purpose
Give pi a task computer: real files, shell execution and a preinstalled browser, all controlled from a Web workbench. Success is a complete task from a natural-language request through code changes, execution, browser verification and downloadable artifacts.

## Operating Context
Runs on the user's machine with a Docker daemon. Each task has its own container and persistent project volume. The Web server manages pi sessions. Provided sandbox/browser operations and adapted native read/write/edit/bash tools execute in the container. User-installed pi extension code runs in the local host control service under the native SDK and is trusted code; TUI-dependent extensions have no special Web widget mapping (headless RPC hasUI=false). The browser shown to the user is the browser controlled by pi. Model credentials stay on the host and are not mounted or placed in container environment variables.

Production mode runs the compiled Node server, serving the Web app and API on loopback by default. Remote deployment requires an explicit HTTPS public origin and a 12–256-character access password, with TLS terminated by a reverse proxy. HTTP APIs, downloads, SSE, desktop and terminal WebSockets require an authenticated session; logout and expiry revoke live connections. Session cookies are HttpOnly and SameSite=Strict, with Secure and the __Host prefix for remote HTTPS. Password checks use scrypt, login attempts and concurrent checks are bounded, and sessions expire after eight hours or a server restart. Session cookies are not forwarded into task containers. Reauthentication retains the mounted workspace and editor/message drafts. The port defaults to 4310 and is configurable with PICODING_PORT; development forwarding follows it. Installation and restart acceptance has been verified on Linux/WSL with Docker and Node 22.22.1, against the minimum Node 22.19 requirement. The sandbox build command forwards standard HTTP(S)/NO_PROXY arguments, selects host build networking for Linux loopback proxies unless PICODING_BUILD_NETWORK overrides it, and honors PICODING_SANDBOX_IMAGE. Task runtime networking stays on the bridge.

## Capabilities and Constraints
Task titles can be searched in the sidebar and renamed without changing conversations, project files or execution. Failed renames preserve the entered name for retry. On session expiry, open native dialogs close temporarily so the login page remains interactive; after authentication they reopen with unsaved fields intact.

Task creation and history; streamed agent messages and tool calls; isolated project files and commands; preinstalled Chromium; live viewing and human takeover; code editing and diffs; project export. Model API credentials are provided by the user. Each installation offers one shared workspace and optional access-password authentication; tenant accounts and a public multi-tenant service are outside this deployment model. Docker is required for task execution.

Confirmed: graceful control-server shutdown cancels model requests and sandbox startup/import/baseline initialization, stops task containers and preserves project files, tool history, pi sessions and the Chromium profile. Pending initial requests stay available for retry without being executed during shutdown or duplicated in user-message history. Restart restores stopped tasks; task services and the PTY must be started again.

After a host crash, startup first acquires its listening port and then removes only containers owned by recorded interrupted task IDs, retaining project volumes. An occupied port exits with failure without changing existing tasks. Authentication errors are redacted and can be retried; stalled model requests can be cancelled and resumed. Worker-owned idempotent browser shutdown preserves Chromium localStorage through graceful container restart.

Stopping and deleting tasks wait for in-flight model, command and takeover/release operations to settle before final persistence and environment destruction. Concurrent Stop requests share one shutdown. Stop/delete guards reject new task mutations and restarts until completion, and a failed shutdown releases its guard for retry. Cancelled command requests remain in execution history. Task deletion closes its event streams and removes subscriptions; reconnecting the workbench rechecks files without discarding editor drafts.

Message drafts are kept separately for each task and the new-task composer in the current browser tab's sessionStorage. Refresh restores drafts and the selected task; a removed selection falls back to the new-task composer. Sending clears only the submitted draft version after success, retaining edits made while the request was pending. Failed sends retain input, and delayed creation/deletion replies do not replace another task the user has selected. Drafts are never sent automatically. If browser storage fails, drafts remain in memory and unsaved message input triggers page-exit protection. Code-editor drafts retain their separate save/conflict handling and navigation confirmation.

The finite local single-user flows are implemented and tested. npm run verify reproduces tests plus a production build; npm run test:integration builds and exercises the actual compiled server, real Docker/Chromium/PTY and private temporary data against a deterministic local SSE model with fictional credentials. User settings remain untouched. External real model providers and installation on other operating systems remain unverified; snapshots, task branches, accounts and cloud scheduling are outside this local scope.

Confirmed: Skills and plugins reuse official DefaultPackageManager/SettingsManager/loadSkills and DefaultResourceLoader/createAgentSession, covering native skills, extensions, prompt templates, dynamic resources, registered tools and slash commands. The user can install official npm/Git/local package sources, enable/disable, update, remove, inspect resources/diagnostics and refresh without a model or Docker. There are no preset packages or a custom package format/installer. Skill Use inserts /skill:name into the composer without sending it.

Package changes and refresh are rejected while tasks are creating/running/pausing. Changes apply on the next message and preserve project files/history; GET inventories only, while explicit refresh invalidates idle sessions after native CLI changes. The pi:packages wrapper invokes the installed official CLI in user scope with PI_CODING_AGENT_DIR=<PICODING_DATA_DIR>/pi. Native pi owns formats, filtering and settings persistence in pi/settings.json, with its skills/extensions/prompts conventions and explicitly configured user sources. Automatic discovery stays within PiCoding's resource scope, excluding the host assistant's ~/.agents/skills and arbitrary task project context/extensions. Local sources may persist as canonical relative paths; removing a local package preserves its source files. Skill directories/helpers are copied by standard tar/Docker transport to /workspace/.picoding/pi-skills/<hash> for task tools.

Confirmed: a blank workspace or public HTTP(S) Git import can be created without model credentials; Docker and the task image are required. Git import accepts an optional branch, finishes before workspace Git baseline initialization, and retains pendingImport after failure for retry without overwriting an existing project. Agent execution still requires the user's model configuration.

Confirmed: file and folder uploads preserve binary bytes and relative subdirectories, with a 10 MiB per-file limit and at most 1000 selected files per batch. The UI excludes .git, .picoding and node_modules; the backend rejects those reserved paths. Existing files produce a 409 conflict and stay intact. Uploads preserve unsaved editor drafts.

Task networking can inherit backend HTTPS_PROXY/HTTP_PROXY or use PICODING_SANDBOX_PROXY; none disables the task proxy. A separate authenticated relay connects a loopback proxy while task containers stay on the Docker bridge. Container-local development URLs bypass the proxy.

Backend model requests inherit HTTP(S)_PROXY through an explicit undici dispatcher for native Node fetch. PICODING_MODEL_PROXY can override the model proxy or disable it with none, independently of task networking. Existing NO_PROXY entries are retained, and localhost, 127.0.0.1 and ::1 always bypass the proxy so internal worker credentials travel directly.

Confirmed: each running task exposes one real Unix PTY with a persistent Bash shell. Working directory and environment state survive terminal/browser view switches and webpage reconnects while that task environment is running. Recent output replays up to 256 KiB. Multiple webpages for the same task share the shell, with dimensions following the active window. Stopping the environment ends the PTY; the project volume and Bash history remain, and restart creates a new shell.

The interactive terminal is read-only by default. Taking over the computer pauses the agent before input is enabled; the host requires paused state for every WebSocket input message. Returning control interrupts the foreground program and waits for a Bash prompt while nohup background services keep running. Agent commands and the existing independent command form remain in execution history rather than the interactive PTY.

Terminal UI offers Ctrl+C, Tab and Enter controls and an optional screen-reader output mode, off by default. The xterm view loads on the first terminal-tab selection, remains mounted across view switches, and fits its container. WebSocket message limits, bounded queues, ACK backpressure and heartbeat cleanup govern the terminal stream.

Confirmed: model configuration selects the OpenAI or Anthropic API format. The user provides the API endpoint, model ID and key. Both protocols accept custom gateways; no preconfigured service or model catalogue is offered.

Confirmed: Test connection uses the current unsaved form values for one short official pi SDK request, with output capped at min(64, the configured output limit), a 15-second timeout and caller cancellation. It writes no settings, sessions or tasks. A saved key can be reused only for the same API format and endpoint; changing either requires a key. Gateway JSON errors become readable messages, with original and URL-encoded key values redacted.

The form uses native validation, disables editing and saving during a test, and keeps success/error feedback in its footer. Success explicitly remains unsaved until Save settings is selected. Editing clears the result. Cancel test stops only the probe and preserves the dialog and entered values; an older cancelled request cannot overwrite a newer result.

Confirmed: model capabilities are editable context capacity (contextWindow), maximum output (maxTokens), and image-input support (supportsImages). New settings start at 128000 / 16384 tokens with images off; these are editable starting values, not model presets. Both token counts must be positive integers and output cannot exceed context capacity. Context capacity drives pi model configuration and compaction budgets; the output cap enters protocol requests and may be reduced further by the SDK when context space is limited.

Capabilities persist locally and restore after a backend restart. Missing legacy context/output fields are backfilled with 128000 / 16384 respectively. A missing image flag is enabled when the legacy settings have a model ID, preserving the previous behavior, and off otherwise. When image input is disabled, the agent uses page structure and text; current browser screenshots and historical images are filtered from model requests while page text and historical text are preserved.

Confirmed: Linux/WSL deployments use a kernel flock held by a monitored child process to coordinate the control server and maintenance commands sharing a data directory. A host crash releases the lock without stale-lock cleanup. Native Windows local mode remains available; backup maintenance requires WSL.

The compiled backup CLI requires a stopped workbench and inactive project volumes. It archives the entire control-data directory and each existing full Docker workspace volume, including Git and Chromium profile data, with a versioned SHA-256 manifest. Restore validates checksums, archive paths/links and task IDs, then accepts only an empty target directory and absent same-ID volumes. Failure rolls back newly created volumes and reports cleanup failures; existing data is never intentionally overwritten. External environment files, environment-only credentials and out-of-directory local package sources require separate migration. One archive expands to at most 100 GiB. The deployment guide includes systemd/Caddy templates, setup, upgrades and recovery; actual target-host service/TLS and Docker-volume acceptance remain pending.

## Brand Commitments
The user explicitly references Manus for the task computer, preinstalled browser and observable workflow. PiCoding is the provisional project name derived from the workspace directory, not a confirmed brand.

## Product Principles
Expose real task state. Reuse pi's existing resource/package and tool capabilities. Keep provided file, command and browser operations inside the task environment, while exposing the host execution boundary of installed extensions. Show the same browser to the user and the agent. Preserve project files when a task stops. Make interrupted work resumable.

## Open Decisions
Exact final product name and preferred model provider remain undecided. Interface language is Chinese, inferred from this conversation.
