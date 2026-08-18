/**
 * Integration test for dsh-multi-server — runs the real host half against a
 * DSH-like loopback server and a real SSH target.
 *
 *   Prerequisites:
 *     - a test sshd reachable from this machine (default 127.0.0.1:2222,
 *       key auth; see scripts/test-sshd.sh to spin one up)
 *     - SSH_TEST_KEY (default /tmp/sshd-test/client_key)
 *
 *   Run:  node tests/integration.mjs
 */
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { apply } = await import(ROOT + "lib/index.js");

const SSH_HOST = process.env.SSH_TEST_HOST ?? "127.0.0.1";
const SSH_PORT = Number(process.env.SSH_TEST_PORT ?? 2222);
const SSH_KEY = process.env.SSH_TEST_KEY ?? "/tmp/sshd-test/client_key";

/* ---------- DSH-like host ---------- */
const routes = [];
const upgrades = [];
const ctx = {
  webServer: {
    register: (r) => {
      routes.push(r);
      return () => {
        const i = routes.indexOf(r);
        if (i !== -1) routes.splice(i, 1);
      };
    },
    registerUpgrade: (u) => {
      upgrades.push(u);
      return () => {
        const i = upgrades.indexOf(u);
        if (i !== -1) upgrades.splice(i, 1);
      };
    },
  },
  effect: () => {},
};

process.env.DSH_HOME = ROOT + ".test-home";
rmSync(process.env.DSH_HOME + "/plugin-data/multi-server", {
  recursive: true,
  force: true,
});
apply(ctx, {});

const server = http.createServer(async (req, res) => {
  for (const r of routes) {
    if (r.kind === "prefix" && (req.url ?? "/").startsWith(r.path)) {
      await r.handler(req, res);
      return;
    }
  }
  res.writeHead(404).end("not found");
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  for (const u of upgrades) {
    if (u.path === path) {
      u.handler(req, socket, head);
      return;
    }
  }
  socket.destroy();
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- helpers ---------- */
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

async function req(path, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

function openWs(sessionId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/multi-server/ws/${sessionId}`);
    const timer = setTimeout(() => reject(new Error("ws open timeout")), timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/* ---------- scenario ---------- */
console.log("1. server CRUD");

const created = await req("/multi-server/servers", "POST", {
  name: "集成测试机",
  host: SSH_HOST,
  port: SSH_PORT,
  username: "root",
  authKind: "privateKey",
  privateKey: SSH_KEY,
  remoteCwd: "/root",
});
check("POST /servers creates", created.status === 200 && typeof created.body.server?.id === "string", JSON.stringify(created.body));
const serverId = created.body?.server?.id;
check("response strips secrets", created.body?.server?.privateKey === undefined && created.body?.server?.password === undefined);
check("hasPrivateKey flag set", created.body?.server?.hasPrivateKey === true);
check("name defaults OK", created.body?.server?.name === "集成测试机");

const listed = await req("/multi-server/servers");
check("GET /servers lists it", listed.body?.servers?.some((s) => s.id === serverId));
check("list strips secrets too", listed.body?.servers?.every((s) => s.privateKey === undefined && s.password === undefined));

console.log("1b. update (PUT) keeps id and secret, no duplicate");
const updated = await req(`/multi-server/servers/${serverId}`, "PUT", {
  name: "集成测试机-改",
  host: SSH_HOST,
  port: SSH_PORT,
  username: "root",
  authKind: "privateKey",
  // privateKey intentionally omitted -> should be preserved by the store
});
check("PUT updates same id", updated.body?.server?.id === serverId, JSON.stringify(updated.body));
check("PUT applies new name", updated.body?.server?.name === "集成测试机-改");
check("PUT preserves secret", updated.body?.server?.hasPrivateKey === true);
const listed1b = await req("/multi-server/servers");
check(
  "no duplicate created by PUT",
  listed1b.body?.servers?.filter((s) => s.id === serverId).length === 1 &&
    listed1b.body?.servers?.length === 1,
  JSON.stringify(listed1b.body),
);

console.log("2. connectivity test");
const tested = await req(`/multi-server/servers/${serverId}/test`, "POST");
check("POST /servers/:id/test ok", tested.body?.ok === true, JSON.stringify(tested.body));
check("latency reported", typeof tested.body?.latencyMs === "number");

console.log("3. unsaved-form test route");
const unsaved = await req("/multi-server/servers/test", "POST", {
  host: SSH_HOST,
  port: SSH_PORT,
  username: "root",
  authKind: "privateKey",
  privateKey: SSH_KEY,
});
check("POST /servers/test ok", unsaved.body?.ok === true, JSON.stringify(unsaved.body));

console.log("4. terminal session over WebSocket");
const sess = await req("/multi-server/sessions", "POST", { serverId, cols: 80, rows: 24 });
check("POST /sessions opens", sess.status === 200 && typeof sess.body?.id === "string", JSON.stringify(sess.body));
const sessionId = sess.body?.id;

const ws = await openWs(sessionId);
ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));

const output = await new Promise((resolve, reject) => {
  const collected = [];
  const timer = setTimeout(() => reject(new Error("no output within 8s; got: " + collected.join("").slice(-400))), 8000);
  ws.on("message", (d) => {
    collected.push(String(d));
    if (collected.join("").includes("DSH_MS_OK")) {
      clearTimeout(timer);
      resolve(collected.join(""));
    }
  });
  setTimeout(() => ws.send("echo DSH_MS_OK && whoami && hostname\r"), 1500);
});
check("terminal echoes command output", output.includes("DSH_MS_OK") && output.includes("root"), output.slice(-200));

const sessionsNow = await req("/multi-server/sessions");
check("GET /sessions lists live session", sessionsNow.body?.sessions?.some((s) => s.id === sessionId));
check("session label correct", sessionsNow.body?.sessions?.find((s) => s.id === sessionId)?.label === `root@${SSH_HOST}:${SSH_PORT}`);

ws.close();

await new Promise((r) => setTimeout(r, 500));
const sessionsAfter = await req("/multi-server/sessions");
check("session torn down after ws close", !sessionsAfter.body?.sessions?.some((s) => s.id === sessionId));

console.log("5. cleanup");
const del = await req(`/multi-server/servers/${serverId}`, "DELETE");
check("DELETE /servers/:id ok", del.body?.ok === true);
const del2 = await req(`/multi-server/servers/${serverId}`, "DELETE");
check("DELETE missing -> 404", del2.status === 404);

console.log("6. storage persistence");
const listed2 = await req("/multi-server/servers");
check("store empty after delete", (listed2.body?.servers?.length ?? 0) === 0);

ws.close();
server.close();
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
