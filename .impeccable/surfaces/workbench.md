# Workbench

Mode: Operate. Primary artifact: web/App.tsx. The user has pinned a Manus-like task computer and selected direct implementation of a local single-user workbench. Chinese interface. This surface must make task state, execution and the shared browser visible together.

Grounded systems considered: a two-monitor developer desk, browser DevTools, a notebook with executable cells, a patch review station, an operations runbook, a terminal multiplexer, and a task-computer control room. The last system is the assigned grounded direction. Seed: 9216af58. The roll ran degraded without catalog challengers or quality boards; no network permission was available. The user-pinned task/computer workflow constrains its topology.

## Direction contract

THESIS: A visible task computer beside a continuous conversation. The browser is the working artifact, not an illustration. Avoid a metrics dashboard or marketing shell.

OWN-WORLD: A daylight desk with porcelain canvas, neutral gray chrome, charcoal controls, and semantic green for readiness. System sans for readable Chinese; monospace only for code and commands. Crisp dividers, consistent 8 px controls, minimal elevation.

STORY: Configure a model and prepare Docker, describe a project, watch pi build and test it, inspect files, take the browser, and export the project. Empty and unavailable states carry actionable setup instructions.

FIRST VIEWPORT: A narrow task rail; a 38% conversation column with the composer anchored below; a 62% computer column with browser/code/terminal tabs. The browser occupies the largest rectangle. On mobile, tasks collapse to a drawer and conversation/computer switch structurally. The signature interaction is takeover: the computer's control strip changes state only after agent work settles.

FORM: Task-computer control room, candidate 7, seed 9216af58, translated to the user's confirmed Manus workflow. Motion only marks loading and changing state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish evidence

The model-connection extension retains Operate mode and the daylight-desk world (seed 9216af58). Settings reuse the incumbent Chinese system typography, white fields, charcoal actions, restrained borders and semantic green. Compact footer feedback wraps long errors and stays with the existing action strip on desktop/mobile. DESIGN.md and .impeccable/design.json remain byte-for-byte unchanged; their original source-scan record is historical. No UI changed during the subsequent production/recovery iteration. No unrelated design drift was repaired and no product raster assets were introduced.

A fresh independent reviewer initially found one fix: Cancel test dismissed the dialog. One batch changed it to abort only the probe, retain the entered values and guard updates by the current controller. The same reviewer marked that single fix **RESOLVED** and returned **disposition: ship**, scoped to this model-connection iteration rather than a full-application review.

Four valid actual-app captures document success and gateway-error states at 1440×1000 and 390×844: [connection desktop](../review/model-connection-desktop.png), [connection mobile](../review/model-connection-mobile.png), [error desktop](../review/model-error-desktop.png), and [error mobile](../review/model-error-mobile.png). The actual backend and official pi SDK connected to a local deterministic SSE fixture. Playwright retested cancellation with model/key retained and Save enabled, immediate editing and a successful subsequent test. Both wire formats carried the exact user-entered model/key; pageErrors=[] and no horizontal overflow were recorded. Settings remained unchanged and actual configured=false.

The model-connection iteration passed all 39 tests and its production build after the correction. The probe uses unsaved fields for one short official SDK request, limits output to min(64, the user's limit), times out after 15 seconds and accepts caller cancellation, with no settings/session/task writes. Saved keys are reused only for an unchanged protocol and endpoint. Gateway JSON errors become readable, with original and URL-encoded key values redacted. Native form validation, busy-state disabling, persistent footer feedback, explicit unsaved success and edit-reset behavior are retained.

Native Node fetch now uses an explicit undici dispatcher to inherit HTTP(S)_PROXY, with PICODING_MODEL_PROXY override/none support. Existing NO_PROXY entries and mandatory localhost/127.0.0.1/::1 bypass keep worker credentials direct. A real local forward proxy and native fetch verified this path. pi-ai and undici are explicit dependencies; the environment example documents model proxy configuration. One whole-stylesheet detector run reported 15 pre-existing advisories outside the new connection rules; no second run or drift fixes were claimed.

The subsequent backend production/recovery iteration passed clean npm ci (230 packages, zero reported vulnerabilities), the actual public sandbox:build command, and final npm run verify (41/41 tests plus the production build after the worker signal fix). The build wrapper forwards only standard HTTP(S)/NO_PROXY build arguments, uses host build networking for Linux loopback proxies unless PICODING_BUILD_NETWORK overrides it, and honors the configured image name. Final image: 3401b4807aa9. Doctor reported Node 22.22.1, Docker/image and model proxy ready; the actual user's model remains unconfigured.

Production integration launched the real built node dist/server/index.js with private mkdtemp settings/sessions, a fictional environment key and a deterministic local SSE provider. It passed production HTML/JS/CSS, the official pi four-tool loop (sandbox_write, Bash Python service on port 3000, browser navigate/click with counter=1), live SSE, the real noVNC page, absence of host keys in worker environment, real terminal WebSocket takeover/release, and tar.gz export excluding .git/.picoding/node_modules.

Recovery checks passed occupied-port startup (exit 1 without touching an existing task), graceful server/container restart with file content, tool history, prior pi prompt/tool IDs and Chromium localStorage counter=1 retained, redacted 401 error followed by successful retry, and a hanging request aborted and resumed. SIGKILL left the task container running; new startup restored its stopped task, removed only the exact owned interrupted container and retained the volume/restarted files. Startup acquires the listening port before cleanup. Shutdown cancels sandbox/import/baseline initialization, does not execute pending prompts and retains the original request for retry without a duplicate user message.

A real profile-persistence regression exposed competing Playwright and worker signal cleanup. Worker-owned idempotent context closure now handles shutdown with Playwright signal handlers disabled; Docker stops gracefully for five seconds before removal. The real Chromium persistence check passed after that correction. Port/max-task positive-integer and CPU-positive validation are enforced, and doctor validates model proxy configuration without printing model keys.

The production script finished PASS with 10 local model requests. Temporary tasks, containers, volumes and private data were cleaned up; actual user settings/data were unchanged. npm run verify reproduces tests/build, and npm run test:integration rebuilds and runs the real production acceptance script. All finite local single-user roadmap flows are now implemented and tested in Linux/WSL with Docker. Background services and the PTY naturally require restart after environment shutdown. External real providers and installation on other operating systems remain unverified; snapshots/branches, multi-user and cloud scheduling stay outside local scope. These backend results do not broaden the single-resolved-fix UI verdict above. Review captures are local evidence only.
