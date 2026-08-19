# Two-layer layout state: tabs only (Workspace layer removed)

Status: accepted

The layout state is `{ tabs: [{ name, tree: LayoutTree }], activeTab }`. The Workspace layer (ADR-0007) is removed: tabs are the top-level containers, served at `GET/PUT /ssh-hub/workspace` and pushed over `/workspace/events`.

## Why

The user dropped the Workspace concept after hands-on review — tabs already carry "multiple layouts" and the extra workspace level was redundant chrome (switcher button, picker layer, name/icon/color metadata). Removing it deletes the switcher UI and one schema layer.

## Consequences

- Legacy three-layer state (`{ workspaces: [...] }`) migrates by promoting the **active workspace's tabs**; other workspaces' layouts are discarded. Sessions are never owned by layout state, so nothing is lost.
- The workspace switcher (button, picker, name/icon/color, copy-layout) is gone; `Alt+1-9` / `F2` tab switching and renaming stay.
- Session/template semantics of ADR-0007 carry over unchanged: tabs never own sessions; the global Unplaced List is the source of truth.
