---
name: PiCoding
description: "A daylight desk for coding with a visible task computer."
colors:
  canvas: "#fff"
  chrome: "#f4f5f7"
  line: "#e6e8ed"
  muted: "#626b78"
  ink: "#262a31"
  green: "#28735b"
  soft-green: "#eaf4ee"
  focus-green: "#32715e"
  terminal-focus: "#a2ceba"
  page-bg: "#f8f9fb"
  panel-surface: "#fafbfc"
  nav-hover: "#e9ecf0"
  task-selected-bg: "#e3e8e5"
  task-selected-ink: "#234c3a"
  warning: "#806327"
  warning-bg: "#f7f3e9"
  warning-dot: "#9d7a32"
  error: "#94483d"
  error-bg: "#fff0ee"
  terminal-bg: "#20252c"
  terminal-ink: "#e3e8ee"
  terminal-output: "#bdc7d3"
  dialog-scrim: "#262f3b50"
  drawer-scrim: "#242b3640"
typography:
  headline:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  title:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "17px"
    fontWeight: 550
    letterSpacing: "-0.025em"
  dialog-title:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "21px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "12px"
    fontWeight: 500
  status:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "11px"
    fontWeight: 400
  meta:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans CJK SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "10px"
    fontWeight: 400
  code:
    fontFamily: "\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.8
rounded:
  compact: "6px"
  row: "7px"
  control: "8px"
  panel: "12px"
  dialog: "16px"
spacing:
  xs: "6px"
  sm: "8px"
  control: "10px"
  row: "12px"
  md: "14px"
  lg: "16px"
  panel-gap: "22px"
  frame: "24px"
  dialog: "28px"
  wide-gap: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "#414956"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary-hover:
    backgroundColor: "#f0f3f6"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "7px"
  field-settings:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "11px"
  task-nav:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "11px 10px"
  task-nav-active:
    backgroundColor: "{colors.task-selected-bg}"
    textColor: "{colors.task-selected-ink}"
  task-status-ready:
    backgroundColor: "transparent"
    textColor: "{colors.green}"
    typography: "{typography.status}"
  computer-panel:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.panel}"
  composer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "14px 14px 10px"
  tool-call:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.row}"
  control-strip-human:
    backgroundColor: "{colors.warning-bg}"
    textColor: "#7f6326"
    typography: "{typography.meta}"
    padding: "8px 14px"
---

# Design System: PiCoding

## Overview

**Creative North Star: "The Daylight Task Desk"**

PiCoding feels like a daylight task desk: porcelain-white working surfaces, cool gray chrome, charcoal controls, and restrained green feedback. The visual system keeps the working artifact prominent and gives the surrounding interface a calm, practical density. Crisp dividers and tonal changes establish hierarchy.

Chinese system typography carries instructions, conversation, and navigation; monospace identifies executable material. Soft corners group useful work without turning every item into a card. Motion marks preparation, streaming, or a control change, and respects reduced-motion preferences. Icons and the pi mark are inline SVG; this implementation has no raster illustration layer.

This document is a scan of the implemented source and the resolved workbench brief. Browser rendering and live Docker execution remain unverified because workspace permissions blocked local sockets. The descriptions and component specimens are source evidence, not screenshot or end-to-end findings.

**Key Characteristics:**

- Porcelain canvas, neutral chrome, and charcoal action priority.
- Green readiness and connection feedback; amber human ownership; red failure.
- Readable Chinese system text paired with monospace code and commands.
- Flat working surfaces, crisp dividers, and one elevated settings dialog.
- Structural adaptation of the workbench at narrow widths.

## Colors

A cool neutral palette supports one restrained green accent. Amber and red carry operational meaning. The frontmatter is normative; the names below explain where those values belong.

### Primary

- **Readiness Green — green:** online indicators, ready/running task labels, completed tool icons, links, caret color, and useful hover feedback.
- **Soft Readiness — soft-green:** completed setup checks.
- **Focus Green — focus-green:** focus outlines on light surfaces.
- **Terminal Focus — terminal-focus:** the lighter outline for the dark terminal input.

### Secondary

- **Ownership Amber — warning:** paused task labels and the handoff notice.
- **Quiet Ownership Paper — warning-bg:** the human-control strip, handoff notice, and file-conflict notice.
- **Ownership Dot — warning-dot:** paused and human-control state markers.

These colors denote ownership and attention; they are not a secondary action-button palette.

### Tertiary

- **Failure Clay — error:** environment and task error messages.
- **Failure Paper — error-bg:** error banners and task-error containers.

Failure is shown with an icon and explanatory wording.

### Neutral

