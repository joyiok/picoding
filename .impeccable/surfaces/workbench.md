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

The model-connection extension retains Operate mode and the daylight-desk world (seed 9216af58). Settings reuse the incumbent Chinese system typography, white fields, charcoal actions, restrained borders and semantic green. Compact footer feedback wraps long errors and stays with the existing action strip on desktop/mobile. DESIGN.md and .impeccable/design.json remain byte-for-byte unchanged; their original source-scan record is historical. No unrelated design drift was repaired and no product raster assets were introduced.

A fresh independent reviewer initially found one fix: Cancel test dismissed the dialog. One batch changed it to abort only the probe, retain the entered values and guard updates by the current controller. The same reviewer marked that single fix **RESOLVED** and returned **disposition: ship**, scoped to this model-connection iteration rather than a full-application review.

Four valid actual-app captures document success and gateway-error states at 1440×1000 and 390×844: [connection desktop](../review/model-connection-desktop.png), [connection mobile](../review/model-connection-mobile.png), [error desktop](../review/model-error-desktop.png), and [error mobile](../review/model-error-mobile.png). The actual backend and official pi SDK connected to a local deterministic SSE fixture. Playwright retested cancellation with model/key retained and Save enabled, immediate editing and a successful subsequent test. Both wire formats carried the exact user-entered model/key; pageErrors=[] and no horizontal overflow were recorded. Settings remained unchanged and actual configured=false.

All 39 tests and the production build after the model correction passed. The probe uses unsaved fields for one short official SDK request, limits output to min(64, the user's limit), times out after 15 seconds and accepts caller cancellation, with no settings/session/task writes. Saved keys are reused only for an unchanged protocol and endpoint. Gateway JSON errors become readable, with original and URL-encoded key values redacted. Native form validation, busy-state disabling, persistent footer feedback, explicit unsaved success and edit-reset behavior are retained.

Native Node fetch now uses an explicit undici dispatcher to inherit HTTP(S)_PROXY, with PICODING_MODEL_PROXY override/none support. Existing NO_PROXY entries and mandatory localhost/127.0.0.1/::1 bypass keep worker credentials direct. A real local forward proxy and native fetch verified this path. pi-ai and undici are explicit dependencies; the environment example documents model proxy configuration. One whole-stylesheet detector run reported 15 pre-existing advisories outside the new connection rules; no second run or drift fixes were claimed.

No test keys were saved and the user's model remains unconfigured. Model requests were validated against local deterministic protocol fixtures; external real providers remain untested. Broader execution recovery and reproducible production installation/startup/automatic verification remain open and belong to later iterations. Review captures are local evidence only.
