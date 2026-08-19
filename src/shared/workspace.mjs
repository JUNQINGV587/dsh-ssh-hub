/**
 * Pure workspace-collection module — the three-layer layout state (ADR-0007).
 *
 * A collection is:
 *   { workspaces: [ { name, icon, color,
 *                     tabs: [ { name, tree: SplitTree } ],
 *                     activeTab } ],
 *     activeWorkspace }
 *
 * Workspaces are layout templates (named/iconed/colored tab sets). Sessions
 * are never owned by this module: block leaves reference them, and callers
 * clear leaves when a session dies. Copying a workspace copies structure only
 * — bindings are not duplicated. The module is DOM-free and doubles as the
 * wire schema for GET/PUT /ssh-hub/workspace and /workspace/events pushes.
 */
import { newTree, normalizeTree } from "./splittree.mjs";

/**
 * @typedef {Object} TabState
 * @property {string} name
 * @property {import("./splittree.mjs").TreeNode} tree
 *
 * @typedef {Object} WorkspaceState
 * @property {string} name
 * @property {string|null} icon
 * @property {string|null} color
 * @property {TabState[]} tabs
 * @property {number} activeTab
 *
 * @typedef {Object} WorkspaceCollection
 * @property {WorkspaceState[]} workspaces
 * @property {number} activeWorkspace
 */

const DEFAULT_NAME = "默认";
const DEFAULT_TAB = "标签 1";

export function defaultCollection() {
  return {
    workspaces: [
      {
        name: DEFAULT_NAME,
        icon: null,
        color: null,
        tabs: [{ name: DEFAULT_TAB, tree: newTree(null) }],
        activeTab: 0,
      },
    ],
    activeWorkspace: 0,
  };
}

function normalizeTab(input) {
  const name = typeof input?.name === "string" && input.name.length > 0 ? input.name : DEFAULT_TAB;
  return { name, tree: normalizeTree(input?.tree) };
}

function normalizeWorkspace(input) {
  const name = typeof input?.name === "string" && input.name.length > 0 ? input.name : DEFAULT_NAME;
  const icon = typeof input?.icon === "string" ? input.icon : null;
  const color = typeof input?.color === "string" ? input.color : null;
  const rawTabs = Array.isArray(input?.tabs) && input.tabs.length > 0 ? input.tabs : [undefined];
  const tabs = rawTabs.map(normalizeTab);
  const activeTab = Math.min(Math.max(0, Math.round(Number(input?.activeTab) || 0)), tabs.length - 1);
  return { name, icon, color, tabs, activeTab };
}

/** Validate + repair arbitrary JSON into a well-formed collection. */
export function normalizeCollection(input) {
  const d = defaultCollection();
  if (input === null || typeof input !== "object" || !Array.isArray(input.workspaces) || input.workspaces.length === 0) {
    return d;
  }
  const workspaces = input.workspaces.map(normalizeWorkspace);
  const activeWorkspace = Math.min(Math.max(0, Math.round(Number(input.activeWorkspace) || 0)), workspaces.length - 1);
  return { workspaces, activeWorkspace };
}

/** Append a fresh workspace: an empty template, or a structural copy of
 *  another workspace with all session bindings cleared (copy layout, not
 *  sessions — the global list stays the single source of truth). */
export function createWorkspace(collection, opts = {}) {
  const name = typeof opts.name === "string" && opts.name.length > 0 ? opts.name : DEFAULT_NAME;
  let tabs;
  if (typeof opts.copyFrom === "number" && opts.copyFrom >= 0 && opts.copyFrom < collection.workspaces.length) {
    const src = collection.workspaces[opts.copyFrom];
    tabs = src.tabs.map((t) => ({ name: t.name, tree: clearSessions(JSON.parse(JSON.stringify(t.tree))) }));
  } else {
    tabs = [{ name: DEFAULT_TAB, tree: newTree(null) }];
  }
  const workspaces = [...collection.workspaces, { name, icon: null, color: null, tabs, activeTab: 0 }];
  return { ...collection, workspaces };
}

export function removeWorkspace(collection, idx) {
  if (idx < 0 || idx >= collection.workspaces.length) return collection;
  const workspaces = collection.workspaces.filter((_, i) => i !== idx);
  if (workspaces.length === 0) return defaultCollection();
  const activeWorkspace = Math.min(collection.activeWorkspace, workspaces.length - 1);
  return { workspaces, activeWorkspace };
}

export function renameWorkspace(collection, idx, name) {
  if (idx < 0 || idx >= collection.workspaces.length) return collection;
  const workspaces = collection.workspaces.map((w, i) => (i === idx ? { ...w, name } : w));
  return { ...collection, workspaces };
}

export function setWorkspaceMeta(collection, idx, icon, color) {
  if (idx < 0 || idx >= collection.workspaces.length) return collection;
  const workspaces = collection.workspaces.map((w, i) =>
    i === idx ? { ...w, icon: icon ?? null, color: color ?? null } : w,
  );
  return { ...collection, workspaces };
}

