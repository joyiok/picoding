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

The TTY extension keeps Operate mode and the daylight-desk world (seed 9216af58). Terminal controls reuse Chinese system labels, charcoal/porcelain actions, muted helpers and crisp dividers. The monospace working surface retains terminal background #20252c and foreground #e3e8ee; cursor/selection reuse #9cd1b5 with #20252c selection text. DESIGN.md and .impeccable/design.json remain byte-for-byte unchanged; their original source-scan record is historical.

A fresh independent reviewer inspected all five contract parts and all four valid real captures: [terminal desktop](../review/terminal-desktop.png), [terminal mobile](../review/terminal-mobile.png), [read-only desktop](../review/terminal-readonly-desktop.png), and [read-only mobile](../review/terminal-readonly-mobile.png), at 1440×1000 and 390×844. The verdict was **disposition: ship**, scoped to this TTY iteration, with no material fixes. A single mechanical detector advisory for selection color was corrected to existing #9cd1b5/#20252c values; no second detector run was claimed.

All 33 tests and the final production build after the color correction passed. Coverage includes real PTY state, Chinese input, resizing, token filtering and Ctrl+C, plus real WebSocket Origin rejection, read-only enforcement, takeover, reconnect and release. Dependency remediation yielded zero reported vulnerabilities, Vite 8.3.2 and unchanged official pi SDK 1.0.0.

Real Docker image 100d9e25d127 and Playwright verified desktop/mobile Chinese keyboard input, Ctrl+C, environment-variable persistence across browser/terminal switching, and shared sessions. A nohup Python service on port 3000 started from the TTY was previewed in real Chromium and remained accessible after return and reload. All four workspace edges stayed within visible bounds, with no horizontal overflow and pageErrors=[].

The running task shell survives webpage disconnects and replays the latest 256 KiB, while environment stop ends the PTY and retains project files/Bash history. Input requires confirmed paused ownership on each host WebSocket message; returning interrupts the foreground job and waits for the prompt, preserving nohup services. Execution history and the independent command form remain alongside the lazily loaded xterm view, fit behavior, touch keys, opt-in reader mode, bounded messages/queues, ACK flow control and heartbeat cleanup.

Temporary task/container data was cleaned up and no test model keys were saved. The user's model remains unconfigured. Earlier protocol coverage used local simulated HTTP SSE services; external real model-provider integration remains untested. Model connection checks, broader recovery work and reproducible production installation/startup/automatic verification remain open. Review captures are local evidence, and no product raster assets were introduced.
