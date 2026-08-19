# Split-tree window model replaces the Dock and the preset-template Grid

Status: accepted

The terminal surface is a single floating **Terminal Window** registered in `shell.overlay` (root scope), backed by one global **workspace Split Tree**. The Dock (`conversation.input.dock`), the preset-template Grid (single / split-h / split-v / grid-4 / main-2), and the Focus View as a separate surface are removed. The window maximizes into the full frame; windowed and maximized are two viewports over the same tree.

## Why

Hands-on review of the Dock-based two-surface design (ADR-0005) found the Dock's real-estate behavior unsatisfying, and moving it "below the composer with full width" is impossible — the only slot under the composer is a centred ~764px column, and breaking out of it with CSS would reintroduce the overlay-covering problem the in-flow Dock was created to avoid. The user then chose the Wave Terminal model ([Wave keybindings](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/keybindings.mdx), [Wave workspaces](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/workspaces.mdx)): blocks (pane = one session) arranged by recursive splits, draggable to swap or edge-split.

## Considered Options

- **Keep ADR-0005 as built**: rejected after hands-on review.
- **CSS breakout for a full-width band under the composer**: rejected — fights the layout frame and is fragile across DSH upgrades.
- **Preset templates**: rejected — the user wants split actions (left/below), not template choices; keeping both would mean maintaining two layout models.
- **Tab bar as a session list** (old model): rejected — the tree is the organization; sessions not placed in the tree live in an unplaced list panel.

## Consequences

- Window chrome is self-built (drag with viewport clamping, corner resize, double-click maximize, scale+fade open animation respecting `prefers-reduced-motion`, focus dims the frame only — terminal content stays readable).
- Block drag: drop on a block's centre swaps the two sessions; drop on a 20% edge band opens a new pane in that direction (RGB-coded preview: red=left, green=right, cyan=top, blue=bottom).
- Shortcuts are configurable in the settings card (toggle window, maximize), stored in localStorage, applied on every keydown.
- Sessions remain host-owned (ADR-0004): closing the window or removing a block never kills a session — it returns to the unplaced list; the host reaps only after the idle timeout.
- The old `/grid` endpoints are replaced by `/tree` (GET/PUT + `/tree/events`); existing grid state resets to a single empty leaf.