export function setActiveWorkspace(collection, idx) {
  if (idx < 0 || idx >= collection.workspaces.length) return collection;
  return { ...collection, activeWorkspace: idx };
}

export function addTab(collection, wsIdx) {
  if (wsIdx < 0 || wsIdx >= collection.workspaces.length) return collection;
  const workspaces = collection.workspaces.map((w, i) =>
    i === wsIdx ? { ...w, tabs: [...w.tabs, { name: "标签 " + (w.tabs.length + 1), tree: newTree(null) }] } : w,
  );
  return { ...collection, workspaces };
}

/** Remove a tab; returns [collection, removedTree]. */
export function removeTab(collection, wsIdx, tabIdx) {
  if (wsIdx < 0 || wsIdx >= collection.workspaces.length) return [collection, null];
  const ws = collection.workspaces[wsIdx];
  if (tabIdx < 0 || tabIdx >= ws.tabs.length) return [collection, null];
  const removed = ws.tabs[tabIdx].tree;
  const tabs = ws.tabs.filter((_, i) => i !== tabIdx);
  const nextTabs = tabs.length > 0 ? tabs : [{ name: DEFAULT_TAB, tree: newTree(null) }];
  const activeTab = Math.min(ws.activeTab, nextTabs.length - 1);
  const workspaces = collection.workspaces.map((w, i) =>
    i === wsIdx ? { ...w, tabs: nextTabs, activeTab } : w,
  );
  return [{ ...collection, workspaces }, removed];
}

export function renameTab(collection, wsIdx, tabIdx, name) {
  if (wsIdx < 0 || wsIdx >= collection.workspaces.length) return collection;
  const ws = collection.workspaces[wsIdx];
  if (tabIdx < 0 || tabIdx >= ws.tabs.length) return collection;
  const workspaces = collection.workspaces.map((w, i) =>
    i === wsIdx ? { ...w, tabs: w.tabs.map((t, j) => (j === tabIdx ? { ...t, name } : t)) } : w,
  );
  return { ...collection, workspaces };
}

export function setActiveTab(collection, wsIdx, tabIdx) {
  if (wsIdx < 0 || wsIdx >= collection.workspaces.length) return collection;
  const ws = collection.workspaces[wsIdx];
  if (tabIdx < 0 || tabIdx >= ws.tabs.length) return collection;
  const workspaces = collection.workspaces.map((w, i) => (i === wsIdx ? { ...w, activeTab: tabIdx } : w));
  return { ...collection, workspaces };
}

/** Replace the SplitTree of the active (workspace, tab). */
export function setActiveTree(collection, tree) {
  const ws = collection.workspaces[collection.activeWorkspace];
  if (ws === undefined || ws.tabs.length === 0) return collection;
  const tabIdx = Math.min(ws.activeTab, ws.tabs.length - 1);
  const workspaces = collection.workspaces.map((w, i) =>
    i === collection.activeWorkspace
      ? { ...w, tabs: w.tabs.map((t, j) => (j === tabIdx ? { ...t, tree } : t)) }
      : w,
  );
  return { ...collection, workspaces };
}

/** The SplitTree of the active (workspace, tab). */
export function activeTree(collection) {
  const ws = collection.workspaces[collection.activeWorkspace];
  if (ws === undefined || ws.tabs.length === 0) return newTree(null);
  return ws.tabs[Math.min(ws.activeTab, ws.tabs.length - 1)].tree;
}

/** Clear every leaf holding `sessionId` in all workspaces and tabs. */
export function emptySessionFromAll(collection, sessionId) {
  let changed = false;
  const workspaces = collection.workspaces.map((w) => ({
    ...w,
    tabs: w.tabs.map((t) => {
      const tree = clearSession(t.tree, sessionId, () => {
        changed = true;
      });
      return { ...t, tree };
    }),
  }));
  return changed ? { ...collection, workspaces } : collection;
}

/** Every session id referenced by the collection (leaf order, deduped per call site). */
export function collectSessions(collection) {
  const out = [];
  for (const w of collection.workspaces) {
    for (const t of w.tabs) {
      const walk = (node) => {
        if (node.kind === "leaf") {
          if (node.sessionId !== null) out.push(node.sessionId);
          return;
        }
        walk(node.a);
        walk(node.b);
      };
      walk(t.tree);
    }
  }
  return out;
}

/* ---------------- internals ---------------- */

function clearSessions(tree) {
  if (tree.kind === "leaf") return { kind: "leaf", sessionId: null };
  return { ...tree, a: clearSessions(tree.a), b: clearSessions(tree.b) };
}

function clearSession(tree, sessionId, onChanged) {
  if (tree.kind === "leaf") {
    if (tree.sessionId === sessionId) {
      onChanged();
      return { kind: "leaf", sessionId: null };
    }
    return tree;
  }
  return { ...tree, a: clearSession(tree.a, sessionId, onChanged), b: clearSession(tree.b, sessionId, onChanged) };
}
