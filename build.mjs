/**
 * dsh-ssh-hub — build script.
 *
 * Two artifacts:
 *  1. lib/index.js   — host half (Node ESM), bundled from src/host/index.ts
 *  2. lib/client.js  — client half (browser bundle), built from
 *                      src/client/client-main.tsx in the DSH ModuleLoader
 *                      format (window.__ModuleLoader__.load) and shipped via
 *                      the package's ./client export.
 *
 * The client bundle is fully self-contained except `react` (provided by the
 * DSH web shell) and xterm.css (served by the host half at /ssh-hub/...).
 */
import { build } from "esbuild";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const out = (p) => fileURLToPath(new URL(p, import.meta.url));

mkdirSync(out("./lib"), { recursive: true });

/* ------------------------------------------------------------------ */
/* 1. host half                                                        */
/* ------------------------------------------------------------------ */
await build({
  entryPoints: [out("./src/host/index.ts")],
  outfile: out("./lib/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  sourcemap: true,
  minify: false,
  legalComments: "none",
  logLevel: "warning",
  // dsh-settings/schemastery resolve from the DSH profile's node_modules at
  // runtime (they ship with dsh-base); never bundle them into lib/index.js,
  // and the dynamic import keeps older profiles loadable.
  external: ["ssh2", "ws", "@deepseek-ai/dsh-settings", "@deepseek-ai/schemastery"],
});

/* ------------------------------------------------------------------ */
/* 2. client half                                                      */
/* ------------------------------------------------------------------ */
const clientEntry = out("./src/client/client-main.tsx");
const result = await build({
  entryPoints: [clientEntry],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["es2020"],
  write: false,
  // minify: false — esbuild's aggressive renaming can reorder const/let
  // declarations across xterm's module boundaries and trigger
  // "Cannot access 'X' before initialization" at runtime (TDZ).
  minify: false,
  legalComments: "none",
  logLevel: "warning",
  external: ["react"],
  loader: { ".css": "css" },
});

const code = result.outputFiles[0].text;

const factoryBody = [
  "var module = { exports: {} };",
  "var exports = module.exports;",
  code,
  "var __mod = module.exports;",
  "var __terminalWindow = __mod.TerminalWindow;",
  "var __setTerminalVisible = __mod.setTerminalVisible;",
  "var __getTerminalVisible = __mod.getTerminalVisible;",
  "var __setTerminalMaximized = __mod.setTerminalMaximized;",
  "var __getTerminalMaximized = __mod.getTerminalMaximized;",
  "var __sidebarEntry = __mod.SidebarEntry;",
  "var __settingsCard = __mod.SettingsCard;",
  "var __setSettingsScope = __mod.setSettingsScope;",
  "return {",
  "  apply: function (ctx) {",
  "    // Terminal Theme signal: prefer the DSH theme service; fall back to",
  "    // prefers-color-scheme while (or when) the service is unavailable.",
  "    var mq = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)');",
  "    var useFallback = true;",
  "    var pushFallback = function () {",
  "      if (useFallback && __mod.setGuiScheme) __mod.setGuiScheme(mq && mq.matches ? 'dark' : 'light');",
  "    };",
  "    if (mq) {",
  "      pushFallback();",
  "      mq.addEventListener('change', pushFallback);",
  "    }",
  "    if (typeof ctx.inject === 'function') {",
  "      ctx.inject(['theme'], function (c) {",
  "        var push = function (snap) {",
  "          var cs = snap && snap.active && snap.active.colorScheme;",
  "          if (cs === 'light' || cs === 'dark') {",
  "            useFallback = false;",
  "            if (__mod.setGuiScheme) __mod.setGuiScheme(cs);",
  "          }",
  "        };",
  "        try { push(c.theme.getTheme()); } catch (e) { /* theme service not ready yet */ }",
  "        c.on('theme/change', push);",
  "      });",
  "    }",
  "    // Frame-wide Terminal Window (ADR-0006): root scope, one instance,",
  "    // renders nothing while hidden. The only frame-level seat DSH offers.",
  "    if (__terminalWindow) {",
  "      ctx.slots.inject('shell.overlay', function () {",
  "        return ctx.slots.register(",
  "          { name: 'shell.overlay', id: 'ssh-hub-terminal', order: 100, label: 'SSH Hub Terminal' },",
  "          __terminalWindow",
  "        );",
  "      });",
  "    }",
  "    // Sidebar entry: one button opening the Focus View (ADR-0005). The",
  "    // sidebar's browsing/settings seats are single and occupied, so this",
  "    // foot-action seat is the only incremental one.",
  "    if (__sidebarEntry && __setTerminalVisible) {",
  "      ctx.slots.inject('sidebar.footer.action', function () {",
  "        return ctx.slots.register(",
  "          { name: 'sidebar.footer.action', id: 'ssh-hub-focus', order: 100, label: 'SSH Hub Terminals' },",
  "          __sidebarEntry",
  "        );",
  "      });",
  "    }",
  "    // Configurable shortcuts (settings card): the terminal window toggle",
  "    // and maximize. Bindings live in localStorage and are read on every",
  "    // keydown, so a change applies immediately.",
  "    if (__setTerminalVisible && __getTerminalVisible && typeof window !== 'undefined') {",
  "      var __parseBinding = function (text) {",
  "        var parts = String(text || '').split('+').map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });",
  "        if (parts.length < 2) return null;",
  "        var b = { ctrl: false, shift: false, alt: false, meta: false, code: '' };",
  "        for (var i = 0; i < parts.length; i++) {",
  "          var low = parts[i].toLowerCase();",
  "          if (low === 'ctrl' || low === 'control') b.ctrl = true;",
  "          else if (low === 'shift') b.shift = true;",
  "          else if (low === 'alt' || low === 'option') b.alt = true;",
  "          else if (low === 'meta' || low === 'cmd' || low === 'win') b.meta = true;",
  "          else { if (b.code !== '') return null; b.code = parts[i]; }",
  "        }",
  "        if (b.code === '' || (!b.ctrl && !b.alt && !b.meta && !b.shift)) return null;",
  "        return b;",
  "      };",
  "      var __matchKey = function (e, b) {",
  "        if (!b) return false;",
  "        if (e.ctrlKey !== b.ctrl || e.shiftKey !== b.shift || e.altKey !== b.alt || e.metaKey !== b.meta) return false;",
  "        return e.code === b.code || e.key === b.code || e.key.toLowerCase() === b.code.toLowerCase();",
  "      };",
  "      var __loadBinding = function (action) {",
  "        var def = action === 'toggleWindow' ? 'Ctrl+Shift+`' : 'Ctrl+Alt+`';",
  "        try {",
  "          var raw = localStorage.getItem('dsh-ssh-hub.keys');",
  "          if (raw) { var obj = JSON.parse(raw); if (typeof obj[action] === 'string' && obj[action].length > 0) return __parseBinding(obj[action]); }",
  "        } catch (e) { /* ignore */ }",
  "        return __parseBinding(def);",
  "      };",
  "      var __onTerminalKey = function (e) {",
  "        if (e.key === 'Escape') return;",
  "        if (__matchKey(e, __loadBinding('toggleWindow'))) {",
  "          e.preventDefault();",
  "          __setTerminalVisible(!__getTerminalVisible());",
  "          return;",
  "        }",
  "        if (__setTerminalMaximized && __getTerminalMaximized && __matchKey(e, __loadBinding('maximizeWindow'))) {",
  "          e.preventDefault();",
  "          __setTerminalMaximized(!__getTerminalMaximized());",
  "        }",
  "      };",
  "      window.addEventListener('keydown', __onTerminalKey);",
  "      if (typeof ctx.effect === 'function') {",
  "        ctx.effect(function () {",
  "          return function () { window.removeEventListener('keydown', __onTerminalKey); };",
  "        });",
  "      }",
  "    }",
  "    // rc.7 settings card: register into the keyed settings.plugin.item",
  "    // slot when the settingsScope service is available; the panel reuses",
  "    // the bound scope for the Terminal Theme default. Any absence (older",
  "    // DSH, namespace not served) degrades silently — the rest of the",
  "    // panel keeps working without the card.",
  "    try {",
  "      var settingsScope = ctx.get ? ctx.get('settingsScope') : undefined;",
  "      if (settingsScope && typeof settingsScope.bind === 'function') {",
  "        var bound = settingsScope.bind({ namespace: 'ssh-hub' });",
  "        if (__setSettingsScope) __setSettingsScope(bound);",
  "        ctx.slots.inject('settings.plugin.item', function () {",
  "          return ctx.slots.register(",
  "            { name: 'settings.plugin.item', key: 'ssh-hub', order: 0 },",
  "            __settingsCard || (function () { return null; })",
  "          );",
  "        });",
  "      }",
  "    } catch (e) {",
  "      /* settingsScope or slot missing on pre-rc.7 DSH — card absent, panel fine */",
  "    }",
  "  },",
  "  inject: ['slots'],",
  "};",
].join("\n");

const finalJs = [
  "/**",
  " * dsh-ssh-hub - client bundle (multi-server SSH terminal panel).",
  " * Built by build.mjs from src/client/client-main.tsx. Do not edit by hand.",
  " */",
  "window.__ModuleLoader__.load({",
  "  id: 'dsh-ssh-hub',",
  "  factory: (require) => {",
  "    " + factoryBody,
  "  },",
  "});",
].join("\n");

writeFileSync(out("./lib/client.js"), finalJs);

/* ------------------------------------------------------------------ */
/* 3. smoke-test the client bundle in the ModuleLoader harness.        */
/* ------------------------------------------------------------------ */
/* The loader entry must evaluate without throwing at load time.       */
/* esbuild emits a bare identifier that is never declared (e.g. a      */
/* renamed component left behind in `export default X`) as an          */
/* undefined global, so a broken bundle used to build and ship         */
/* silently and only explode in the browser — "X is not defined"       */
/* when the factory runs. Evaluating the factory here, with browser    */
/* stubs, catches that class before the artifact is committed.         */
import vm from "node:vm";

(function smokeTestClientBundle() {
  let captured = null;
  const noopEl = () => ({
    style: {},
    getContext: () => null,
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
  });
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          captured = entry;
        },
      },
      PointerEvent: undefined,
      maxTouchPoints: 0,
      matchMedia: undefined,
      localStorage: undefined,
      addEventListener() {},
      removeEventListener() {},
    },
    matchMedia: undefined,
    localStorage: undefined,
    document: {
      queryCommandSupported: () => false,
      getElementById: () => null,
      createElement: noopEl,
      head: { appendChild() {} },
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    navigator: {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      platform: "Linux x86_64",
      language: "en-US",
      languages: ["en-US"],
      maxTouchPoints: 0,
      clipboard: undefined,
      keyboard: undefined,
    },
    requestAnimationFrame: undefined,
    cancelAnimationFrame: undefined,
    performance: undefined,
    queueMicrotask,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(finalJs, sandbox, { filename: "lib/client.js" });
  if (!captured) {
    throw new Error("client bundle: loader entry was not registered");
  }
  const plugin = captured.factory((id) => {
    if (id === "react") return require("react");
    throw new Error("client bundle: unexpected require(" + id + ")");
  });
  if (!plugin || typeof plugin.apply !== "function") {
    throw new Error("client bundle: factory did not return a Cordis plugin");
  }
  console.log("client: loader entry load smoke-test passed");
})();

/* ship xterm.css into lib (served by the host half) */
try {
  const xtermCssPath = require.resolve("@xterm/xterm/css/xterm.css");
  copyFileSync(xtermCssPath, out("./lib/client.css"));
  console.log("xterm.css copied");
} catch {
  console.warn("xterm.css not found — client degrades gracefully");
}

console.log(
  "host:  lib/index.js (" +
    (await import("node:fs")).statSync(out("./lib/index.js")).size +
    " bytes)",
);
console.log("client: lib/client.js (" + finalJs.length + " bytes)");