- **Porcelain — canvas:** working panels, buttons, and fields.
- **Cool Chrome — chrome:** the task rail.
- **Page Paper — page-bg:** the root background.
- **Quiet Panel Paper — panel-surface:** file-tree chrome, control strips, line-number gutters, and the empty browser frame.
- **Divider Gray — line:** the shared divider and border vocabulary.
- **Charcoal — ink:** primary text and primary controls.
- **Muted Slate — muted:** helper text, metadata, and settings-field placeholders.
- **Navigation Hover — nav-hover:** task and settings navigation feedback.
- **Selected Task Paper — task-selected-bg** and **Selected Task Ink — task-selected-ink:** the active task row.
- **Terminal Charcoal — terminal-bg**, **Terminal Text — terminal-ink**, and **Terminal Output — terminal-output:** the terminal working surface.
- **Dialog Scrim — dialog-scrim** and **Drawer Scrim — drawer-scrim:** distinct modal and navigation overlays.

**The Functional Color Rule.** Use green for readiness, connection, live execution, links, and interaction feedback. Use amber for a pause or human ownership and red for failure. Charcoal carries action priority.

## Typography

**Interface and body font:** the operating-system sans stack, with Segoe UI, Noto Sans CJK SC, and Microsoft YaHei fallbacks. No web-font dependency is present. The root size is (14px); most conversational text is smaller and uses a generous line height.

**Code font:** SFMono-Regular, Consolas, Liberation Mono, then monospace. Ordinary labels keep the interface face.

### Hierarchy

- **Headline:** the welcome question (27px, 600, 1.4 line height, -0.035em tracking). It changes to (30px) on wide desktops, (24px) in compact desktop layouts, and (25px) in the narrow layout.
- **Title:** empty-computer headings (17px, 550, -0.025em tracking); narrow layouts use (15px).
- **Dialog title:** the model-connection heading (21px, 600, -0.02em tracking), or (20px) in the narrow layout.
- **Body:** assistant conversation (13px, 1.85 line height). User messages use (1.8); composer text uses (1.7); introductory and empty-state explanations use (1.95).
- **Label:** controls and field content (12px), with primary/secondary buttons at (500) and field labels at (550).
- **Status and metadata:** task status (11px) and supporting chrome (10px); some narrow-layout captions are (9px).
- **Code:** editor content (12px, 1.8 line height); tool arguments and tool output use (10px), and terminal content uses (11px).

Conversation messages have an observed maximum measure (75ch), and the welcome introduction is shorter (39ch). These are code-authored limits, not measured rendered line lengths.

**The Chinese Reading Rule.** Use the system sans stack for Chinese interface text and conversation. Use the monospace stack for code, commands, paths, and tool arguments; keep it out of ordinary interface labels.

## Layout

The reusable spatial grammar is an anchored application shell with fixed control chrome, flexible working surfaces, and scrolling inside content regions. Use small gaps for related controls and larger gaps between work areas. The source uses the recorded spacing steps pragmatically rather than enforcing a strict eight-pixel grid.

The implemented workbench occupies the viewport (100dvh) with a desktop minimum height (600px). Its task rail is (224px) wide; the header is (67px) high. The conversation and computer share a grid with a larger computer fraction: minmax(350px, 0.88fr) and minmax(0, 1.3fr), a gap (22px), and padding (22px 24px 16px). The conversation composer stays below its scrolling history.

At compact desktop widths (1180px and below, while above 1000px), the rail is (190px), the conversation minimum is (310px), the fractions are (0.95fr / 1.1fr), and the gap is (16px). At wide desktop widths (1600px and above), the conversation minimum is (420px), the fractions are (0.8fr / 1.4fr), and the gap is (32px). A short-desktop condition (780px height or less, 1001px width or more) compresses the welcome and setup spacing.

At narrow widths (1000px and below), the workbench changes structure: conversation and computer are selected by a two-button view switch and the inactive column is hidden. The task rail becomes a drawer (250px), the header is (57px), and the shell minimum height is (480px). The closed drawer is inert; the main workspace becomes inert while it is open. Focus enters the new-task control, stays within the drawer, closes with Escape, and returns to the previous control. These details describe this surface; other screens should inherit its spatial grammar without copying its exact column composition.

The settings dialog stays centered at a maximum width (456px), bounded by the viewport minus (32px). Editor toolbar controls wrap; the file path takes its own line. Code and terminal output can scroll without forcing the application shell wider.

## Elevation & Depth

Most depth comes from cool gray chrome, white working surfaces, pale internal surfaces, and thin dividers (1px). The workspace, computer, composer, task rows, tool records, and file tree have no resting drop shadow.

### Shadow Vocabulary

