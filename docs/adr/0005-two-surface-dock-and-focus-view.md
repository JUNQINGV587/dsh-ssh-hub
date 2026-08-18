# Two-surface layout: in-flow Dock plus frame-wide Focus View

Status: accepted

The plugin's terminal UI becomes two surfaces sharing global state. The **Dock** is a workbench rendered in the layout flow of `conversation.input.dock` (above the composer), pushing conversation content up instead of covering it; it holds the tab strip and at most a two-way split. The **Focus View** is a single frame-wide surface registered in `shell.overlay` (root scope), isolated from the conversation, hosting the full Grid of up to four Tiles. Terminal Sessions and Grid state (template + pin assignments) are global — every Dock attaches to the same world.

## Why

The old panel was a `position:fixed` overlay inside a slot that already offers an in-flow row; covering conversation content was the root of the "layout feels wrong" complaint. DSH has no router or floating-window-manager slot, so a standalone page or desktop-style floating windows are not available; `shell.overlay` is the only frame-wide seat and is explicitly offered for this purpose.

## Considered Options

- **Self-built floating windows inside `shell.overlay`**: rejected for now — custom drag/resize/z-order/minimize is the highest cost and the lowest value on 13" screens; the architecture does not preclude adding it later.
- **Per-conversation sessions and Grid state**: rejected — users set up terminals in one conversation and keep watching them in another; per-conversation state would make switching conversations feel like losing the world.
- **tmux-style manual tiling** for the Grid: rejected in favor of preset Layout Templates (single / left-right / top-bottom / 2×2 / one-large-two-small, max 4 Tiles). The use case is monitoring ("everything visible, evenly sized"), not precise pane geometry; templates cost roughly a third of the implementation.

## Consequences

- Ctrl+` toggles the Dock; Ctrl+Shift+` (or the Dock toolbar button) enters/exits the Focus View; Esc exits it. Focus View toolbar has parity with the Dock (new session, server drawer, theme cycle, template switch). A small entry button in `sidebar.footer.action` (the only incremental sidebar seat; CordisPanel precedent) opens the Focus View — the left column itself is off-limits: `sidebar` and `sidebar.workspaces` are single, occupied, and replacing them shadows shipped UI; a ~260px column cannot hold an 80-column terminal anyway.
- The Dock follows the slot's hiding semantics: when the composer chain hides the input zone (e.g. a user-questions takeover), the Dock hides with it — sessions stay alive on the host and the Focus View is unaffected.
- On narrow viewports, excess Tiles degrade automatically: their sessions return to the tab strip without disconnecting.
- Small screens are deliberately steered toward the Focus View rather than toward growing the Dock taller.
