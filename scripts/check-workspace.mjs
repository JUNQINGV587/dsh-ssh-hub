/**
 * check-workspace.mjs — exercises the pure workspace-collection module
 * (src/shared/workspace.mjs).
 *
 * Two layers (ADR-0007 revision): { tabs: [{ name, tree }], activeTab }.
 * Legacy three-layer state migrates by promoting the active workspace's tabs.
 *
 *   Run:  node scripts/check-workspace.mjs
 */
import {
  defaultCollection,
  normalizeCollection,
  addTab,
  removeTab,
  renameTab,
  setActiveTab,
  activeTree,
  setActiveTree,
  emptySessionFromAll,
  collectSessions,
} from "../src/shared/workspace.mjs";
import { listOf } from "../src/shared/layout.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("Workspace module checks (two-layer)");
console.log("===================================");

console.log("1. default collection");
const d0 = defaultCollection();
check("default has one empty-block tab", d0.tabs.length === 1 && d0.tabs[0].tree.kind === "block" && d0.tabs[0].tree.sessionId === null);
check("activeTab = 0", d0.activeTab === 0);
check("default tab name", d0.tabs[0].name.length > 0);

console.log("2. normalize repairs garbage");
const g0 = normalizeCollection(null);
check("null -> default", g0.tabs.length === 1);
const g1 = normalizeCollection({ tabs: [{ name: "T", tree: { kind: "banana" } }] });
check("bad tree -> empty block", g1.tabs[0].tree.kind === "block" && g1.tabs[0].tree.sessionId === null);
const g2 = normalizeCollection({ tabs: [], activeTab: 9 });
check("empty tabs -> default; activeTab clamped", g2.tabs.length === 1 && g2.activeTab === 0);
const g3 = normalizeCollection({ banana: 1 });
check("garbage -> default", g3.tabs.length === 1);

console.log("3. legacy three-layer migration");
const legacy = {
  workspaces: [
    { name: "W1", icon: "a", color: "red", tabs: [{ name: "T1", tree: { kind: "block", sessionId: "S1" } }], activeTab: 0 },
    { name: "W2", icon: "b", color: "blue", tabs: [{ name: "Ta", tree: { kind: "block", sessionId: "S2" } }, { name: "Tb", tree: { kind: "block", sessionId: null } }], activeTab: 1 },
  ],
  activeWorkspace: 1,
};
const mig = normalizeCollection(legacy);
check("active workspace's tabs promoted", mig.tabs.length === 2 && mig.tabs[0].name === "Ta" && mig.tabs[0].tree.sessionId === "S2");
check("activeTab migrated", mig.activeTab === 1);
check("other workspace discarded (sessions safe)", collectSessions(mig).join(",") === "S2");

console.log("4. tab CRUD + active memory");
const t1 = addTab(d0);
check("addTab appends an empty-block tab", t1.tabs.length === 2 && t1.tabs[1].tree.kind === "block");
const t2 = setActiveTab(t1, 1);
check("setActiveTab", t2.activeTab === 1);
const t3 = renameTab(t2, 1, "部署");
check("renameTab", t3.tabs[1].name === "部署");
const [t4, removedTree] = removeTab(t3, 1);
check("removeTab returns the removed tab", t4.tabs.length === 1 && removedTree.kind === "block");
check("activeTree returns the active tab's tree", activeTree(d0).kind === "block");
const st = setActiveTree(d0, { kind: "block", sessionId: "S" });
check("setActiveTree replaces the active tab's tree", activeTree(st).sessionId === "S");

console.log("5. session cleanup is global across tabs");
const multi = normalizeCollection({
  tabs: [
    { name: "a", tree: { kind: "block", sessionId: "S1" } },
    { name: "b", tree: listOf("row", [{ kind: "block", sessionId: "S2" }, { kind: "block", sessionId: "S1" }]) },
  ],
  activeTab: 0,
});
check("fixture holds S1 twice", collectSessions(multi).filter((s) => s === "S1").length === 2);
const cleaned = emptySessionFromAll(multi, "S1");
check("emptySessionFromAll clears every leaf", collectSessions(cleaned).filter((s) => s === "S1").length === 0);
check("other sessions survive", collectSessions(cleaned).join(",") === "S2");

console.log(failures === 0 ? "\nALL WORKSPACE CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
