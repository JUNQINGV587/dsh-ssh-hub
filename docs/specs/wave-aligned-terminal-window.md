# Wave-aligned terminal window: workspaces, tabs, block magnify, Wave keybindings

## Problem Statement

From the user's perspective, the current Terminal Window works but does not feel like Wave Terminal. After hands-on review: the floating window has no organizational layer — no tabs, no workspaces — so several monitoring layouts can't be kept around; block title bars are bare (number + name only); keyboard shortcuts are not Wave's; and the look is not Wave's dark, bordered, low-saturation style. The user wants the UI/UX and interaction model to follow Wave Terminal (docs: [keybindings](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/keybindings.mdx), [workspaces](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/workspaces.mdx)).

## Solution

Rebuild the Terminal Window's organization, interaction, and look around the Wave model, keeping the plugin's host-owned-session superpower:

- **Workspaces as layout templates**: a workspace is a named, iconed, colored set of tabs (each tab a split tree of Blocks). Sessions are never owned by a workspace — they live in a global unplaced list and are bound to Blocks on demand. Switching away keeps the workspace layout as an empty-block template; sessions keep running in the list.
- **Tab bar** (Wave-style, top of the window) with per-workspace active-tab memory, `F2` rename, close-tab semantics that return sessions to the list.
- **Workspace switcher**: a button at the tab bar's left opening a picker (icon, color, name, edit/delete, new). No "save" concept — workspaces are always templates, host-resident in memory.
- **Wave-ified block title bars**: connection label + status dot + block number always visible; hover reveals close and magnify; single-click focuses the block, double-click magnifies it (the block fills the window; splitting inside a magnified block is allowed and mutates the tree; `Alt+m`/Esc restores).
- **Wave keybinding preset** (Alt-based to avoid browser Ctrl+t/w collisions, configurable in the settings card like today): new tab, close block, close tab, switch tab, show block numbers, jump to block, split, magnify.
- **Wave visual direction**: dark, rounded, bordered blocks with a clear active-block highlight, kept as close to DSH design tokens as reasonable.
- The window title bar stays (drag / double-click full-maximize), with the toolbar compressed into three icons at its right (new session / server management / session list).

## User Stories

**Workspaces**

1. As an SSH operator, I want multiple workspaces with names, icons, and colors, so that different monitoring layouts are kept apart and recognizable.
2. As an SSH operator, I want a workspace switcher at the tab bar's left, so that I can jump between layouts without leaving the terminal.
3. As an SSH operator, I want workspaces to act as layout templates, so that switching away keeps my block arrangement and I can re-instantiate it later.
4. As an SSH operator, I want switching workspaces to never interrupt my sessions — they keep running in the global list, so that my `vim`/`tail -f` survive layout changes.
5. As an SSH operator, I want to create a workspace from an empty template or by copying the current layout, so that starting fresh or cloning a setup are both one click.
6. As an SSH operator, I want deleting a workspace to delete only the layout — sessions it referenced return to the global list, so that nothing is ever lost.
7. As an SSH operator, I want each workspace to remember its own active tab, so that switching back restores where I was.

**Tabs**

8. As an SSH operator, I want a Wave-style tab bar at the top of the window, so that multiple block layouts coexist inside one workspace.
9. As an SSH operator, I want `Alt+t` to open a new tab with a single empty block, so that I can build a fresh layout.
10. As an SSH operator, I want `Alt+Shift+w` to close the current tab, returning all its block sessions to the global list (they keep running), so that closing a tab never kills work.
11. As an SSH operator, I want `F2` to rename the current tab, so that tab names describe their purpose.
12. As an SSH operator, I want `Alt+1-9` and `Alt+Tab`-style switching between tabs, so that keyboard-only users move quickly.
13. As an SSH operator, I want the tab bar to stay in sync with the host state across conversations, so that tabs are the same everywhere.

**Blocks**

14. As an SSH operator, I want each block's title bar to always show the connection label, a status dot, and the block number, so that I can read a grid at a glance.
15. As an SSH operator, I want hover on a block title bar to reveal close and magnify, so that actions are discoverable without permanent clutter.
16. As an SSH operator, I want single-clicking a title bar to focus the block, so that keystrokes go where I intend.
17. As an SSH operator, I want double-clicking a title bar (or `Alt+m`) to magnify the block to fill the window, so that I can focus one machine without losing the layout.
18. As an SSH operator, I want to keep splitting inside a magnified block, so that a deep dive can still become a sub-layout.
19. As an SSH operator, I want `Ctrl+Shift` to reveal block numbers and `Ctrl+Shift+1-9` to jump to a numbered block, so that large grids are keyboard-navigable.
20. As an SSH operator, I want removing a block to return its session to the global list (not kill it), so that host-owned sessions stay the default.

**Sessions and the global list**

21. As an SSH operator, I want the unplaced list to be the single source of truth for all sessions, so that sessions flow between workspaces and tabs without duplication.
22. As an SSH operator, I want empty blocks to offer "place a session" and open the global list, so that placing is explicit and predictable.
23. As an SSH operator, I want closing the window, switching workspaces, or closing tabs to never end a session; only explicit actions (block ✕ then list ✕, or deleting the server) end one.

**Keybindings and configuration**

