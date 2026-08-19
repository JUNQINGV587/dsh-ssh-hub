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
  "    // Ctrl+Shift+` toggles the Terminal Window from anywhere (keyboard",
  "    // bindings become configurable in the settings card in a later pass).",
  "    if (__setTerminalVisible && __getTerminalVisible && typeof window !== 'undefined') {",
  "      var __onTerminalKey = function (e) {",
  "        if (e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && e.code === 'Backquote') {",
  "          e.preventDefault();",
  "          __setTerminalVisible(!__getTerminalVisible());",
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
