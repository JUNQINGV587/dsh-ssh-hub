# Wave-aligned layout engine: flexbox n-tree, 7-drop-target drag, edge resize

## Problem Statement

The current terminal window looks Wave-ish but its layout engine is fundamentally different from Wave's. Blocks are arranged by a manual binary SplitTree (split buttons, drag to swap session contents, dividers between pairs), while Wave uses a flexbox n-tree: nodes hold an ordered list of same-direction blocks, levels alternate row/column, new blocks auto-place (row rightward, wrapping after five), blocks drag to one of **7 drop targets** (inline before/after, out-of-line inner/outer, swap), and size is adjusted by dragging block margins. The user confirmed after hands-on review that both the interaction logic and the visual style must be reworked to match Wave ([Wave layout docs](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/tabs.mdx), [Wave theme tokens](https://github.com/wavetermdev/waveterm/blob/main/tsunami/frontend/src/tailwind.css)).

## Solution

Replace the binary SplitTree with Wave's flexbox n-tree layout engine and adopt Wave's interaction and visual tokens (with a theme-following concession):

- **Layout**: a tab's layout is an n-tree — a node is either a single block (leaf) or an ordered list of same-direction nodes; levels alternate direction (level 1 row, level 2 column, level 3 row…). Nodes carry a unitless size; the ratio of sibling sizes decides displacement.
- **Auto-place**: new sessions go into the first-level row, rightward; after five across, new blocks wrap to the next level (right to left), restructuring nodes as needed.
- **Drag**: a dragged block over another shows placeholders for **7 drop targets** — the target block is divided along its diagonals: same-direction quadrants drop inline (before/after), opposite-direction quadrants drop out-of-line (outer = parent's level, inner = new nested level), and the middle fifth swaps positions. All movements except swap shift the rest of the layout.
- **Resize**: hover a block's margin to show the resize cursor and, after ~500ms, a line indicating which blocks will resize; drag the margin to resize (nodes adjust ratio).
- **Delete**: a block's top-right ✕ (always visible), right-click header menu, or Cmd+w; the tree auto-compresses depth after removal.
- **Right sidebar**: a Wave-style widget picker on the window's right edge — server list (start a new session) and the unplaced session list (place into the layout). This replaces the title-bar session icons as the placement surface.
- **Visual tokens** (extracted from Wave's `tailwind.css` `@theme`, with the user's theme-following concession): background `#222222`, foreground `#f7f7f7`, accent green `#58c142`, border `rgba(255,255,255,.16)`, panel `rgba(31,33,31,.5)`, radius 8px, Inter (sans) / Hack (mono), default font 14px, block gap 3px. In a light DSH theme the window keeps the dark Wave palette per the user's "b" choice — wait, the user chose "b" (follow DSH in light theme); the concession is: dark theme uses Wave tokens wholesale; light theme adapts (see Implementation Decisions).
- Magnify, block numbers (Ctrl+Shift+1-9), block headers (label/status/number), workspaces/tabs, host-owned sessions, the global unplaced list, and configurable Wave-style keybindings all stay.

## User Stories

1. As an SSH operator, I want new sessions to auto-place into the layout (first row rightward, wrapping after five), so that I don't have to aim at split buttons.
2. As an SSH operator, I want to drag a block onto another and see 7 distinct placeholders (inline before/after, out-of-line inner/outer, swap), so that placement matches Wave.
3. As an SSH operator, I want dropping inline to insert my block into the same row/column before or after the target, shifting the rest of the layout.
4. As an SSH operator, I want dropping out-of-line outer to place my block at the target's parent level, so that a block can leave a crowded row.
5. As an SSH operator, I want dropping out-of-line inner to nest a new level around the target, so that sub-layouts can be built.
6. As an SSH operator, I want the middle-fifth swap to exchange the two blocks' positions, preserving the rest of the layout.
7. As an SSH operator, I want to resize blocks by dragging their margins, with a hover line showing which blocks will move, so that sizing matches Wave.
8. As an SSH operator, I want a right sidebar listing servers (start a session) and unplaced sessions (place into the layout), so that adding blocks is a picker action like Wave's widget sidebar.
9. As an SSH operator, I want deleting a block (top-right ✕ / right-click / Cmd+w) to auto-compress the tree, so that empty rows/columns collapse.
10. As an SSH operator, I want the window to adopt Wave's palette (dark #222 background, green #58c142 accent, 8px radius, 3px gap, Inter/Hack), so that it looks like Wave.
11. As an SSH operator, I want the dark-theme concession: in a light DSH theme the window follows DSH tokens instead, so that it does not clash with a light GUI.
12. As an SSH operator, I want magnify, block numbers, tab/workspace switching, and configurable keybindings to keep working on the new engine.
13. As an SSH operator, I want sessions to stay host-owned: moving, nesting, or deleting blocks never kills a session — removed blocks return it to the unplaced list.

## Implementation Decisions

**Pure layout module (replaces splittree.mjs)**

- An n-tree node: `{ kind: "block", sessionId }` (leaf) or `{ kind: "list", dir: "row" | "col", sizes: number[], children: Node[] }`. Direction alternates by depth (level 1 row, level 2 col, …). Nodes are located by `IndexArr: number[]` (Wave's convention).
- Operations (pure functions): `autoPlace(tree, sessionId)` (first-level row, wrap after five), `removeBlock(tree, indexArr)` (with depth compression), `dropBlock(tree, fromArr, toArr, target: "inline-before" | "inline-after" | "outer-before" | "outer-after" | "inner-before" | "inner-after" | "swap")`, `resizeNode(tree, indexArr, size)`, `normalizeTree(json)` (garbage repair, unknown sessions emptied).
- The 7-drop-target classifier: a target block is divided along its diagonals; the same-direction quadrants map to inline before/after, the opposite-direction quadrants to inner/outer (near-centre = inner new level, near-outside = outer parent level), the middle fifth to swap. Pure function `classifyDrop(dir, x, y, w, h)`.
- Workspace collection state (workspace.mjs) stays, but each tab's `tree` becomes the n-tree (schema change for `/ssh-hub/workspace` — existing binary trees reset to a single block tab on migration).

**Host**

- `/ssh-hub/workspace` GET/PUT + `/workspace/events` unchanged in shape; only the tree schema inside tabs changes (normalize via the new module). Dead-session leaves emptied as today.

**Client**

- Block rendering: n-tree recursive renderer (list = flex row/column with margins as resize handles; block = header + terminal/empty).
- Drag: block header drag with 7-target placeholder overlay (diagonal quadrants + middle fifth highlight, Wave-style); drop executes the classified action. Placeholder visuals use Wave's drop-target presentation.
- Resize: margin hover (cursor + 500ms line preview) then drag; node sizes ratio-adjusted.
- Right sidebar: a Wave-style picker column at the window's right edge listing servers (start session) and unplaced sessions (place); openable/collapsible.
- Visual tokens: Wave palette applied for the window chrome and blocks; per the user's "b" choice, in a light DSH theme the chrome follows DSH tokens (concession documented) while the Terminal Area keeps its theme-adaptive palettes.
- Keybindings, magnify, tab/workspace switchers, session list, and the global unplaced list keep their current behavior and configuration.

**Deliberately kept**

- Workspaces/tabs (three-layer model, ADR-0007), host-owned sessions (ADR-0004), block headers (label/status/number), magnify subtree view, configurable Wave keybindings, global session list, window chrome behaviors.

## Testing Decisions

A good test drives the pure layout module (n-tree operations, drop classification, auto-place, compression) and the host schema through their external boundaries.

- **Seam A — pure module script (existing pattern).** A new `check-layout.mjs` (or an extended workspace check) covers: auto-place wrap-after-five; all 7 drop targets on sample trees; out-of-line inner/outer semantics; remove-with-compression; resize ratio adjustment; normalize repair. Prior art: `scripts/check-splittree.mjs`.
- **Seam B — host integration (existing).** `tests/integration.mjs` workspace section is extended for the n-tree schema (round-trip, repair, broadcast, migration reset of old binary trees, dead-session leaf emptying). Prior art: the current workspace tests.
- Client interaction (drop placeholders, margin resize, right sidebar) is verified by build smoke-test + browser automation (Playwright available in this session) + manual walkthrough.

## Out of Scope

- Wave's non-terminal widgets (file preview, web, AI panel) — this plugin manages SSH terminals only; the right sidebar lists servers and sessions, not arbitrary widgets.
- Wave's command palette / connection switcher / launcher block / multi-input mode (still deferred).
- Multiple windows; disk persistence of workspaces (memory-resident as today).

## Further Notes

- The binary SplitTree (splittree.mjs) is retired by this spec; existing tickets #26-#31 recorded that engine and are superseded. Workspace/session/global-list semantics (ADR-0007, ADR-0004) are unaffected.
- The theme concession (user's Q5 answer "b"): dark theme = Wave palette wholesale; light theme = chrome follows DSH tokens so a light GUI isn't jarring. The Terminal Area's own theme-adaptive palettes are untouched.
- Visual tokens are extracted from Wave's `tsunami/frontend/src/tailwind.css` `@theme` block: background `rgb(34,34,34)`, foreground `#f7f7f7`, accent `rgb(88,193,66)` (#58c142 green), border `rgba(255,255,255,.16)`, panel `rgba(31,33,31,.5)`, radius 8px, Inter/Hack, default text 14px, gap 3px.
