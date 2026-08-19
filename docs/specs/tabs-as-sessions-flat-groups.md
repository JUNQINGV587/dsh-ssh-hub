# Tabs-as-sessions with mergeable groups: workspaces as flat side-by-side groups

## Problem Statement

After hands-on review the user finds the tab-of-n-tree model (spec #32) mismatched to how they want to work. What they actually want is simpler: one tab = one session shown full-window, and tabs can be merged into groups (workspaces) shown side-by-side. The n-tree layout engine (nested rows/columns, auto-place, 7 drop targets, nested hierarchies) is overkill for this — the model the user wants has no nesting at all: groups are flat side-by-side member lists.

## Solution

Adopt a "tabs are sessions, groups are workspaces" model:

- **One tab = one session**, shown full-window.
- **Drag a tab onto another tab to merge**: the two become a **workspace** — a group whose members display side-by-side. Merging is unlimited in count.
- **A workspace shows its members side by side** (left-right or top-bottom, switchable per workspace); member sizes are draggable (equal by default).
- **A workspace appears in the tab bar as a combined tab** (renamable via F2) and, when selected, shows its members in the window.
- **A workspace can be created directly in the window** via a "new group" affordance (pick sessions to combine).
- **Closing a tab or ungrouping a workspace returns the sessions to the global unplaced list** — they keep running; only an explicit ✕ in the list ends a session.
- The n-tree layout engine is retired: no nesting, no auto-place, no out-of-line drop targets. Drag semantics reduce to inline-before/inline-after/swap (move/reorder within a group or reorder tabs).
- Existing Wave visual direction, window chrome, block magnify (magnify = a workspace member fills the window), configurable Alt keybindings, and host-owned sessions all stay.

## User Stories

1. As an SSH operator, I want each tab to be one session shown full-window, so that the tab bar reads as a session list.
2. As an SSH operator, I want to drag a tab onto another tab to merge them into a workspace, so that pairing servers is one gesture.
3. As an SSH operator, I want a merged workspace to show its members side-by-side in the window when selected, so that I can watch several sessions at once.
4. As an SSH operator, I want to switch a workspace between left-right and top-bottom, so that the split direction fits the content.
5. As an SSH operator, I want to drag the divider between workspace members to adjust their sizes, so that a main machine can be wider than a monitor.
6. As an SSH operator, I want to merge as many tabs as I like into a workspace, so that a monitoring group can grow without a cap.
7. As an SSH operator, I want to create a workspace directly (pick several sessions to combine), so that building a group does not require tab-dragging first.
8. As an SSH operator, I want to ungroup a workspace back into individual tabs (and drag members out), so that grouping is reversible.
9. As an SSH operator, I want closing a tab or ungrouping a workspace to never kill a session — it returns to the global list — and only the list's ✕ ends one.
10. As an SSH operator, I want workspace member drag to offer only meaningful targets (move before/after a sibling, swap), so that placement is predictable.
11. As an SSH operator, I want the magnify behaviour, tab switching (Alt+1-9), F2 rename, and configurable keybindings to keep working on the new model.

## Implementation Decisions

**State model (host, `/ssh-hub/workspace`, whole-state as today)**

- `{ items: [ Tab | Workspace ], activeIndex }` where
  - Tab = `{ kind: "tab", sessionId, name }` (one session, full-window)
  - Workspace = `{ kind: "workspace", name, orientation: "h" | "v", members: [{ sessionId, name }] }` (a flat side-by-side group; `sizes: number[]` per member for the adjustable ratios, default equal).
- The workspace collection schema replaces the tab-tree shape; on migration, existing tabs that hold layout trees are flattened — each leaf session becomes its own tab (sessions are never owned by layout state, so nothing is lost).
- The global unplaced list stays the single source of truth (sessions not in any item).

**Pure module (replaces layout.mjs)**

- `group.mjs`: tab/group operations only — merge (tab+tab → workspace), ungroup (workspace → its member tabs), addMemberToGroup, removeMemberFromGroup, reorderWithinGroup (move before/after a sibling), swapMembers, setOrientation, setSize, normalize (garbage repair, unknown sessions emptied), migration flatten of legacy trees.
- No nesting, no auto-place, no out-of-line targets. Drag targets: inline-before / inline-after / swap.

**Client**

- Tab bar renders items: a tab shows the session label; a workspace shows a combined label (name + member count). Selecting a tab shows its session full-window; selecting a workspace shows its members side-by-side (orientation switch button on the workspace view, dividers draggable).
- Tab drag: onto another tab merges into a workspace; onto a workspace tab appends a member; within a workspace view, member drag reorders/swaps.
- New-group affordance (tab bar right icon): pick sessions to combine into a workspace.
- Ungroup: the workspace tab's ✕ dissolves into member tabs; dragging a member out of a workspace view drops it back as an individual tab.
- Magnify: in a workspace view, a member can magnify to fill the window (same subtree-view behaviour, via the group member).
- The right sidebar (server list + unplaced session list) is unchanged and remains the placement surface.

**Deliberately kept**

- Host-owned sessions, the global unplaced list, the window chrome (drag/resize/maximize/animation/focus-dimming), Wave visual tokens, the right sidebar, block numbers/magnify, configurable keybindings (newTab / closeTab / magnify / etc.).

## Testing Decisions

A good test drives the pure group module (merge/ungroup/member ops/orientation/resize/migration flatten) and the host schema through their external boundaries.

- **Seam A — pure module script (existing pattern).** A new `check-group.mjs` covers merge, ungroup, member add/remove/reorder/swap, orientation, size ratios, normalize repair, and migration flatten. Prior art: `scripts/check-layout.mjs` (removed alongside the n-tree engine).
- **Seam B — host integration (existing).** `tests/integration.mjs` workspace section is rewritten for the items model (round-trip, repair, broadcast, migration flatten of legacy trees, dead-session clearing). Prior art: current workspace tests.
- Client interaction (tab drag merge, workspace view, group creation) is verified by build smoke-test + browser automation (Playwright available) + manual walkthrough.

## Out of Scope

- Any nesting or recursive layout (groups are flat member lists).
- Auto-place behaviour (groups are built by explicit merge/group-create actions only).
- Out-of-line drop targets (inner/outer) — meaningless without nesting.
- Wave's non-terminal widgets, command palette, connection switcher, multi-input mode (unchanged deferrals).

## Further Notes

- This is the third layout-model revision: single-tree (#25/#26) → n-tree (#32/#33) → flat tabs + groups (this spec). Each earlier ticket is closed and recorded; the group model deliberately inherits only the working chrome and visual tokens.
- The migration from n-tree is a flatten: each leaf session in every tab becomes its own tab (no sessions are ever lost because the host owns sessions, not layout).
- Documentation to update: CONTEXT.md (Tab gains the session meaning; Workspace becomes the flat group; Layout Tree entry removed), a new ADR (flat groups supersede the n-tree engine), README (en+zh).
