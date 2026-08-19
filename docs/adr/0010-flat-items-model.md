# Flat items model supersedes the n-tree layout engine

Status: accepted

The layout state is `{ items: [Tab | Workspace], activeIndex }` (module
`src/shared/group.mjs`):

- **Tab** = one Terminal Session, full-window, with its own name.
- **Workspace** = a flat side-by-side group of sessions: one orientation
  (`h` | `v`), one draggable divider between members, unitless `sizes`.

There is no nesting, no auto-place, and no out-of-line drop targets. The
n-tree engine (`src/shared/layout.mjs`, ADR-0008) and the three-layer
workspace collection (`src/shared/workspace.mjs`, ADR-0007/0009) are removed
together with their check scripts.

## Why

The user dropped the Workspace layer (ADR-0009) and then the n-tree itself
after hands-on review: the 7-drop-target / auto-place model was powerful but
hard to discover and to drive, and its UI never shipped correctly (the
`RightSidebar` that surfaced the unplaced list referenced an undefined
component for a release). The flat model keeps the parts operators actually
used — put several sessions side-by-side, resize, magnify one — with
gestures that match the mental model of tabs: merge two tabs by dragging one
onto the other, append by dragging onto a group, reorder members, dissolve a
group back into tabs.

## Consequences

- Layout state is a flat list of items; the host serves it whole at
  `GET/PUT /ssh-hub/workspace` and broadcasts over `/workspace/events`
  (`src/shared/group.mjs` is also the wire schema).
- Legacy two/three-layer state (`{ tabs: [...] }` / `{ workspaces: [...] }`
  with trees) migrates by flattening every tree leaf into its own Tab
  (`migrateLegacy` in `group.mjs`); sessions are never owned by layout
  state, so nothing is lost.
- The host drops items whose session is gone (`sanitizeWorkspaces`), and
  clears them from the collection when a session is reclaimed.
- n-tree files removed: `src/shared/layout.mjs`, `src/shared/workspace.mjs`,
  `scripts/check-layout.mjs`, `scripts/check-workspace.mjs`; `npm test` no
  longer runs them. `group.mjs` is covered by `scripts/check-group.mjs`.
- The 7 Wave drop targets and the RGB-coded drop previews are gone; member
  drag offers before/after/swap only.
