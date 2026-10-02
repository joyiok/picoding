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

The project-entry/import/upload extension keeps the Operate mode and daylight-desk world (seed 9216af58). Project.tsx reuses the native settings dialog, Chinese system typography, 16px dialog corners, 7px fields, charcoal primary controls, muted helpers, and border-based grouping. Upload controls use the existing neutral chrome and dividers. DESIGN.md and .impeccable/design.json remain byte-for-byte unchanged; their original source-scan record is historical.

The independent review first requested three fixes. One bounded correction batch resolved all three, and the same reviewer returned **disposition: ship** for that correction scope. Valid local captures cover [entry desktop](../review/project-entry-desktop.png), [entry mobile](../review/project-entry-mobile.png), [import desktop](../review/project-import-desktop.png), [import mobile](../review/project-import-mobile.png), [upload desktop](../review/project-upload-desktop.png), and [upload mobile](../review/project-upload-mobile.png), at 1440×1000 and 390×844.

All 30 backend tests and the final production build passed. Real Playwright plus Docker verification imported octocat/Hello-World on master and read its Hello World README; uploaded three folder files while ignoring two reserved entries; preserved binary bytes 00ff80010203; and retained the original file on collision. The mobile entry was visible in the first viewport, workspace creation preserved unsent composer text, stopped-task headings/captions matched state, pageErrors=[] and no horizontal overflow was found. Playwright external HTTPS through the authenticated loopback proxy relay and container-local localhost bypass both passed; task computers retain bridge isolation.

Temporary containers and task data were cleaned up. Actual user model settings remain unconfigured and no test key was saved. Earlier real pi SDK coverage used local simulated OpenAI/Anthropic HTTP SSE services; external real model-provider integration remains untested. The captures are local review evidence, and no product raster assets were introduced. TTY terminal work and production-startup reproducibility remain outside this finished iteration.
