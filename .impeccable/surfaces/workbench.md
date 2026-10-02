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

The original source finish resolved the eight scored findings and exclusive file-creation regressions, with a source-only ship verdict. The capability-settings extension retains Chinese system typography, the 16px native dialog, 7px fields, muted placeholders, and charcoal primary/porcelain secondary buttons. It adds a two-column numeric row and a native image-input checkbox inside a scrolling form body, with actions outside the scroll region. DESIGN.md and .impeccable/design.json remain unchanged; their initial source-scan evidence records the earlier capture.

The earlier protocol-settings review returned ship. The current independent review is scoped to model capability settings and returned **disposition: ship**, with all five contract parts complete and no pending findings. Real [desktop (1440×1000)](../review/capabilities-desktop.png), [mobile (390×844)](../review/capabilities-mobile.png), and [mobile footer (390×844)](../review/capabilities-mobile-bottom.png) captures passed; no horizontal overflow was found and the action footer remains visible. Real browser form-submission checks intercepted POST, preserving actual user settings and avoiding saved test keys.

All 22 tests and the final production build passed, including the final compatibility scenario. The real pi SDK exercised OpenAI Chat Completions and Anthropic Messages against local simulated HTTP SSE services, using configured addresses, custom model IDs, and credentials without a preset model list. Coverage includes output limits, persisted capability values, legacy migration, invalid-value rejection, and both image-toggle states in the pi tool loop, preserving page text. With images.blockImages = !supportsImages, both actual protocol requests preserved historical text and excluded historical images recorded through the real SessionManager. New settings use editable 128000 / 16384 limits with images off; configured legacy settings retain their prior image behavior. Context capacity reaches the pi model and compaction budgets, and output limits reach API requests subject to further SDK adjustment for remaining context.

Earlier runtime verification built Docker image picoding-sandbox:local (ID c37574e1eebc). The real sandbox ran as uid 1000; Node.js, Python, Git, and file write/read checks succeeded. Environment restart preserved project files and started Chromium; navigation and automatic clicking succeeded ([browser capture](../review/sandbox-browser.jpg)). noVNC connected a 1280×800 canvas; real remote keyboard input navigated to ?manual=2, with pageErrors=[] and zero required desktop-resource failures ([live task capture](../review/live-task-desktop.png)). UI return restored ready. The tar.gz export included project files and excluded .git/.picoding. Temporary tasks, containers, and volumes were cleaned up.

The workbench remains at http://localhost:5173 in the background. No actual user configuration was changed by the form tests, and no test API Key was saved. External real model-provider integration remains untested; protocol coverage used local simulated services. Review screenshots are evidence artifacts; the product retains source-defined SVG icons and geometry.
