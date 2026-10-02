# PiCoding

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Confirmed by the user: TypeScript, React + Vite frontend, Node.js backend, official pi coding-agent SDK, Linux + Docker task environments with Chromium, Git, Node.js and Python.

## Users
Confirmed: a local, single-user coding workbench. The user describes tasks in Chinese and wants to see and take over the agent's browser.

## Product Purpose
Give pi a task computer: real files, shell execution and a preinstalled browser, all controlled from a Web workbench. Success is a complete task from a natural-language request through code changes, execution, browser verification and downloadable artifacts.

## Operating Context
Runs on the user's machine with a Docker daemon. Each task has its own container and persistent project volume. The Web server manages pi sessions. Tools operate inside the container. The browser shown to the user is the browser controlled by pi.

## Capabilities and Constraints
Task creation and history; streamed agent messages and tool calls; isolated project files and commands; preinstalled Chromium; live viewing and human takeover; code editing and diffs; project export. Model API credentials are provided by the user. This first version has no account system or multi-user deployment. Docker is required for task execution.

Confirmed: a blank workspace or public HTTP(S) Git import can be created without model credentials; Docker and the task image are required. Git import accepts an optional branch, finishes before workspace Git baseline initialization, and retains pendingImport after failure for retry without overwriting an existing project. Agent execution still requires the user's model configuration.

Confirmed: file and folder uploads preserve binary bytes and relative subdirectories, with a 10 MiB per-file limit and at most 1000 selected files per batch. The UI excludes .git, .picoding and node_modules; the backend rejects those reserved paths. Existing files produce a 409 conflict and stay intact. Uploads preserve unsaved editor drafts.

Task networking can inherit backend HTTPS_PROXY/HTTP_PROXY or use PICODING_SANDBOX_PROXY; none disables the task proxy. A separate authenticated relay connects a loopback proxy while task containers stay on the Docker bridge. Container-local development URLs bypass the proxy.

Confirmed: model configuration selects the OpenAI or Anthropic API format. The user provides the API endpoint, model ID and key. Both protocols accept custom gateways; no preconfigured service or model catalogue is offered.

Confirmed: model capabilities are editable context capacity (contextWindow), maximum output (maxTokens), and image-input support (supportsImages). New settings start at 128000 / 16384 tokens with images off; these are editable starting values, not model presets. Both token counts must be positive integers and output cannot exceed context capacity. Context capacity drives pi model configuration and compaction budgets; the output cap enters protocol requests and may be reduced further by the SDK when context space is limited.

Capabilities persist locally and restore after a backend restart. Missing legacy context/output fields are backfilled with 128000 / 16384 respectively. A missing image flag is enabled when the legacy settings have a model ID, preserving the previous behavior, and off otherwise. When image input is disabled, the agent uses page structure and text; current browser screenshots and historical images are filtered from model requests while page text and historical text are preserved.

## Brand Commitments
The user explicitly references Manus for the task computer, preinstalled browser and observable workflow. PiCoding is the provisional project name derived from the workspace directory, not a confirmed brand.

## Product Principles
Expose real task state. Keep agent tools inside the task environment. Show the same browser to the user and the agent. Preserve project files when a task stops. Make interrupted work resumable.

## Open Decisions
Exact final product name and preferred model provider remain undecided. Interface language is Chinese, inferred from this conversation.
