/**
 * Integration test for dsh-ssh-hub — runs the real host half against a
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
import net from "node:net";
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
/**
 * Minimal `settings` service stub: per-namespace user-layer sections served
 * by `scope.get()`. `settingsAvailable` flips for the degradation case.
 */
const settingsSections = {};
const registeredNamespaces = new Set();
let settingsAvailable = true;

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
  inject: (names, cb) => {
    if (settingsAvailable && names.includes("settings")) {
      cb({
        effect: () => {},
        settings: {
          register: (ns, schema, opts) => {
            registeredNamespaces.add(ns);
            return {
              get: () => settingsSections[ns] ?? {},
              watch: () => () => {},
            };
          },
        },
      });
    }
  },
};

process.env.DSH_HOME = ROOT + ".test-home";
rmSync(process.env.DSH_HOME + "/plugin-data/ssh-hub", {
  recursive: true,
  force: true,
});
apply(ctx, { idleReclaimMs: 3000 });

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

/**
 * A TCP blackhole: accepts connections and never speaks, so ssh2 stalls in
 * the handshake until readyTimeout fires. Deterministic timeout target that
 * does not depend on external network routing.
 */
const blackhole = net.createServer(() => {
  /* accept, never send anything */
});
await new Promise((r) => blackhole.listen(0, "127.0.0.1", r));
const BH_PORT = blackhole.address().port;

/** Wait until the host registered the `ssh-hub` settings namespace. */
async function waitForNamespace(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!registeredNamespaces.has("ssh-hub") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return registeredNamespaces.has("ssh-hub");
}

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
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ssh-hub/ws/${sessionId}`);
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

/**
 * Open a session ws with the message collector attached BEFORE the socket
 * opens. ws 8.21 processes frames received during the handshake synchronously
 * (allowSynchronousEvents: true), so a listener attached after 'open' can
 * miss the replay entirely — this is exactly the reattach race.
 */
function collectWs(sessionId, timeoutMs = 8000) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ssh-hub/ws/${sessionId}`);
  const collected = [];
  ws.on("message", (d) => collected.push(String(d)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws open timeout")), timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve({
        ws,
        text: () => collected.join(""),
        waitFor: (needle, waitMs = 8000) =>
          new Promise((res2, rej2) => {
            const t2 = setTimeout(
              () => rej2(new Error(`no "${needle}" within ${waitMs}ms; got: ${collected.join("").slice(-400)}`)),
              waitMs,
            );
            const iv = setInterval(() => {
              if (collected.join("").includes(needle)) {
                clearTimeout(t2);
                clearInterval(iv);
                res2(collected.join(""));
              }
            }, 50);
          }),
      });
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/* ---------- scenario ---------- */
const fs = await import("node:fs");
const storeFile = process.env.DSH_HOME + "/plugin-data/ssh-hub/servers.json";
/**
 * Poll the on-disk store until `predicate(content)` holds (or the deadline
 * passes, in which case the latest content is returned and the assertion
 * fails on real data). Deterministic replacement for fixed-delay sleeps:
 * the store flushes through a serialized promise chain, so we wait for the
 * observable effect instead of guessing a duration.
 */
async function waitForDisk(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let content = "";
  for (;;) {
    try {
      content = fs.readFileSync(storeFile, "utf8");
    } catch {
      content = "";
    }
    if (predicate(content) || Date.now() > deadline) return content;
    await new Promise((r) => setTimeout(r, 25));
  }
}

console.log("1. server CRUD");