- **Settings ambient:** the only authored shadow (0 18px 70px #25313b26), applied to the model settings dialog.
- **Overlay separation:** the dialog and drawer use their respective translucent scrims; the mobile drawer sits above its backdrop.

**The Flat Workspace Rule.** Working surfaces use borders and tonal separation. Reserve the ambient shadow for the modal settings dialog; do not add a shadow tier to every panel.

Motion is short and functional: button color/shadow transitions (160ms), composer border feedback (180ms), and drawer translation (200ms, ease-out). Activity dots, skeletons, and the preparing frame breathe by changing opacity from (1) to (0.45) and back over (1.5s–1.6s). Reduced-motion styles remove animation and transitions.

## Shapes

Compact controls use a restrained curve (8px). Small icon/address controls use tighter corners (6px), while task rows, settings fields, tool records, and notices use (7px). The composer, computer container, and user-message grouping use broader corners (12px); the settings dialog is softer (16px). The miniature empty browser frame has its own gentle corner (10px).

Thin borders and clipped panel content keep the work areas crisp. Task and connection markers are small circles (5px–6px). The pi mark is an inline SVG square with curved corners; interface icons use round-ended line strokes (1.6 units) on a (24-unit) viewBox.

## Components

### Buttons

The controls are compact and direct. Primary buttons use Charcoal on Porcelain text, control corners (8px), padding (10px 15px), and label weight (500). Their hover is a lighter charcoal. Secondary buttons use Porcelain, a cool gray border, and a pale hover fill. Small variants use padding (7px 9px) and text (11px), with tighter dimensions at compact widths. Ghost icon buttons use transparent surfaces, corners (6px), and padding (7px).

Interactive buttons, links, and tool summaries have a focus outline (2px) offset outward (3px). Disabled buttons use reduced opacity (0.48) and an unavailable cursor. The send button is a charcoal square (32px), with its own fully opaque pale disabled state.

### Inputs / Fields

Settings fields have Porcelain backgrounds, cool gray borders (1px), row corners (7px), padding (11px), text (12px), and a minimum height (39px). Placeholder text uses Muted Slate. Labels sit above the field; helper text sits directly below. The password-reveal control is inside the key field.

Fields receive the light-surface focus outline (2px) with an outward offset (1px). Borderless address, composer, code-editor, and terminal wrappers receive an inset focus boundary (2px, -2px offset); the terminal uses Terminal Focus. The composer also shifts its border color.

### Navigation and status

Task navigation is a full-width text row with an icon, ellipsized title, and a state dot. It uses row corners (7px), padding (11px 10px), and a minimum height (42px). Hover uses Navigation Hover; the active task uses Selected Task Paper and Selected Task Ink. Computer views use a horizontal tab strip with a charcoal underline (2px), text (12px), and a height (49px); narrow layouts use (45px).

Ready/running labels use Readiness Green; paused labels use Ownership Amber. These are text-and-dot status clusters rather than pill badges. Arrow keys move among the computer tabs; hidden tab panels are removed from layout.

### Cards / Containers

The signature computer container is a bordered Porcelain panel with panel corners (12px) and clipped contents. Its tab strip, browser toolbar, working view, and footer establish internal regions with thin dividers. The empty state uses a small browser-window outline, Chinese instructions, and the actual environment-tool names. Setup requirements appear as two actionable rows rather than a separate dashboard.

The native settings dialog uses dialog corners (16px), ambient elevation, form padding (28px), and an action row aligned to the end. The narrow layout reduces form padding to (24px).

### Conversation composer

The composer is a bordered Porcelain container with panel corners (12px), padding (14px 14px 10px), a growing borderless textarea, metadata, and a square send/stop control. The textarea grows up to (180px). Enter sends, Shift+Enter inserts a newline, and Chinese IME composition does not trigger submission. Running and human-control states change the prompt and control availability.

### Tool records and code surfaces

Tool execution appears as a native disclosure with row corners (7px), a divider-colored border, summary padding (10px), and monospace arguments. Output sits on a pale surface with a maximum height (220px), wraps long content, and scrolls. Expanding the disclosure exposes real execution detail.

The file editor uses a flat white surface, pale line-number gutter, and monospace content. Change notices use Ownership Paper; the comparison panel preserves the local draft below the disk version. Added and removed lines use semantic green and clay hues. The terminal is the deliberate dark working surface with green prompt marks and muted light output.

### Browser ownership

The same task browser is viewed inside the computer container. When pi owns it, the address field is read-only and the desktop is view-only. The takeover action is unavailable during a pending switch or settling state. The human-control state uses Ownership Paper, changes the Chinese strip wording, makes navigation editable, and exposes the return action. Color and wording change after the task reaches the confirmed paused state.

The sidecar contains five self-contained visual specimens of these source components. They expose native hover, focus, text entry, or disclosure behavior where applicable; task actions, tab switching, and backend state remain implemented in React.

## Do's and Don'ts

### Do:

- **Do** use the named porcelain, chrome, charcoal, and semantic state colors from the frontmatter.
- **Do** retain the system CJK sans stack and the separate code stack.
- **Do** use compact control corners, broader panel corners, and the softer dialog corner.
- **Do** preserve visible focus boundaries on borderless field wrappers and the lighter terminal focus color.
- **Do** adapt the workbench with its structural conversation/computer switch and managed task drawer.
- **Do** let setup, unavailable, loading, and ownership states explain the next useful action in Chinese.
- **Do** disable animations and transitions when reduced motion is requested.

### Don't:

- **Don't** use semantic green, amber, or red as general decorative backgrounds.
- **Don't** introduce decorative imagery, gradients, or heavy panel shadows into this visual system.
- **Don't** substitute a promotional illustration for the working browser artifact.
- **Don't** let hidden panels or a closed drawer retain keyboard interaction.
- **Don't** imply that human control has begun while the task is still settling.
- **Don't** describe source-derived component specimens as browser-verified output.

