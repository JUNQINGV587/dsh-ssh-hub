#!/usr/bin/env node
/**
 * clean-blank-sessions — 自动清理 DSH 的空会话（0 条消息、无标题）。
 *
 * 背景：DSH Web 前端每次全新加载时，若当前工作区没有空白会话会自动新建一个
 * （startInitialSelection -> connectWorkspace -> session.create）。E2E 测试 /
 * 多浏览器访问会在反复全新加载后留下大量从未使用过的空会话。
 *
 * 本脚本：
 *   1. 扫描 ~/.dsh/sessions 下各工作区目录（--data-* 前缀）的会话日志（仅 session-* 前缀，跳过 subagent）
 *   2. 解压 session.jsonl.zstd 判断是否空会话（无任何 user/message 与 assistant/message）
 *   3. 通过 dsh-session-manager 的 /dsh-session-manager/delete 路由删除（归档 + 进回收站记录），
 *      与原文件目录一并移入 ~/.dsh/dsh-delete-session-trash/，与 GUI 手动删除行为一致
 *
 * 用法：
 *   node scripts/clean-blank-sessions.mjs                 # 实际清理（默认 min-age 10 分钟）
 *   node scripts/clean-blank-sessions.mjs --dry-run       # 只列出，不删除
 *   node scripts/clean-blank-sessions.mjs --min-age 1     # 允许清理 1 分钟前的空会话
 *   node scripts/clean-blank-sessions.mjs --base http://127.0.0.1:3080
 *
 * 安全保护：
 *   - 只删「0 条消息」的会话；subagent（派生会话）一律跳过
 *   - min-age 内的空会话跳过（防止误删正在被页面/测试使用的空白会话）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, rm, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const SESSIONS_ROOT = join(HOME, ".dsh", "sessions");
const TRASH_ROOT = join(HOME, ".dsh", "dsh-delete-session-trash");
const DEFAULT_MIN_AGE_MINUTES = 10;
const SESSION_ID_RE = /^session-[0-9a-fA-F-]{8,}$/;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const minAgeMs =
  (Number(argValue("--min-age")) || DEFAULT_MIN_AGE_MINUTES) * 60 * 1000;
const base = argValue("--base") || "http://127.0.0.1:3080";
const now = Date.now();

/** 解压并解析会话日志，返回 { createdAt, origin, parentSession, nUser, nAssist } */
function inspectSession(dir) {
  const logPath = join(dir, "session.jsonl.zstd");
  if (!existsSync(logPath)) return null;
  let raw;
  try {
    raw = execFileSync("zstd", ["-dc", logPath], { maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
  const info = { createdAt: null, origin: null, parentSession: null, nUser: 0, nAssist: 0 };
  for (const line of raw.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    switch (o.type) {
      case "session":
        info.createdAt = o.createdAt;
        info.origin = o.origin ?? null;
        info.parentSession = o.parentSession ?? null;
        break;
      case "user/message":
        info.nUser++;
        break;
      case "assistant/message":
        info.nAssist++;
        break;
    }
  }
  return info;
}

async function deleteSession(sessionId, dir) {
  // 1) 走 dsh-session-manager 路由：归档 + 写入回收站记录（与 GUI 手动删除一致）
  const res = await fetch(`${base}/dsh-session-manager/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || body.ok !== true) {
    return `路由删除失败 (HTTP ${res.status}): ${JSON.stringify(body)}`;
  }
  // 2) 若原文件目录仍在（host 上 agent 实例存活时路由不会移动文件），手动移入回收站
  if (existsSync(dir)) {
    const trashDir = join(TRASH_ROOT, sessionId);
    await rm(trashDir, { recursive: true, force: true });
    await mkdir(TRASH_ROOT, { recursive: true });
    await rename(dir, trashDir);
  }
  return null;
}

// 收集所有会话目录
const workspaces = readdirSync(SESSIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("--data"))
  .map((e) => join(SESSIONS_ROOT, e.name));

const candidates = [];
for (const ws of workspaces) {
  for (const entry of readdirSync(ws, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue;
    candidates.push({ id: entry.name, dir: join(ws, entry.name) });
  }
}

const found = [];
for (const { id, dir } of candidates) {
  const info = inspectSession(dir);
  if (!info) continue;
  if (info.origin === "subagent" || info.parentSession) continue; // 派生会话不碰
  if (info.nUser > 0 || info.nAssist > 0) continue; // 有内容的不碰
  const ageMs = info.createdAt ? now - info.createdAt : Infinity;
  if (ageMs < minAgeMs) continue; // 太新，可能是正在使用的空白
  found.push({ id, dir, created: info.createdAt ? new Date(info.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "?" });
}

if (found.length === 0) {
  console.log(`[clean-blank-sessions] 没有需要清理的空会话 (min-age=${minAgeMs / 60000}min)`);
  process.exit(0);
}

console.log(`[clean-blank-sessions] 发现 ${found.length} 个空会话（${dryRun ? "DRY-RUN，不删除" : "开始清理"}）：`);
for (const f of found) console.log(`  - ${f.id}  (创建于 ${f.created})`);

if (dryRun) {
  console.log("[clean-blank-sessions] --dry-run 结束，未做任何删除");
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const f of found) {
  const err = await deleteSession(f.id, f.dir);
  if (err) {
    failed++;
    console.error(`  ✗ ${f.id}: ${err}`);
  } else {
    ok++;
    console.log(`  ✓ ${f.id} 已删除（移入回收站）`);
  }
}
console.log(`[clean-blank-sessions] 完成：删除 ${ok} 个，失败 ${failed} 个`);
process.exit(failed > 0 ? 1 : 0);