const created = await req("/ssh-hub/servers", "POST", {
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

const listed = await req("/ssh-hub/servers");
check("GET /servers lists it", listed.body?.servers?.some((s) => s.id === serverId));
check("list strips secrets too", listed.body?.servers?.every((s) => s.privateKey === undefined && s.password === undefined));

console.log("1b. update (PUT) keeps id and secret, no duplicate");
const updated = await req(`/ssh-hub/servers/${serverId}`, "PUT", {
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
// Same-kind regression, on disk: the PUT flush must leave the key untouched.
const diskSameKind = await waitForDisk((c) => c.includes("集成测试机-改"));
check("same-kind PUT keeps secret on disk", diskSameKind.includes(SSH_KEY));
const listed1b = await req("/ssh-hub/servers");
check(
  "no duplicate created by PUT",
  listed1b.body?.servers?.filter((s) => s.id === serverId).length === 1 &&
    listed1b.body?.servers?.length === 1,
  JSON.stringify(listed1b.body),
);

console.log("2. connectivity test");
const tested = await req(`/ssh-hub/servers/${serverId}/test`, "POST");
check("POST /servers/:id/test ok", tested.body?.ok === true, JSON.stringify(tested.body));
check("latency reported", typeof tested.body?.latencyMs === "number");

console.log("3. unsaved-form test route");
const unsaved = await req("/ssh-hub/servers/test", "POST", {
  host: SSH_HOST,
  port: SSH_PORT,
  username: "root",
  authKind: "privateKey",
  privateKey: SSH_KEY,
});
check("POST /servers/test ok", unsaved.body?.ok === true, JSON.stringify(unsaved.body));

console.log("2b. Server Defaults (settings namespace, three-layer resolution)");
const nsRegistered = await waitForNamespace();
check("ssh-hub settings namespace registered", nsRegistered);

// The read-only defaults route powers the form placeholders: schema defaults
// before any user layer, then the stub's values once set.
const defaultsBefore = await req("/ssh-hub/defaults");
check(
  "GET /defaults serves schema defaults",
  defaultsBefore.body?.defaultReadyTimeoutSec === 15 &&
    defaultsBefore.body?.defaultKeepaliveIntervalSec === 30 &&
    defaultsBefore.body?.defaultStrictHostKey === false &&
    defaultsBefore.body?.defaultTerminalTheme === "auto",
  JSON.stringify(defaultsBefore.body),
);

// Global default 3s -> a blank-field server must fail around 3s, not the
// hardcoded 15s (+3s timer margin).
settingsSections["ssh-hub"] = {
  defaultReadyTimeoutSec: 3,
  defaultKeepaliveIntervalSec: 30,
  defaultStrictHostKey: false,
  defaultTerminalTheme: "auto",
};const t0 = Date.now();
const blankDefault = await req("/ssh-hub/servers/test", "POST", {
  host: "127.0.0.1", port: BH_PORT, username: "root", authKind: "none",
});
const blankElapsed = Date.now() - t0;
check(
  "blank-field server uses the Server Default (~3s, not 15s)",
  blankDefault.body?.ok === false && blankElapsed >= 1500 && blankElapsed < 9000,
  `elapsed=${blankElapsed}ms msg=${blankDefault.body?.message}`,
);

// Explicit server field (12s) must WIN over the global default (3s).
const t1 = Date.now();
const explicitField = await req("/ssh-hub/servers/test", "POST", {
  host: "127.0.0.1", port: BH_PORT, username: "root", authKind: "none",
  readyTimeout: 12000,
});
const explicitElapsed = Date.now() - t1;
check(
  "explicit server field wins over the Server Default (~12s, not 3s)",
  explicitField.body?.ok === false && explicitElapsed >= 9000,
  `elapsed=${explicitElapsed}ms msg=${explicitField.body?.message}`,
);

// Layered defaults reach the stored-server test route too.
const layeredStored = await req("/ssh-hub/servers", "POST", {
  name: "回退机", host: "127.0.0.1", port: BH_PORT, username: "root", authKind: "none",
});
const layeredId = layeredStored.body?.server?.id;
const t2 = Date.now();
const storedTest = await req(`/ssh-hub/servers/${layeredId}/test`, "POST");
const storedElapsed = Date.now() - t2;
check(
  "stored-server test route layers the Server Default too",
  storedTest.body?.ok === false && storedElapsed >= 1500 && storedElapsed < 9000,
  `elapsed=${storedElapsed}ms msg=${storedTest.body?.message}`,
);
await req(`/ssh-hub/servers/${layeredId}`, "DELETE");
const defaultsAfter = await req("/ssh-hub/defaults");
check(
  "GET /defaults reflects the user layer",
  defaultsAfter.body?.defaultReadyTimeoutSec === 3 && defaultsAfter.body?.defaultKeepaliveIntervalSec === 30,
  JSON.stringify(defaultsAfter.body),
);
delete settingsSections["ssh-hub"];

console.log("3c. authKind switch clears orphaned secrets (ADR 0001)");

const pwSrv = await req("/ssh-hub/servers", "POST", {
  name: "密码机", host: "192.0.2.1", port: 22, username: "ops",
  authKind: "password", password: "SUPER_SECRET_PW_123",
});
const pwId = pwSrv.body?.server?.id;
check("password server created", pwSrv.status === 200 && pwSrv.body?.server?.hasPassword === true);
const toAgent = await req(`/ssh-hub/servers/${pwId}`, "PUT", {
  host: "192.0.2.1", port: 22, username: "ops", authKind: "agent",
});
check("switch to agent clears hasPassword", toAgent.body?.server?.hasPassword === false, JSON.stringify(toAgent.body));
const diskAfterAgent = await waitForDisk((c) => !c.includes("SUPER_SECRET_PW_123"));
check("password gone from disk after switch", !diskAfterAgent.includes("SUPER_SECRET_PW_123"));

// Same-kind regression, password variant: blank field keeps the secret.
const pwKeep = await req(`/ssh-hub/servers/${pwId}`, "PUT", {
  host: "192.0.2.1", port: 22, username: "ops", authKind: "password", password: "KEEP_ME_PW",
});
check("agent->password sets new password", pwKeep.body?.server?.hasPassword === true, JSON.stringify(pwKeep.body));
const pwKeep2 = await req(`/ssh-hub/servers/${pwId}`, "PUT", {
  name: "密码机-改", host: "192.0.2.1", port: 22, username: "ops", authKind: "password",
});
check("same-kind password PUT preserves flag", pwKeep2.body?.server?.hasPassword === true, JSON.stringify(pwKeep2.body));
const diskPwKeep = await waitForDisk((c) => c.includes("密码机-改"));
check("same-kind password PUT keeps secret on disk", diskPwKeep.includes("KEEP_ME_PW"));

// Stale-secret resurrection: a legacy record holding an orphan password must
// NOT revive it when switched privateKey -> password with a blank password.
const legacy = await req("/ssh-hub/servers", "POST", {
  name: "遗留机", host: "192.0.2.5", username: "ops",
  authKind: "privateKey", privateKey: "LEGACY_PEM", password: "STALE_ORPHAN_PW",
});
const legacyId = legacy.body?.server?.id;
const resurrect = await req(`/ssh-hub/servers/${legacyId}`, "PUT", {
  host: "192.0.2.5", username: "ops", authKind: "password",
  // password intentionally omitted — must NOT resurrect STALE_ORPHAN_PW
});
check("kind change with blank password does not resurrect stale secret", resurrect.body?.server?.hasPassword === false, JSON.stringify(resurrect.body));
const diskResurrect = await waitForDisk((c) => !c.includes("LEGACY_PEM"));
check("stale password + old key gone from disk", !diskResurrect.includes("STALE_ORPHAN_PW") && !diskResurrect.includes("LEGACY_PEM"));
await req(`/ssh-hub/servers/${legacyId}`, "DELETE");

const keySrv = await req("/ssh-hub/servers", "POST", {
  name: "密钥机", host: "192.0.2.2", username: "ops",
  authKind: "privateKey", privateKey: "FAKE_PEM_CONTENT", passphrase: "FAKE_PASSPHRASE",
});
const keyId = keySrv.body?.server?.id;
const toPw = await req(`/ssh-hub/servers/${keyId}`, "PUT", {
  host: "192.0.2.2", username: "ops", authKind: "password", password: "REPLACEMENT_PW",
});
check("switch to password clears hasPrivateKey", toPw.body?.server?.hasPrivateKey === false && toPw.body?.server?.hasPassword === true, JSON.stringify(toPw.body));
const diskAfterKeySwitch = await waitForDisk((c) => !c.includes("FAKE_PEM_CONTENT"));
check("key+passphrase gone from disk after switch", !diskAfterKeySwitch.includes("FAKE_PEM_CONTENT") && !diskAfterKeySwitch.includes("FAKE_PASSPHRASE"));

const pw2 = await req("/ssh-hub/servers", "POST", {
  name: "密码机2", host: "192.0.2.4", port: 22, username: "ops",
  authKind: "password", password: "PW_TO_BE_CLEARED",
});
const pw2Id = pw2.body?.server?.id;
const toKey = await req(`/ssh-hub/servers/${pw2Id}`, "PUT", {
  host: "192.0.2.4", port: 22, username: "ops", authKind: "privateKey", privateKey: "NEW_PEM",
});
check("switch password->privateKey clears password", toKey.body?.server?.hasPassword === false && toKey.body?.server?.hasPrivateKey === true, JSON.stringify(toKey.body));
const diskAfterPwKey = await waitForDisk((c) => !c.includes("PW_TO_BE_CLEARED"));
check("old password gone from disk after pw->key switch", !diskAfterPwKey.includes("PW_TO_BE_CLEARED"));
await req(`/ssh-hub/servers/${pw2Id}`, "DELETE");

const noneSrv = await req("/ssh-hub/servers", "POST", {
  name: "无认证机", host: "192.0.2.3", username: "ops",
  authKind: "privateKey", privateKey: "NONE_PEM_CONTENT", passphrase: "NONE_PASSPHRASE",
});
const noneId = noneSrv.body?.server?.id;
const toNone = await req(`/ssh-hub/servers/${noneId}`, "PUT", {
  host: "192.0.2.3", username: "ops", authKind: "none",
});
check("switch to none clears key+passphrase flags", toNone.body?.server?.hasPrivateKey === false, JSON.stringify(toNone.body));
const diskAfterNone = await waitForDisk((c) => !c.includes("NONE_PEM_CONTENT"));
check("key+passphrase gone from disk after none switch", !diskAfterNone.includes("NONE_PEM_CONTENT") && !diskAfterNone.includes("NONE_PASSPHRASE"));

await req(`/ssh-hub/servers/${pwId}`, "DELETE");
await req(`/ssh-hub/servers/${keyId}`, "DELETE");
await req(`/ssh-hub/servers/${noneId}`, "DELETE");

console.log("3d. export");
const exp = await req("/ssh-hub/servers/export");
check("export returns version 1 + servers array", exp.status === 200 && exp.body?.version === 1 && Array.isArray(exp.body?.servers), JSON.stringify(exp.body).slice(0, 200));
check("export contains no secret fields", exp.body?.servers?.every((s) => s.password === undefined && s.privateKey === undefined && s.passphrase === undefined));
check("export body omits stored key path", !JSON.stringify(exp.body).includes(SSH_KEY));

const crossExp = await fetch(base + "/ssh-hub/servers/export", { headers: { origin: "http://evil.example" } });
check("cross-origin export rejected", crossExp.status === 403);
const crossImp = await fetch(base + "/ssh-hub/servers/import", {
  method: "POST",
  headers: { origin: "http://evil.example", "content-type": "application/json" },
  body: "[]",
});
check("cross-origin import rejected", crossImp.status === 403);

console.log("3e. import");
const beforeCount = (await req("/ssh-hub/servers")).body?.servers?.length ?? 0;
const poisoned = JSON.parse(JSON.stringify(exp.body));
for (const s of poisoned.servers) {
  s.password = "INJECTED_SECRET";
  s.hasPassword = true;
}
const imp = await req("/ssh-hub/servers/import", "POST", poisoned);
check("import reports count", imp.status === 200 && imp.body?.imported === poisoned.servers.length, JSON.stringify(imp.body));
const afterList = (await req("/ssh-hub/servers")).body?.servers ?? [];
check("import adds entries", afterList.length === beforeCount + poisoned.servers.length, `before=${beforeCount} after=${afterList.length}`);
const origIds = new Set(exp.body.servers.map((s) => s.id));
const importedEntries = afterList.filter((s) => !origIds.has(s.id));
check("import mints fresh ids", importedEntries.length === poisoned.servers.length && importedEntries.every((s) => typeof s.id === "string" && !origIds.has(s.id)));
check("imported entries carry no secrets", importedEntries.every((s) => s.hasPassword === false && s.hasPrivateKey === false));
const diskAfterImport = await waitForDisk((c) => importedEntries.every((s) => c.includes(s.id)));
check("injected secrets never reached disk", !diskAfterImport.includes("INJECTED_SECRET"));
for (const s of importedEntries) await req(`/ssh-hub/servers/${s.id}`, "DELETE");

const badImp = await req("/ssh-hub/servers/import", "POST", { hello: 1 });
check("malformed import -> 400", badImp.status === 400);
const badVersion = await req("/ssh-hub/servers/import", "POST", { version: 99, servers: [] });
check("unknown export version -> 400", badVersion.status === 400);
const garbageEntry = await req("/ssh-hub/servers/import", "POST", { servers: [{}] });
check("entry without host/username -> 400", garbageEntry.status === 400);

console.log("4. terminal session over WebSocket");
const sess = await req("/ssh-hub/sessions", "POST", { serverId, cols: 80, rows: 24 });
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

const sessionsNow = await req("/ssh-hub/sessions");
check("GET /sessions lists live session", sessionsNow.body?.sessions?.some((s) => s.id === sessionId));
check("session label correct", sessionsNow.body?.sessions?.find((s) => s.id === sessionId)?.label === `root@${SSH_HOST}:${SSH_PORT}`);

console.log("4b. host-owned sessions: detach survives, replay on reattach, idle reclaim");
ws.close();

await new Promise((r) => setTimeout(r, 500));
const sessionsAfterDetach = await req("/ssh-hub/sessions");
check("session survives ws close (detach, not kill)", sessionsAfterDetach.body?.sessions?.some((s) => s.id === sessionId));

// Reattach: the second ws must receive a replay of the earlier output WITHOUT
// us typing anything — proof the host buffered while detached. The collector
// is attached before open so the handshake-synchronous frames aren't missed.
const r2 = await collectWs(sessionId);
const replay = await r2.waitFor("DSH_MS_OK");
check("reattached ws receives scrollback replay", replay.includes("DSH_MS_OK"), replay.slice(-200));

r2.ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
r2.ws.send("echo DSH_MS_TWO\r");
const live2 = await r2.waitFor("DSH_MS_TWO");
check("reattached ws still gets live output", live2.includes("DSH_MS_TWO"), live2.slice(-200));

// Idle reclaim: no clients for idleReclaimMs (3000, injected at apply) -> reaped.
r2.ws.close();
await new Promise((r) => setTimeout(r, 4500));
const sessionsAfterIdle = await req("/ssh-hub/sessions");
check("idle session reclaimed after timeout", !sessionsAfterIdle.body?.sessions?.some((s) => s.id === sessionId));
const rejected = await new Promise((resolve) => {
  const w = new WebSocket(`ws://127.0.0.1:${server.address().port}/ssh-hub/ws/${sessionId}`);
  w.on("open", () => {
    w.close();
    resolve(false);
  });
  w.on("error", () => resolve(true));
});
check("ws attach to reaped session rejected", rejected);

console.log("4c. explicit close still terminates");
const sess2 = await req("/ssh-hub/sessions", "POST", { serverId, cols: 80, rows: 24 });
const sessionId2 = sess2.body?.id;
const ws3 = await openWs(sessionId2);
await new Promise((r) => setTimeout(r, 300));
ws3.close();
const del4 = await req(`/ssh-hub/sessions/${sessionId2}`, "DELETE");
check("DELETE /sessions/:id kills explicitly", del4.body?.ok === true, JSON.stringify(del4.body));
const afterDel = await req("/ssh-hub/sessions");
check("explicitly closed session gone", !afterDel.body?.sessions?.some((s) => s.id === sessionId2));
const delAgain = await req(`/ssh-hub/sessions/${sessionId2}`, "DELETE");
check("DELETE missing -> 404", delAgain.status === 404);

console.log("4d. global grid state (ADR-0005)");
const g0 = await req("/ssh-hub/grid");
check(
  "GET /grid starts single with one empty tile",
  g0.body?.grid?.template === "single" && Array.isArray(g0.body?.grid?.tiles) && g0.body?.grid?.tiles.length === 1 && g0.body?.grid?.tiles[0] === null,
  JSON.stringify(g0.body),
);

const gsess = await req("/ssh-hub/sessions", "POST", { serverId, cols: 80, rows: 24 });
const gsid = gsess.body?.id;
check("grid fixture session opened", typeof gsid === "string");

const gp = await req("/ssh-hub/grid", "PUT", { template: "split-h", tiles: [gsid, null] });
check(
  "PUT /grid saves template and pins",
  gp.body?.grid?.template === "split-h" && gp.body?.grid?.tiles?.[0] === gsid && gp.body?.grid?.tiles?.[1] === null,
  JSON.stringify(gp.body),
);
const g1 = await req("/ssh-hub/grid");
check("GET /grid returns saved state", g1.body?.grid?.template === "split-h" && g1.body?.grid?.tiles?.[0] === gsid, JSON.stringify(g1.body));

const gbad = await req("/ssh-hub/grid", "PUT", { template: "banana", tiles: [] });
check("PUT /grid rejects unknown template", gbad.status === 400);
const glen = await req("/ssh-hub/grid", "PUT", { template: "grid-4", tiles: [gsid] });
check("PUT /grid rejects wrong tile count", glen.status === 400);
const gdead = await req("/ssh-hub/grid", "PUT", { template: "split-h", tiles: ["ghost-session", gsid] });
check("PUT /grid clears unknown session pins", gdead.body?.grid?.tiles?.[0] === null && gdead.body?.grid?.tiles?.[1] === gsid, JSON.stringify(gdead.body));

// ws broadcast: connect, then PUT, expect the new state pushed.
const gws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ssh-hub/grid/events`);
const gridEvents = [];
gws.on("message", (d) => gridEvents.push(JSON.parse(String(d))));
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("grid ws open timeout")), 5000);
  gws.on("open", () => {
    clearTimeout(t);
    res();
  });
  gws.on("error", (e) => {
    clearTimeout(t);
    rej(e);
  });
});
await new Promise((r) => setTimeout(r, 300));
check("grid ws receives initial state", gridEvents.length >= 1 && gridEvents[0]?.template === "split-h", JSON.stringify(gridEvents));
await req("/ssh-hub/grid", "PUT", { template: "single", tiles: [gsid] });
await new Promise((r) => setTimeout(r, 300));
check("grid ws receives broadcast after PUT", gridEvents.some((e) => e?.template === "single"), JSON.stringify(gridEvents));
gws.close();

// Killing the pinned session clears its pins (registry reclaim hook).
const gdel = await req(`/ssh-hub/sessions/${gsid}`, "DELETE");
check("grid fixture session deleted", gdel.body?.ok === true);
const g2 = await req("/ssh-hub/grid");
check("deleting a session clears its pins", g2.body?.grid?.tiles?.[0] === null, JSON.stringify(g2.body));

console.log("4e. unattached sessions are reclaimed too");
// A session that never had a WebSocket attached must still hit the idle
// reclaim — otherwise it leaks forever (registry arms the timer on add).
const sess3 = await req("/ssh-hub/sessions", "POST", { serverId, cols: 80, rows: 24 });
const sessionId3 = sess3.body?.id;
check("unattached fixture session opened", typeof sessionId3 === "string");
await new Promise((r) => setTimeout(r, 4500));
const afterUnattached = await req("/ssh-hub/sessions");
check("session with no ws ever attached is reclaimed", !afterUnattached.body?.sessions?.some((s) => s.id === sessionId3));

console.log("5. cleanup");
const del = await req(`/ssh-hub/servers/${serverId}`, "DELETE");
check("DELETE /servers/:id ok", del.body?.ok === true);
const del2 = await req(`/ssh-hub/servers/${serverId}`, "DELETE");
check("DELETE missing -> 404", del2.status === 404);

console.log("6. storage persistence");
const listed2 = await req("/ssh-hub/servers");
check("store empty after delete", (listed2.body?.servers?.length ?? 0) === 0);

console.log("6b. graceful degradation without the settings service");
// A second host instance on a DSH without `ctx.settings`: must apply without
// throwing and still register its routes (the async registration path must
// not blow up either).
const noSettingsRoutes = [];
const ctxNoSettings = {
  webServer: {
    register: (r) => {
      noSettingsRoutes.push(r);
      return () => {};
    },
    registerUpgrade: () => () => {},
  },
  effect: () => {},
  inject: () => {},
};
settingsAvailable = false;
let degraded = false;
try {
  apply(ctxNoSettings, {});
  await new Promise((r) => setTimeout(r, 100)); // let the async import path settle
  degraded = noSettingsRoutes.length > 0;
} catch (e) {
  console.error("  degradation apply threw:", e);
}
settingsAvailable = true;
check("host applies and serves routes without the settings service", degraded);

ws.close();
server.close();
blackhole.close();
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