24. As an SSH operator, I want Wave-style default keybindings (Alt-based: `Alt+t` new tab, `Alt+w` close block, `Alt+Shift+w` close tab, `Alt+m` magnify, `Alt+d`/`Alt+Shift+d` split), so that the interaction feels like Wave out of the box.
25. As an SSH operator, I want every binding configurable in the settings card (the actions set grows: workspace/tab/block/split/magnify/window), so that I can adapt or reclaim keys.
26. As an SSH operator, I want bindings validated and DSH-conflict-warned as today, applied immediately.

**Visual**

27. As an SSH operator, I want the terminal window to read as a dark, rounded, bordered Wave-style surface with a clear active-block highlight, so that the look matches the interaction model.

## Implementation Decisions

**Host — three-layer workspace schema (replaces the single `/ssh-hub/tree`)**

- `GET/PUT /ssh-hub/workspace` + `WS /ssh-hub/workspace/events` (initial push + broadcast), same whole-state mechanism as the current tree endpoint. The payload is a workspace collection:
  - `{ workspaces: [ { name, icon, color, tabs: [ { name, tree: SplitTree } ], activeTab } ], activeWorkspace }`
  - The existing SplitTree module (leaves/splits/ratios) is reused unchanged for each tab's tree.
- The host is authoritative and normalizes incoming state (unknown sessions empty their leaves; garbage shapes repaired, mirroring the current tree sanitizer).
- Sessions remain host-owned (ADR-0004): the registry is the single source of truth; a workspace/tab references sessions only through block leaves. Workspaces and tabs are layout state only — removing a block, closing a tab, or deleting a workspace never kills a session.
- Host-resident in memory (same lifecycle as the current tree state): workspaces are not persisted to disk across restarts.
- Migration: the `/tree` endpoints are removed; existing tree state resets to a single workspace with one empty-block tab.

**Client — Wave-style surfaces**

- Workspace switcher: a button left of the tab bar opening a picker layer (icon + color + name rows, edit/delete on hover, new-workspace footer with empty-template or copy-current options). No save concept.
- Tab bar: Wave-style row above the block area; `F2` rename; close-tab returns sessions to the global list.
- Block title bar Wave-ified: label + status dot + number always visible; hover reveals close + magnify; single-click focus; double-click magnify; magnify is a subtree view (splits allowed inside; `Alt+m`/Esc restores).
- Window title bar: unchanged drag/double-click-maximize, right side carries three icons (new session / server management / global session list).
- Global session list panel (single source of truth), opened from the title bar icon or an empty block.

**Keybindings**

- Wave preset (Alt-based to avoid browser `Ctrl+t/w` capture): new tab `Alt+t`, close block `Alt+w`, close tab `Alt+Shift+w`, switch tab `Alt+1-9`, show numbers `Ctrl+Shift`, jump block `Ctrl+Shift+1-9`, split `Alt+d` / `Alt+Shift+d`, magnify `Alt+m`.
- The settings-card keybinding section's action set grows beyond window toggle/maximize to include the tab/block/workspace actions; parsing, validation, DSH-conflict warning, and immediate application stay as implemented.

**Visual direction**

- Terminal surface follows a Wave-like dark base (dark canvas, rounded corners, bordered blocks, clear active-block highlight) while staying as close to DSH design tokens as the two goals allow (the Terminal Area token mechanism is reused; chrome tokens are adjusted rather than replaced wholesale).

**Deliberately kept from the current implementation**

- Terminal Window as the single floating surface (ADR-0006), its chrome behaviors (viewport-clamped drag, resize, double-click maximize, open/close animation honoring `prefers-reduced-motion`, focus dims frame only), block drag swap/edge-split with RGB preview, configurable shortcut plumbing.

## Testing Decisions

A good test drives the feature through its external boundary: the workspace endpoints for host behavior, the pure tree/workspace module for layout rules. No DOM assertions; client wiring stays untested (repository posture).

- **Seam A — host integration suite (existing, extended).** `tests/integration.mjs` gains a workspace section: whole-state GET/PUT round trip; garbage repair; dead-session leaves emptied on reclaim/delete; `/workspace/events` initial push and broadcast; migration (old `/tree` returns 404). Prior art: the current tree-section tests.
- **Seam B — pure module script (existing pattern).** The SplitTree checks extend to workspace-level rules (tab set/active tab manipulation, workspace collection normalization) either by extending `check-splittree.mjs` or a sibling `check-workspace.mjs`. Prior art: `scripts/check-splittree.mjs`.
- Client behavior (switcher UI, magnify view, keybinding application) is verified by build smoke-test + manual walkthrough, matching the repository's current posture.

## Out of Scope

- Wave's command palette / connection switcher / launcher block / multi-input mode (deferred).
- Multiple windows (still one Terminal Window).
- Persisting workspaces to disk across host restarts (memory-resident; the host reaps sessions and drops layouts on restart).
- Mobile/touch-specific layouts.
- Per-workspace unplaced lists (the list stays global).

## Further Notes

- The workspace-as-template semantic (Q17) is the deliberate deviation from Wave: Wave's unsaved workspaces die with the window and kill sessions; here a workspace is pure layout and sessions are never owned by it.
- Because the global unplaced list becomes the single source of truth, the previous per-window session-list panel is promoted to global scope; the list stays accessible from the window title bar and from empty blocks.
- Documentation to update: CONTEXT.md (Workspace definition evolves from single-tree to workspace/tab/block layering; Tab gains a real meaning), a new ADR (three-layer workspace model) superseding the single-tree parts of ADR-0006, README (en+zh) rewritten for workspaces/tabs/magnify/Wave keybindings.
