# Three-layer workspace model: workspaces of tabs of split trees

Status: **superseded in part by ADR-0009** — the Workspace layer was removed (tabs are now the top-level containers); this ADR's session/template semantics carry over.

The terminal layout state is a workspace collection — `{ workspaces: [ { name, icon, color, tabs: [ { name, tree: SplitTree } ], activeTab } ], activeWorkspace }` — served whole at `GET/PUT /ssh-hub/workspace` and pushed over `/workspace/events`. This replaces the single global tree of ADR-0006.

## Why

Hands-on review of the single-tree Terminal Window found it lacked the organizational layer the user wanted, following Wave Terminal ([keybindings](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/keybindings.mdx), [workspaces](https://raw.githubusercontent.com/wavetermdev/waveterm/main/docs/docs/workspaces.mdx)): separate monitoring layouts could not be kept around, and there was no tab bar or workspace switcher. The three-layer model gives each workspace a set of tabs, each tab a split tree of Blocks.

## Workspaces are layout templates, not session containers

The deliberate deviation from Wave: a workspace is pure layout (named/iconed/colored tab set) and never owns sessions. Sessions live in the global unplaced list — the single source of truth — and are bound to Block leaves on demand. Switching workspaces, closing a tab, or deleting a workspace keeps every session running in the list; only an explicit kill (or deleting the server) ends one. There is no "save" concept and nothing is persisted to disk: workspaces are host-resident in memory, matching the session registry's lifecycle (ADR-0004).

## Considered Options

- **Keep the single tree (ADR-0006)**: rejected — no tabs/workspaces, the exact gap the user called out.
- **Two layers (single workspace, multiple tabs)**: rejected — the user chose three layers outright (workspace switcher included).
- **Tabs as session lists (Dock-era)**: rejected — the tree is the organization; unplaced sessions live in the global list.

## Consequences

- Layout copy (new workspace "copy current") copies structure only — bindings are cleared, so a session is never bound twice.
- The client renders the active (workspace, tab) tree via `activeTree` / `setActiveTree`; block interactions are unchanged by the state shape.
- Block magnify is a subtree view: writes land back at the magnified path (`replaceSubtree`), so splitting inside a magnified block mutates the tree.
- The single-tree endpoints (`/tree`, `/tree/events`) are removed; previous tree state resets to one workspace with one empty-block tab.
