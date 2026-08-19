# Flexbox n-tree layout engine supersedes the binary SplitTree

Status: superseded by ADR-0010 (flat items model; the n-tree engine was removed)

A tab's layout is an n-tree in Wave's flexbox model (spec #32): a node is either a block (a leaf holding one Terminal Session, or an empty slot) or an ordered list of same-direction nodes; levels alternate direction (level 1 row, level 2 column, level 3 row, …); nodes carry a unitless size whose sibling ratio decides displacement; nodes are located by `IndexArr`. This replaces the binary SplitTree of ADR-0006/0007.

## Why

Hands-on review of the binary SplitTree window found the interaction logic fundamentally different from Wave: manual four-direction split buttons and content-swap dragging vs Wave's auto-placement (first row rightward, wrapping after five by nesting a column under the rightmost block) and its 7-drop-target drag (inline before/after, out-of-line inner/outer, swap), plus margin-resize instead of pair dividers. The user confirmed both the layout engine and the interaction model must be reworked to match Wave.

## Model

- `BlockNode { kind: "block", sessionId }` — one session (or null = empty slot).
- `ListNode { kind: "list", dir: "row" | "col", sizes: number[], children: Node[] }` — an ordered list of same-direction children; the sibling size ratio decides flex displacement.
- Direction alternates by depth (root list is a row).
- Pure operations: `autoPlace` (fill the first row, wrap after five), `removeBlock` (with depth compression), `dropBlock` (all 7 targets, target relocated by session id after removal), `classifyDrop` (diagonal quadrants + middle-fifth swap), `resizeNode`, `normalize` (garbage repair).
- Workspaces/tabs (ADR-0007) and host-owned sessions (ADR-0004) are unchanged; each tab's tree is now the n-tree.

## Considered Options

- **Keep the binary SplitTree**: rejected — the exact gap the user called out after review.
- **Emit the n-tree from the client only**: rejected — the host stays the authoritative whole-state owner; the schema migration (legacy binary trees reset to an empty block) is part of the host contract.

## Consequences

- Four-direction split buttons are gone; `splitH`/`splitV` keybindings auto-place an empty block; new sessions auto-place (empty block first, else top-row append).
- Drag executes all 7 drop targets with green placeholder overlays (edge strips, corner/centre quadrants, swap centre block); a divider's hover line appears after 500ms before margin drag resizes.
- The window adopts Wave's palette (`background #222`, foreground `#f7f7f7`, accent `#58c142`, border `rgba(255,255,255,.16)`, radius 8px, block gap 3px, Inter/Hack), with a documented concession: under a light DSH theme the chrome follows DSH tokens instead.
- `src/shared/splittree.mjs` and its checks are removed; `check-layout.mjs` and `check-workspace.mjs` cover the new engine.
