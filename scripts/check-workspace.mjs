/**
 * check-workspace.mjs — exercises the pure workspace-collection module
 * (src/shared/workspace.mjs).
 *
 * Same posture as check-splittree.mjs. The workspace collection is the
 * three-layer layout state (ADR-0007): workspaces of tabs, each tab a
 * SplitTree. Sessions are never owned here — leaves reference them and the
 * host empties dead ones. Layout copy copies structure, not bindings.
 *
 *   Run:  node scripts/check-workspace.mjs
 */
import {
  defaultCollection,
  setActiveTree,
  normalizeCollection,
  createWorkspace,
  removeWorkspace,
  renameWorkspace,
  setWorkspaceMeta,
  addTab,
  removeTab,
  renameTab,
  setActiveTab,
  setActiveWorkspace,
  activeTree,
  emptySessionFromAll,
  collectSessions,
} from "../src/shared/workspace.mjs";
import { newTree } from "../src/shared/workspace.mjs";
import { listOf } from "../src/shared/layout.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("Workspace module checks");
console.log("=======================");

console.log("1. default collection");
const d0 = defaultCollection();
check("default has one workspace", d0.workspaces.length === 1);
check("workspace has one empty-block tab", d0.workspaces[0].tabs.length === 1 && d0.workspaces[0].tabs[0].tree.kind === "block" && d0.workspaces[0].tabs[0].tree.sessionId === null);
check("activeWorkspace = 0 and activeTab = 0", d0.activeWorkspace === 0 && d0.workspaces[0].activeTab === 0);
check("default names", d0.workspaces[0].name.length > 0 && d0.workspaces[0].tabs[0].name.length > 0);

console.log("2. normalize repairs garbage");
const g0 = normalizeCollection(null);
check("null -> default collection", g0.workspaces.length === 1);
const g1 = normalizeCollection({ workspaces: [{ name: "W", icon: "i", color: "red", tabs: [{ name: "T", tree: { kind: "split", dir: "x", ratio: 9, a: { kind: "leaf", sessionId: 42 }, b: null } }], activeTab: 5 }], activeWorkspace: 3 });
check("legacy split tree resets to an empty block (migration)", g1.workspaces[0].tabs[0].tree.kind === "block" && g1.workspaces[0].tabs[0].tree.sessionId === null, JSON.stringify(g1.workspaces[0].tabs[0].tree));
check("activeTab clamped into range", g1.workspaces[0].activeTab === 0);
check("activeWorkspace clamped into range", g1.activeWorkspace === 0);
const g2 = normalizeCollection({ workspaces: [], activeWorkspace: 0 });
check("empty workspaces -> default", g2.workspaces.length === 1);

console.log("3. workspace CRUD");
const c1 = createWorkspace(d0);
check("create appends a fresh workspace", c1.workspaces.length === 2 && c1.workspaces[1].tabs.length === 1 && c1.workspaces[1].tabs[0].tree.sessionId === null);
const c2 = createWorkspace(c1, { name: "监控" });
check("create with name", c2.workspaces[2].name === "监控");
const c3 = removeWorkspace(c2, 0);
check("remove shrinks the collection", c3.workspaces.length === 2);
const c4 = removeWorkspace(c3, 5);
check("remove out of range is a no-op", c4 === c3);
const c5 = renameWorkspace(d0, 0, "生产");
check("rename", c5.workspaces[0].name === "生产");
const c6 = setWorkspaceMeta(d0, 0, "server", "#4c8dff");
check("icon + color meta", c6.workspaces[0].icon === "server" && c6.workspaces[0].color === "#4c8dff");

console.log("4. layout copy copies structure, not bindings");
const base = defaultCollection();
const withSplit = JSON.parse(JSON.stringify(base));
withSplit.workspaces[0].tabs[0].tree = listOf("row", [{ kind: "block", sessionId: "A" }, { kind: "block", sessionId: "B" }]);
const cp = createWorkspace(withSplit, { name: "副本", copyFrom: 0 });
check("copy keeps the list structure", cp.workspaces[1].tabs[0].tree.kind === "list" && cp.workspaces[1].tabs[0].tree.dir === "row" && cp.workspaces[1].tabs[0].tree.children[0].sessionId === null && cp.workspaces[1].tabs[0].tree.children[1].sessionId === null);
check("copy does not duplicate session bindings", collectSessions(cp).join(",") === "A,B", collectSessions(cp).join(","));

console.log("5. tab CRUD + active memory");
const t1 = addTab(d0, 0);
check("addTab appends a single empty-block tab", t1.workspaces[0].tabs.length === 2 && t1.workspaces[0].tabs[1].tree.kind === "block");
const t2 = setActiveTab(t1, 0, 1);
check("setActiveTab", t2.workspaces[0].activeTab === 1);
const t3 = renameTab(t2, 0, 1, "部署");
check("renameTab", t3.workspaces[0].tabs[1].name === "部署");
const [t4, removedTree] = removeTab(t3, 0, 1);
check("removeTab returns the removed tab", t4.workspaces[0].tabs.length === 1 && removedTree.kind === "block");
const t5 = setActiveWorkspace(d0, 0);
check("setActiveWorkspace", t5.activeWorkspace === 0);
check("activeTree returns the active tab's tree", activeTree(d0).kind === "block" && activeTree(d0).sessionId === null);
const st = setActiveTree(d0, { kind: "block", sessionId: "S" });
check("setActiveTree replaces the active tab's tree", activeTree(st).sessionId === "S" && st.workspaces[0].tabs[0].tree.sessionId === "S");

console.log("6. session cleanup is global across workspaces and tabs");
const multi = normalizeCollection({
  workspaces: [
    { name: "W1", icon: null, color: null, tabs: [{ name: "a", tree: { kind: "block", sessionId: "S1" } }, { name: "b", tree: listOf("row", [{ kind: "block", sessionId: "S2" }, { kind: "block", sessionId: "S1" }]) }], activeTab: 0 },
    { name: "W2", icon: null, color: null, tabs: [{ name: "c", tree: { kind: "block", sessionId: "S1" } }], activeTab: 0 },
  ],
  activeWorkspace: 0,
});
check("fixture holds S1 in three places", collectSessions(multi).filter((s) => s === "S1").length === 3);
const cleaned = emptySessionFromAll(multi, "S1");
check("emptySessionFromAll clears every leaf of S1", collectSessions(cleaned).filter((s) => s === "S1").length === 0);
check("other sessions survive", collectSessions(cleaned).join(",") === "S2");

console.log(failures === 0 ? "\nALL WORKSPACE CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
