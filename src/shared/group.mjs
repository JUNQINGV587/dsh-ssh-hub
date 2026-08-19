/**
 * Pure flat-group module — tabs-as-sessions (spec #38, ADR-0009 revision).
 *
 * The state is `{ items: [Tab | Workspace], activeIndex }`:
 *   Tab       = { kind: "tab", sessionId, name }           (one session, full-window)
 *   Workspace = { kind: "workspace", name, orientation: "h"|"v",
 *                 members: [{ sessionId, name }], sizes: number[] }   (flat group)
 *
 * No nesting, no auto-place, no out-of-line targets: groups are flat member
 * lists. Drag targets are inline-before / inline-after / swap. Sessions are
 * never owned here — items reference them; callers clear dead sessions.
 * The module is DOM-free and doubles as the wire schema for /ssh-hub/workspace.
 */

/**
 * @typedef {Object} TabItem
 * @property {"tab"} kind
 * @property {string} sessionId
 * @property {string} name
 *
 * @typedef {Object} WorkspaceItem
 * @property {"workspace"} kind
 * @property {string} name
 * @property {"h"|"v"} orientation
 * @property {{sessionId: string, name: string}[]} members
 * @property {number[]} sizes
 *
 * @typedef {Object} GroupCollection
 * @property {(TabItem|WorkspaceItem)[]} items
 * @property {number} activeIndex
 */

export function defaultCollection() {
  return { items: [], activeIndex: 0 };
}

const normName = (v, d) => (typeof v === "string" && v.trim().length > 0 ? v : d);

export function normalizeCollection(input) {
  if (input === null || typeof input !== "object" || !Array.isArray(input.items)) return defaultCollection();
  const seen = new Set();
  const items = input.items
    .map((it) => {
      if (it?.kind === "tab" && typeof it.sessionId === "string") {
        if (seen.has(it.sessionId)) return null;
        seen.add(it.sessionId);
        return { kind: "tab", sessionId: it.sessionId, name: normName(it.name, it.sessionId) };
      }
      if (it?.kind === "workspace" && Array.isArray(it.members)) {
        const members = it.members
          .filter((m) => m !== null && typeof m === "object" && typeof m.sessionId === "string" && !seen.has(m.sessionId))
          .map((m) => {
            seen.add(m.sessionId);
            return { sessionId: m.sessionId, name: normName(m.name, m.sessionId) };
          });
        if (members.length === 0) return null;
        const sizes = Array.isArray(it.sizes) && it.sizes.length === members.length ? it.sizes.map(Number) : members.map(() => 1);
        const orientation = it.orientation === "v" ? "v" : "h";
        return { kind: "workspace", name: normName(it.name, "组合"), orientation, members, sizes };
      }
      return null;
    })
    .filter((it) => it !== null);
  const activeIndex = Math.min(Math.max(0, Math.round(Number(input.activeIndex) || 0)), Math.max(0, items.length - 1));
  return { items, activeIndex };
}

/** Merge the item at `a` into the item at `b` (both indexes into items). */
export function merge(collection, a, b) {
  if (a === b || a < 0 || b < 0 || a >= collection.items.length || b >= collection.items.length) return collection;
  const src = collection.items[a];
  const dst = collection.items[b];
  const items = [...collection.items];
  if (dst.kind === "workspace") {
    // append src (tab) as a member
    if (src.kind !== "tab") return collection;
    items[b] = {
      ...dst,
      members: [...dst.members, { sessionId: src.sessionId, name: src.name }],
      sizes: [...dst.sizes, 1],
    };
    items.splice(a, 1);
    return { items, activeIndex: adjustActive(collection.activeIndex, a, items.length) };
  }
  // tab + tab -> workspace
  items[b] = {
    kind: "workspace",
    name: "组合",
    orientation: "h",
    members: [
      { sessionId: dst.sessionId, name: dst.name },
      { sessionId: src.sessionId, name: src.name },
    ],
    sizes: [1, 1],
  };
  items.splice(a, 1);
  return { items, activeIndex: adjustActive(collection.activeIndex, a, items.length) };
}

/** Dissolve a workspace back into its member tabs (in place). */
export function ungroup(collection, wsIdx) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace") return collection;
  const tabs = it.members.map((m) => ({ kind: "tab", sessionId: m.sessionId, name: m.name }));
  const items = [...collection.items];
  items.splice(wsIdx, 1, ...tabs);
  return { items, activeIndex: collection.activeIndex };
}

/** Append a tab as a member of the workspace at `wsIdx`. */
export function addMember(collection, wsIdx, member) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace") return collection;
  const items = [...collection.items];
  items[wsIdx] = { ...it, members: [...it.members, { sessionId: member.sessionId, name: normName(member.name, member.sessionId) }], sizes: [...it.sizes, 1] };
  return { ...collection, items };
}

