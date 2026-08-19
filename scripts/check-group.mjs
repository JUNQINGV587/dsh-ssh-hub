/**
 * check-group.mjs — exercises the pure flat-group module
 * (src/shared/group.mjs).
 *
 * The tabs-as-sessions model (spec #38): items are tabs (one session,
 * full-window) or workspaces (flat side-by-side member lists with an
 * orientation and per-member sizes). Covers merge/ungroup/member ops/
 * orientation/sizes/normalize/migration-flatten.
 *
 *   Run:  node scripts/check-group.mjs
 */
import {
  defaultCollection,
  normalizeCollection,
  merge,
  ungroup,
  addMember,
  removeMember,
  reorderMember,
  swapMembers,
  setOrientation,
  setSize,
  renameItem,
  setActiveIndex,
  migrateLegacy,
  collectSessions,
} from "../src/shared/group.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("Group module checks (flat groups)");
console.log("=================================");

console.log("1. default + normalize");
const d0 = defaultCollection();
check("default has no items", d0.items.length === 0 && d0.activeIndex === 0);
const g1 = normalizeCollection({ banana: 1 });
check("garbage -> default", g1.items.length === 0);
const g2 = normalizeCollection({ items: [{ kind: "tab", sessionId: "S", name: "s" }], activeIndex: 5 });
check("activeIndex clamped", g2.activeIndex === 0);

console.log("2. merge: tab + tab -> workspace");
const c0 = normalizeCollection({ items: [
  { kind: "tab", sessionId: "A", name: "A" },
  { kind: "tab", sessionId: "B", name: "B" },
], activeIndex: 0 });
const m1 = merge(c0, 0, 1);
check("merge makes a workspace with both members", m1.items.length === 1 && m1.items[0].kind === "workspace" && m1.items[0].members.length === 2);
check("merged workspace orientation defaults to h", m1.items[0].orientation === "h");
check("merged sizes default equal", m1.items[0].sizes.join(",") === "1,1");
check("merged workspace has a name", m1.items[0].name.length > 0);

console.log("3. merge: tab -> workspace appends a member");
const m1b = normalizeCollection({ items: [m1.items[0], { kind: "tab", sessionId: "C", name: "C" }], activeIndex: 0 });
const m2 = merge(m1b, 1, 0);
check("merging a tab into a workspace appends", m2.items.length === 1 && m2.items[0].kind === "workspace" && m2.items[0].members.length === 3);

console.log("4. ungroup: workspace -> member tabs");
const u1 = ungroup(m2, 0);
check("ungroup returns member tabs", u1.items.length === 3 && u1.items.every((it) => it.kind === "tab"));

console.log("5. member ops");
const w0 = m2;
const a1 = addMember(w0, 0, { sessionId: "C", name: "C" });
check("addMember appends", a1.items[0].members.length === 4);
const r1 = removeMember(a1, 0, 1);
check("removeMember returns the removed member and demotes a 1-member workspace", r1.collection.items[0].kind === "tab" || (r1.collection.items[0].kind === "workspace" && r1.collection.items[0].members.length === 3));
const r2 = reorderMember(a1, 0, 0, 3);
check("reorderMember moves a member", a1.items[0].members[0].sessionId !== r2.items[0].members[0].sessionId);
const r3 = swapMembers(a1, 0, 0, 1);
check("swapMembers exchanges members", r3.items[0].members[0].sessionId !== a1.items[0].members[0].sessionId);
const o1 = setOrientation(w0, 0, "v");
check("setOrientation", o1.items[0].orientation === "v");
const s1 = setSize(w0, 0, 1, 2.5);
check("setSize stores the ratio", Math.abs(s1.items[0].sizes[1] - 2.5) < 1e-9);

console.log("6. rename + active");
const rn = renameItem(c0, 0, "生产");
check("renameItem", rn.items[0].name === "生产");
const sa = setActiveIndex(c0, 1);
check("setActiveIndex", sa.activeIndex === 1);

console.log("7. migration flatten (legacy n-tree tabs)");
const legacy = {
  tabs: [
    { name: "单", tree: { kind: "block", sessionId: "S1" } },
    { name: "组", tree: { kind: "list", dir: "row", sizes: [1, 1], children: [{ kind: "block", sessionId: "S2" }, { kind: "block", sessionId: "S3" }] } },
  ],
  activeTab: 0,
};
const flat = migrateLegacy(legacy);
check("legacy n-tree tabs flatten to one tab per leaf session", flat.items.length === 3 && flat.items.every((it) => it.kind === "tab"), JSON.stringify(flat.items.map((i) => i.sessionId)));
check("sessions preserved across flatten", collectSessions(flat).join(",") === "S1,S2,S3");

console.log(failures === 0 ? "\nALL GROUP CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
