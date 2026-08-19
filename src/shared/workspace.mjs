/**
 * Pure workspace-collection module — the three-layer layout state (ADR-0007).
 *
 * A collection is:
 *   { tabs: [ { name, tree: LayoutTree } ], activeTab }
 *
 * Two layers (the Workspace layer was removed — tabs ARE the top-level
 * containers, ADR-0007 revision). Sessions
 * are never owned by this module: block leaves reference them, and callers
 * clear leaves when a session dies. Copying a workspace copies structure only
 * — bindings are not duplicated. The module is DOM-free and doubles as the
 * wire schema for GET/PUT /ssh-hub/workspace and /workspace/events pushes.
 */
import { newBlock, normalizeTree } from "./layout.mjs";
/** A single empty block, as the layout module's initial tree. */
export function newTree() {
  return newBlock(null);
}

/**
 * @typedef {Object} TabState
 * @property {string} name
 * @property {import("./layout.mjs").TreeNode} tree
 *
 * @typedef {Object} TabCollection
 * @property {TabState[]} tabs
 * @property {number} activeTab
 */

const DEFAULT_NAME = "默认";
const DEFAULT_TAB = "标签 1";

export function defaultCollection() {
  return {
    tabs: [{ name: DEFAULT_TAB, tree: newTree(null) }],
    activeTab: 0,
  };
}

function normalizeTab(input) {
  const name = typeof input?.name === "string" && input.name.length > 0 ? input.name : DEFAULT_TAB;
  // Legacy binary SplitTree nodes (kind "split") reset to an empty block —
  // the n-tree engine supersedes them (spec #32 / ADR-0008).
  const tree =
    input?.tree !== null && typeof input?.tree === "object" && input.tree.kind === "split"
      ? newBlock(null)
      : normalizeTree(input?.tree);
  return { name, tree };
}

/** Validate + repair arbitrary JSON into a well-formed two-layer collection.
 *  Legacy three-layer state ({ workspaces: [...] }) migrates by promoting the
 *  active workspace's tabs; everything else is discarded (sessions are never
 *  owned by layout state, so nothing is lost). */
export function normalizeCollection(input) {
  const d = defaultCollection();
  if (input === null || typeof input !== "object") return d;
  if (Array.isArray(input.workspaces)) {
    const list = input.workspaces;
    if (list.length === 0) return d;
    const idx = Math.min(Math.max(0, Math.round(Number(input.activeWorkspace) || 0)), list.length - 1);
    const ws = list[idx] ?? {};
    const rawTabs = Array.isArray(ws.tabs) && ws.tabs.length > 0 ? ws.tabs : [undefined];
    const tabs = rawTabs.map(normalizeTab);
    const activeTab = Math.min(Math.max(0, Math.round(Number(ws.activeTab) || 0)), tabs.length - 1);
    return { tabs, activeTab };
  }
  if (Array.isArray(input.tabs)) {
    const tabs = input.tabs.length > 0 ? input.tabs.map(normalizeTab) : [undefined].map(normalizeTab);
    const activeTab = Math.min(Math.max(0, Math.round(Number(input.activeTab) || 0)), tabs.length - 1);
    return { tabs, activeTab };
  }
  return d;
}

/** Append a fresh workspace: an empty template, or a structural copy of
 *  another workspace with all session bindings cleared (copy layout, not
 *  sessions — the global list stays the single source of truth). */





export function addTab(collection) {
  return {
    ...collection,
    tabs: [...collection.tabs, { name: "标签 " + (collection.tabs.length + 1), tree: newTree(null) }],
  };
}

/** Remove a tab; returns [collection, removedTree]. */
export function removeTab(collection, tabIdx) {
  if (tabIdx < 0 || tabIdx >= collection.tabs.length) return [collection, null];
  const removed = collection.tabs[tabIdx].tree;
  const tabs = collection.tabs.filter((_, i) => i !== tabIdx);
  const nextTabs = tabs.length > 0 ? tabs : [{ name: DEFAULT_TAB, tree: newTree(null) }];
  const activeTab = Math.min(collection.activeTab, nextTabs.length - 1);
  return [{ ...collection, tabs: nextTabs, activeTab }, removed];
}

export function renameTab(collection, tabIdx, name) {
  if (tabIdx < 0 || tabIdx >= collection.tabs.length) return collection;
  return { ...collection, tabs: collection.tabs.map((t, j) => (j === tabIdx ? { ...t, name } : t)) };
}

export function setActiveTab(collection, tabIdx) {
  if (tabIdx < 0 || tabIdx >= collection.tabs.length) return collection;
  return { ...collection, activeTab: tabIdx };
}

/** Replace the active tab's tree. */
export function setActiveTree(collection, tree) {
  const tabIdx = Math.min(collection.activeTab, collection.tabs.length - 1);
  return { ...collection, tabs: collection.tabs.map((t, j) => (j === tabIdx ? { ...t, tree } : t)) };
}

/** The active tab's tree. */
export function activeTree(collection) {
  if (collection.tabs.length === 0) return newTree(null);
  return collection.tabs[Math.min(collection.activeTab, collection.tabs.length - 1)].tree;
}

/** Clear every leaf holding `sessionId` across all tabs. */
export function emptySessionFromAll(collection, sessionId) {
  let changed = false;
  const tabs = collection.tabs.map((t) => {
    const tree = clearSession(t.tree, sessionId, () => {
      changed = true;
    });
    return { ...t, tree };
  });
  return changed ? { ...collection, tabs } : collection;
}

/** Every session id referenced by the collection (leaf order, deduped per call site). */
export function collectSessions(collection) {
  const out = [];
  for (const t of collection.tabs) {
    const walk = (node) => {
      if (node.kind === "block") {
        if (node.sessionId !== null) out.push(node.sessionId);
        return;
      }
      for (const c of node.children) walk(c);
    };
    walk(t.tree);
  }
  return out;
}

/* ---------------- internals ---------------- */

function clearSessions(tree) {
  if (tree.kind === "block") return { kind: "block", sessionId: null };
  return { ...tree, children: tree.children.map(clearSessions) };
}

function clearSession(tree, sessionId, onChanged) {
  if (tree.kind === "block") {
    if (tree.sessionId === sessionId) {
      onChanged();
      return { kind: "block", sessionId: null };
    }
    return tree;
  }
  return { ...tree, children: tree.children.map((c) => clearSession(c, sessionId, onChanged)) };
}