/** Remove a member; a workspace with one member left demotes to a tab. */
export function removeMember(collection, wsIdx, memberIdx) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace" || memberIdx < 0 || memberIdx >= it.members.length) {
    return { collection, member: null };
  }
  const member = it.members[memberIdx];
  const members = it.members.filter((_, i) => i !== memberIdx);
  const sizes = it.sizes.filter((_, i) => i !== memberIdx);
  const items = [...collection.items];
  if (members.length === 1) {
    items[wsIdx] = { kind: "tab", sessionId: members[0].sessionId, name: members[0].name };
  } else {
    items[wsIdx] = { ...it, members, sizes };
  }
  return { collection: { ...collection, items }, member };
}

export function reorderMember(collection, wsIdx, from, to) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace" || from === to || from < 0 || from >= it.members.length || to < 0 || to >= it.members.length) return collection;
  const members = [...it.members];
  const sizes = [...it.sizes];
  const [moved] = members.splice(from, 1);
  const [movedSize] = sizes.splice(from, 1);
  members.splice(to, 0, moved);
  sizes.splice(to, 0, movedSize);
  const items = [...collection.items];
  items[wsIdx] = { ...it, members, sizes };
  return { ...collection, items };
}

export function swapMembers(collection, wsIdx, i, j) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace" || i === j || i < 0 || i >= it.members.length || j < 0 || j >= it.members.length) return collection;
  const members = [...it.members];
  const sizes = [...it.sizes];
  [members[i], members[j]] = [members[j], members[i]];
  [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
  const items = [...collection.items];
  items[wsIdx] = { ...it, members, sizes };
  return { ...collection, items };
}

export function setOrientation(collection, wsIdx, orientation) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace" || (orientation !== "h" && orientation !== "v")) return collection;
  const items = [...collection.items];
  items[wsIdx] = { ...it, orientation };
  return { ...collection, items };
}

export function setSize(collection, wsIdx, memberIdx, size) {
  const it = collection.items[wsIdx];
  if (it === undefined || it.kind !== "workspace" || memberIdx < 0 || memberIdx >= it.sizes.length) return collection;
  const sizes = it.sizes.map((s, i) => (i === memberIdx ? Math.max(0.1, Number(size) || 1) : s));
  const items = [...collection.items];
  items[wsIdx] = { ...it, sizes };
  return { ...collection, items };
}

export function renameItem(collection, idx, name) {
  if (idx < 0 || idx >= collection.items.length) return collection;
  const items = [...collection.items];
  items[idx] = { ...items[idx], name: normName(name, items[idx].name) };
  return { ...collection, items };
}

export function setActiveIndex(collection, idx) {
  if (idx < 0 || idx >= collection.items.length) return collection;
  return { ...collection, activeIndex: idx };
}

/** Flatten legacy n-tree tabs: each leaf session becomes its own tab. */
export function migrateLegacy(input) {
  const d = defaultCollection();
  if (input === null || typeof input !== "object") return d;
  const items = [];
  const nameFor = (sessionId, fallback) => normName(fallback, sessionId);
  const pushLeaf = (sessionId, tabName) => {
    if (sessionId !== null) items.push({ kind: "tab", sessionId, name: nameFor(sessionId, tabName) });
  };
  // legacy two-layer { tabs: [{name, tree}] }
  if (Array.isArray(input.tabs)) {
    for (const t of input.tabs) {
      collectTreeLeaves(t.tree, (sessionId) => pushLeaf(sessionId, t.name));
    }
  }
  // legacy three-layer { workspaces: [{tabs:[{name, tree}]}] }
  if (Array.isArray(input.workspaces)) {
    for (const w of input.workspaces) {
      for (const t of w.tabs ?? []) collectTreeLeaves(t.tree, (sessionId) => pushLeaf(sessionId, t.name));
    }
  }
  if (items.length === 0) return d;
  return { items, activeIndex: 0 };
}

function collectTreeLeaves(tree, cb) {
  if (tree === null || typeof tree !== "object") return;
  if (tree.kind === "block") {
    cb(typeof tree.sessionId === "string" ? tree.sessionId : null);
    return;
  }
  if (tree.kind === "list" && Array.isArray(tree.children)) {
    for (const c of tree.children) collectTreeLeaves(c, cb);
    return;
  }
  if (tree.kind === "leaf") {
    cb(typeof tree.sessionId === "string" ? tree.sessionId : null);
    return;
  }
  if (tree.kind === "split") {
    collectTreeLeaves(tree.a, cb);
    collectTreeLeaves(tree.b, cb);
  }
}

/** Every session id referenced (order: items, members left to right). */
export function collectSessions(collection) {
  const out = [];
  for (const it of collection.items) {
    if (it.kind === "tab") out.push(it.sessionId);
    else for (const m of it.members) out.push(m.sessionId);
  }
  return out;
}

function adjustActive(activeIndex, removedIdx, newLength) {
  if (newLength === 0) return 0;
  if (activeIndex === removedIdx) return Math.min(activeIndex, newLength - 1);
  if (activeIndex > removedIdx) return activeIndex - 1;
  return activeIndex;
}
