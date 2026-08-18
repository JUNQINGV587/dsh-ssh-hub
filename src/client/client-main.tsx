/**
 * dsh-ssh-hub - client half (xterm.js, multi-server SSH terminal panel).
 *
 * A bottom panel (Codex/VS Code style, same interaction language as
 * dsh-plugin-terminal) for managing SSH servers and opening multiple live
 * terminal tabs against them:
 *   - server drawer: list / add / edit / delete / test-connect
 *   - tab bar: one tab per open SSH shell, Ctrl+` toggles the panel
 *   - each tab owns an independent xterm instance + WebSocket
 *
 * Visual language follows DSH design tokens; the Terminal Area follows the
 * Terminal Theme (shared palette module, light/dark variants) so ANSI colors
 * stay readable in both themes. See docs/adr/0002-adaptive-terminal-theme.md.
 */
import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { TERMINAL_THEMES } from "../shared/terminal-themes.mjs";
import {
  pin as gridPin,
  unpin as gridUnpin,
  reorder as gridReorder,
  withTemplate as gridWithTemplate,
  fitCount,
  gridAreas,
  tileLetter,
  TEMPLATES,
} from "../shared/grid.mjs";
/* Settings card + the shared bound settings scope (rc.7 settings.plugin.item).
 * getSettingsScope is imported for module-internal use (the theme chain);
 * SettingsCard/setSettingsScope are re-exported for the build.mjs wrapper. */
import { getSettingsScope } from "./settings-card.js";
export { SettingsCard, setSettingsScope } from "./settings-card.js";

const PREFIX = "/ssh-hub";
const HEIGHT_KEY = "dsh-ssh-hub.height";
const MIN_HEIGHT = 120;
const OVERRIDE_KEY = "dsh-ssh-hub.termTheme";
const OVERRIDE_ORDER = ["auto", "dark", "light"] as const;
type ThemeOverride = (typeof OVERRIDE_ORDER)[number];
const OVERRIDE_LABEL: Record<ThemeOverride, string> = {
  auto: "跟随界面",
  dark: "深色",
  light: "浅色",
};

/* xterm stylesheet served by the host plugin */
const XTERM_CSS_TAG = "dsh-ssh-hub-xterm-css";
if (typeof document !== "undefined" && document.getElementById(XTERM_CSS_TAG) === null) {
  const link = document.createElement("link");
  link.id = XTERM_CSS_TAG;
  link.rel = "stylesheet";
  link.href = PREFIX + "/xterm.css";
  document.head.appendChild(link);
}

const STYLE_TAG = "dsh-ssh-hub-styles";
const CSS = `
/* In the layout flow of conversation.input.dock: the slot is a full-width row
 * above the composer, so the panel takes honest space and pushes conversation
 * content up instead of covering it (ADR-0005). */
.dmsRoot{width:100%;font-family:Inter,var(--dsw-font-family)}
.dmsBar{box-sizing:border-box;width:100%;height:34px;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--dsw-specific-tip);border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer;color:var(--dsw-alias-label-primary);text-align:left;user-select:none;-webkit-user-select:none}
.dmsBar:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.dmsBarLead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.dmsBarTitle{min-width:0;flex:none;font-size:13px;font-weight:500;line-height:24px}
.dmsBarState{min-width:0;flex:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmsBarActions{flex:none;align-items:center;gap:2px;display:flex}
.dmsBarAction{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}
.dmsBarAction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmsBarAction:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.dmsBarAction:disabled{cursor:default;opacity:.45}
.dmsBarChevron{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}
.dmsBarChevron:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsPanel{box-sizing:border-box;width:100%;display:flex;flex-direction:column;background:var(--dsw-specific-tip);border-top:1px solid var(--dsw-alias-border-l1);overflow:hidden;animation:dmsIn .16s ease-out}
@keyframes dmsIn{from{transform:translateY(14px);opacity:.4}to{transform:none;opacity:1}}
.dmsResize{flex:none;height:6px;cursor:ns-resize;touch-action:none;position:relative}
.dmsResize:after{content:'';position:absolute;left:0;right:0;top:2px;height:2px;border-radius:2px;background:transparent;transition:background .15s}
.dmsResize:hover:after{background:var(--dsw-alias-interactive-bg-hover)}
.dmsTabs{flex:none;box-sizing:border-box;height:36px;display:flex;align-items:center;gap:2px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip)}
.dmsTabsScroll{flex:1;min-width:0;display:flex;align-items:center;gap:2px;height:100%;overflow-x:auto;scrollbar-width:none}
.dmsTabsScroll::-webkit-scrollbar{display:none}
.dmsTabsLead{color:var(--dsw-alias-label-tertiary);flex:none;display:grid;place-items:center;margin-right:2px}
.dmsTabsState{flex:none;max-width:200px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 6px}
.dmsTab{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 6px 0 9px;border-radius:7px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer;flex:none;max-width:220px}
.dmsTab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsTab.isActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsTab:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.dmsTab.isClosed{opacity:.5}
.dmsTabLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmsTabDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.dmsTabDot.isConnecting{background:#e8b339;animation:dmsPulse 1s ease-in-out infinite}
.dmsTabDot.isLive{background:#2ee62e}
.dmsTabDot.isClosed{background:#e74856}
@keyframes dmsPulse{50%{opacity:.35}}
.dmsTabClose{width:20px;height:20px;border:none;background:transparent;color:inherit;border-radius:6px;display:grid;place-items:center;cursor:pointer;padding:0;opacity:0;flex:none}
.dmsTab:hover .dmsTabClose,.dmsTab.isActive .dmsTabClose{opacity:.65}
.dmsTabClose:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dmsTabPin{width:18px;height:18px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:5px;display:grid;place-items:center;cursor:pointer;padding:0;flex:none;opacity:.55}
.dmsTab:hover .dmsTabPin{opacity:.8}
.dmsTabPin:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dmsTabPin.isPinned{opacity:1;color:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff))}
.dmsTool{flex:none;box-sizing:border-box;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip);font-size:12px}
.dmsToolBtn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer;flex:none}
.dmsToolBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsToolBtn:disabled{cursor:default;opacity:.45}
.dmsToolBtn.primary{background:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));border-color:transparent;color:#fff}
.dmsToolBtn.primary:hover:not(:disabled){filter:brightness(1.1)}
.dmsBody{flex:auto;min-height:0;position:relative;background:var(--dmst-bg,#1e2128);box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}
/* Grid: Tiles arrange pinned Terminal Sessions (ADR-0005). */
.dmsGrid{position:relative;height:100%;display:grid;gap:4px;padding:4px 6px 8px;box-sizing:border-box}
.dmsTile{position:relative;min-width:0;min-height:0;background:var(--dmst-bg,#1e2128);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dmsTile.isDragFrom{opacity:.75}
.dmsTile.isDragTarget{outline:2px solid var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));outline-offset:-2px}
.dmsTileEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--dmst-empty-fg,#8b90a0);font-family:Inter,var(--dsw-font-family);font-size:12px;cursor:pointer;background:var(--dmst-picker-bg,#262a33);border:none;width:100%}
.dmsTileEmpty:hover{background:var(--dmst-picker-item-bg-hover,#2e333d);color:var(--dmst-picker-item-fg,#e6e8ee)}
.dmsTileUnpin{position:absolute;top:6px;right:6px;z-index:6;width:24px;height:24px;border:none;background:rgba(0,0,0,.45);color:#e6e8ee;border-radius:7px;cursor:pointer;display:grid;place-items:center;padding:0;opacity:0;transition:opacity .12s}
.dmsTile:hover .dmsTileUnpin,.dmsTileUnpin:focus-visible{opacity:1}
.dmsTileUnpin:hover{background:rgba(231,72,86,.35)}
.dmsTilePick{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;background:var(--dmst-picker-bg,#262a33);padding:8px;overflow-y:auto}
.dmsTilePickTitle{font-size:11px;font-weight:600;color:var(--dmst-picker-label-fg,#8b90a0);padding:2px 6px 6px}
.dmsDegrade{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dmst-empty-fg,#8b90a0);font-family:Inter,var(--dsw-font-family);font-size:12px;text-align:center;padding:20px}
.dmsPane{position:absolute;inset:0;display:none;padding:4px 10px 8px;background:var(--dmst-bg,#1e2128)}
.dmsPane.isActive{display:block}
.dmsEmpty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dmst-empty-fg,#8b90a0);font-family:Inter,var(--dsw-font-family);font-size:12px}
.dmsEmptyBtn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dmst-empty-btn-bg,#2a2e38);color:var(--dmst-empty-btn-fg,#e6e8ee);font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer}
.dmsEmptyBtn:hover{background:var(--dmst-empty-btn-bg-hover,#343946)}
.dmsErr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;color:var(--dmst-err-fg,#e6b0b0);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;text-align:center}
/* server picker (inside the Terminal Area, follows the Terminal Theme) */
.dmsPicker{box-sizing:border-box;background:var(--dmst-picker-bg,#262a33);border:1px solid var(--dmst-picker-border,#3a3f4b)}
.dmsPickerLabel{font-size:11px;font-weight:600;color:var(--dmst-picker-label-fg,#8b90a0);padding:2px 6px 6px}
.dmsPickerItem{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border-radius:7px;border:none;background:transparent;color:var(--dmst-picker-item-fg,#e6e8ee);font-family:Inter,var(--dsw-font-family);font-size:12.5px;text-align:left;cursor:pointer}
.dmsPickerItem:hover:not(:disabled){background:var(--dmst-picker-item-bg-hover,#2e333d)}
.dmsPickerMeta{color:var(--dmst-picker-label-fg,#8b90a0)}
.dmsPickerFoot{display:flex;align-items:center;justify-content:space-between;padding:6px 6px 0;border-top:1px solid var(--dmst-picker-foot-border,#333947);margin-top:4px}
.dmsPickerLink{border:none;background:transparent;color:var(--dmst-picker-label-fg,#8b90a0);font-size:11.5px;cursor:pointer;padding:4px 6px}
.dmsPickerLink:hover{color:var(--dmst-picker-item-fg,#e6e8ee)}
body.dmsResizing{cursor:ns-resize!important;user-select:none!important;-webkit-user-select:none!important}
/* server drawer */
.dmsOverlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.38);display:flex;justify-content:flex-end}
.dmsDrawer{box-sizing:border-box;width:min(520px,92vw);height:100%;background:var(--dsw-specific-tip,var(--dsw-bg,#1b1d23));border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;font-family:Inter,var(--dsw-font-family);animation:dmsDrawerIn .18s ease-out}
@keyframes dmsDrawerIn{from{transform:translateX(24px);opacity:.5}to{transform:none;opacity:1}}
.dmsDrawerHead{flex:none;box-sizing:border-box;height:44px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dmsDrawerTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1}
.dmsDrawerX{width:26px;height:26px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:7px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsDrawerX:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsDrawerBody{flex:auto;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dmsSrvRow{box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-bg-card,transparent);cursor:pointer}
.dmsSrvRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsSrvMain{min-width:0;flex:1}
.dmsSrvName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmsSrvMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.dmsSrvBadge{font-size:10px;line-height:16px;padding:0 7px;border-radius:999px;flex:none}
.dmsSrvBadge.auth{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dmsSrvAct{display:flex;gap:2px;flex:none}
.dmsIconBtn{width:26px;height:26px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:7px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsIconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsField{display:flex;flex-direction:column;gap:5px}
.dmsField label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dmsInput{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-bg-input,transparent);color:var(--dsw-alias-label-primary);font-family:Inter,var(--dsw-font-family);font-size:12.5px;outline:none}
.dmsInput:focus{border-color:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff))}
.dmsInput::placeholder{color:var(--dsw-alias-label-tertiary)}
textarea.dmsInput{height:auto;min-height:64px;padding:8px 10px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5}
.dmsRadioRow{display:flex;gap:6px;flex-wrap:wrap}
.dmsRadio{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12px;cursor:pointer}
.dmsRadio.isSel{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff))}
.dmsHint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dmsErrText{font-size:12px;color:#e6b0b0;line-height:1.5;white-space:pre-wrap}
.dmsOkText{font-size:12px;color:#7ddb7d;line-height:1.5}
.dmsDrawerFoot{flex:none;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.dmsTransferMsg{flex:none;padding:8px 14px 0}
.dmsBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-family:Inter,var(--dsw-font-family);font-size:12.5px;font-weight:500;cursor:pointer;flex:none}
.dmsBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmsBtn:disabled{cursor:default;opacity:.45}
.dmsBtn.primary{background:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));border-color:transparent;color:#fff}
.dmsBtn.primary:hover:not(:disabled){filter:brightness(1.1)}
.dmsBtn.danger:hover{background:rgba(231,72,86,.14);border-color:rgba(231,72,86,.5);color:#ff8b93}
.dmsSpacer{flex:1}
.dmsEmptyState{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12.5px}
/* Focus View: frame-wide surface (shell.overlay), z below the server drawer */
.dmsFocusRoot{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;background:var(--dsw-specific-tip);font-family:Inter,var(--dsw-font-family)}
.dmsFocusHead{flex:none;box-sizing:border-box;height:44px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip)}
.dmsFocusTitle{flex:none;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dmsFocusHead .dmsTabs{flex:1;min-width:0;border-bottom:none;padding:0}
.dmsFocusExit{flex:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer}
.dmsFocusExit:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Sidebar foot entry (sidebar.footer.action seat) */
.dmsSidebarEntry{display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12.5px;font-weight:500;cursor:pointer;text-align:left}
.dmsSidebarEntry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsSidebarEntry:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.dmsSidebarEntry.isRail{justify-content:center;padding:0}
.dmsSidebarEntryIcon{flex:none;display:grid;place-items:center}
`.trim();
if (typeof document !== "undefined" && document.getElementById(STYLE_TAG) === null) {
  const tag = document.createElement("style");
  tag.id = STYLE_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const TERM_THEME = TERMINAL_THEMES.dark.xterm;

/* ---------------- terminal theme signal bridge ---------------- */

type GuiScheme = "light" | "dark";

let currentGuiScheme: GuiScheme = "dark";
const guiSchemeListeners = new Set<() => void>();

/**
 * Pushed by the host bundle wrapper (build.mjs) from the DSH theme service
 * (`theme/change`) or the `prefers-color-scheme` fallback.
 */
export function setGuiScheme(s: GuiScheme) {
  if (s !== "light" && s !== "dark") return;
  if (s === currentGuiScheme) return;
  currentGuiScheme = s;
  for (const l of [...guiSchemeListeners]) l();
}

function subscribeGuiScheme(listener: () => void) {
  guiSchemeListeners.add(listener);
  return () => {
    guiSchemeListeners.delete(listener);
  };
}

function getGuiScheme(): GuiScheme {
  return currentGuiScheme;
}

/* ---------------- Server Defaults terminal-theme signal ---------------- */
/**
 * The `defaultTerminalTheme` Server Default, pushed from the bound settings
 * scope (rc.7). Middle layer of the theme chain: local Theme Override wins,
 * then this, then the GUI scheme. Stays "auto" on DSH without settings.
 */
type DefaultTheme = "auto" | "dark" | "light";
let currentDefaultTheme: DefaultTheme = "auto";
const defaultThemeListeners = new Set<() => void>();

function pushDefaultTheme(v: unknown) {
  const next: DefaultTheme = v === "dark" || v === "light" || v === "auto" ? v : "auto";
  if (next === currentDefaultTheme) return;
  currentDefaultTheme = next;
  for (const l of [...defaultThemeListeners]) l();
}

function subscribeDefaultTheme(listener: () => void) {
  defaultThemeListeners.add(listener);
  return () => {
    defaultThemeListeners.delete(listener);
  };
}

function getDefaultTheme(): DefaultTheme {
  return currentDefaultTheme;
}

/** Open xterm instances by tab id, for hot theme swapping. */
const termRegistry = new Map<string, Terminal>();

/* ---------------- helpers ---------------- */

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(PREFIX + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return body;
}

type AuthKind = "password" | "privateKey" | "agent" | "none";

interface ServerView {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: AuthKind;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  remoteCwd?: string;
  readyTimeout?: number;
  keepaliveInterval?: number;
  strictHostKey?: boolean;
}

/** Server Defaults as served by GET /ssh-hub/defaults (seconds at this seam). */
interface ServerDefaults {
  defaultReadyTimeoutSec: number;
  defaultKeepaliveIntervalSec: number;
  defaultStrictHostKey: boolean;
  defaultTerminalTheme: "auto" | "dark" | "light";
}

type TabStatus = "connecting" | "live" | "closed" | "error";

interface TermTab {
  id: string;
  serverId: string;
  label: string;
  status: TabStatus;
  error?: string;
}

/* ---------------- small icons ---------------- */

const Icon = {
  terminal: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x={1.35} y={1.35} width={11.3} height={11.3} rx={2.4} stroke="currentColor" strokeWidth={1.05} />
      <path d="M4.75 4.9L7.05 7L4.75 9.1" stroke="currentColor" strokeWidth={1.05} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.75 9.1H10.05" stroke="currentColor" strokeWidth={1.05} strokeLinecap="round" />
    </svg>
  ),
  chevronUp: () => (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.8486 8.5L11.4238 8.07617L8.69727 5.34863C8.44157 5.09294 8.21562 4.86618 8.01172 4.70215C7.79912 4.53117 7.55595 4.38244 7.25 4.33398C7.08435 4.30778 6.91565 4.30778 6.75 4.33398C6.44405 4.38244 6.20088 4.53117 5.98828 4.70215C5.78438 4.86618 5.55843 5.09294 5.30273 5.34863L2.57617 8.07617L2.15137 8.5L3 9.34863L3.42383 8.92383L6.15137 6.19727C6.42595 5.92268 6.59876 5.75151 6.74023 5.6377C6.87291 5.53096 6.92272 5.52187 6.9375 5.51953C6.97895 5.51297 7.02105 5.51297 7.0625 5.51953C7.07728 5.52187 7.12709 5.53096 7.25977 5.6377C7.40124 5.75151 7.57405 5.92268 7.84863 6.19727L10.5762 8.92383L11 9.34863L11.8486 8.5Z" fill="currentColor" />
    </svg>
  ),
  chevronDown: () => (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor" />
    </svg>
  ),
  plus: () => (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z" fill="currentColor" />
    </svg>
  ),
  close: () => (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor" />
    </svg>
  ),
  gear: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 1h3l.5 1.6c.45.16.86.38 1.24.65l1.58-.5 1.5 2.6-1.2 1.2a4.9 4.9 0 010 1.3l1.2 1.2-1.5 2.6-1.58-.5c-.38.27-.79.5-1.24.65L8.5 13h-3l-.5-1.6a4.5 4.5 0 01-1.24-.65l-1.58.5-1.5-2.6 1.2-1.2a4.9 4.9 0 010-1.3l-1.2-1.2 1.5-2.6 1.58.5c.38-.27.79-.5 1.24-.65L5.5 1zm1.5 4a2 2 0 100 4 2 2 0 000-4z" fill="currentColor" />
    </svg>
  ),
  sun: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx={7} cy={7} r={2.6} stroke="currentColor" strokeWidth={1.1} />
      <path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M11.4 2.6l-1.1 1.1M3.7 10.3l-1.1 1.1" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
    </svg>
  ),
  moon: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.8 8.9A5.2 5.2 0 015.1 2.2a5.2 5.2 0 106.7 6.7z" stroke="currentColor" strokeWidth={1.1} strokeLinejoin="round" />
    </svg>
  ),
  autoTheme: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx={7} cy={7} r={5.4} stroke="currentColor" strokeWidth={1.1} />
      <path d="M7 1.6a5.4 5.4 0 010 10.8z" fill="currentColor" />
    </svg>
  ),
  edit: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.4 1.3l3.3 3.3L5.2 12.1l-3.9.6.6-3.9L9.4 1.3zm1.2 1.2l-.7.7 2 2 .7-.7-2-2z" fill="currentColor" />
    </svg>
  ),
  trash: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 1h4l.5 1H12v1.5H2V2h2.5L5 1zm-2.2 4h8.4l-.7 7.1a1 1 0 01-1 .9H4.5a1 1 0 01-1-.9L2.8 5z" fill="currentColor" />
    </svg>
  ),
};

/* ---------------- xterm pane ---------------- */

function XtermPane({
  tab,
  active,
  surface,
  onStatus,
}: {
  tab: TermTab;
  active: boolean;
  /** Surface key ("dock" | "focus"): the same session may render on both
   *  surfaces at once, so each xterm instance registers under its own key. */
  surface: string;
  onStatus: (patch: Partial<TermTab>) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const closedByUs = React.useRef(false);
  // Exited sessions stay attachable (scrollback replay) but must not flip to
  // "live" when the ws opens; only the live state transition is allowed.
  const initialStatus = React.useRef(tab.status);
  // keep the latest callback without re-running the ws effect
  const onStatusRef = React.useRef(onStatus);
  onStatusRef.current = onStatus;
  const registryKey = surface + ":" + tab.id;

  React.useEffect(() => {
    const el = hostRef.current;
    if (el === null) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, Menlo, 'PingFang SC', 'Noto Sans Mono CJK SC', 'Microsoft YaHei', monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 10000,
      unicodeVersion: "11",
      drawBoldTextInBrightColors: false,
      theme: TERMINAL_THEMES[getGuiScheme()].xterm,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url, "_blank", "noopener,noreferrer")));
    term.open(el);
    termRegistry.set(registryKey, term);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* not attached yet */
      }
    });
    termRef.current = term;
    fitRef.current = fit;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + PREFIX + "/ws/" + tab.id);
    wsRef.current = ws;
    ws.onopen = () => {
      onStatusRef.current({
        status: initialStatus.current === "closed" ? "closed" : "live",
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") term.write(ev.data);
      else if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
      } else {
        term.write(new Uint8Array(ev.data));
      }
    };
    ws.onclose = () => {
      if (!closedByUs.current) onStatusRef.current({ status: "closed" });
    };
    ws.onerror = () => {
      onStatusRef.current({ status: "error" });
      ws.close();
    };

    const onData = (d: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    };
    const onResize = ({ cols, rows }: { cols: number; rows: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };
    term.onData(onData);
    term.onResize(onResize);

    // selection copy + contextmenu paste
    const onMouseUp = () => {
      if (!term.hasSelection()) return;
      const sel = term.getSelection();
      if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
    };
    const onPointerDown = () => {
      // ensure the terminal grabs keyboard focus even if the click
      // lands on padding/overlay around the textarea
      try {
        term.focus();
      } catch {
        /* ignore */
      }
    };
    const onCtx = (e: Event) => {
      e.preventDefault();
      navigator.clipboard
        ?.readText()
        .then((t) => t && term.paste(t))
        .catch(() => {});
    };
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("contextmenu", onCtx);

    return () => {
      closedByUs.current = true;
      termRegistry.delete(registryKey);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("contextmenu", onCtx);
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [tab.id]);

  React.useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return <div className={"dmsPane" + (active ? " isActive" : "")} ref={hostRef} />;
}

/* ---------------- tab strip (shared by Dock and Focus View) ---------------- */

function TabStrip({
  tabs,
  active,
  grid,
  serversCount,
  busy,
  stateLabel,
  onSelect,
  onClose,
  onPinToggle,
  onNew,
}: {
  tabs: TermTab[];
  active: string | null;
  grid: GridState;
  serversCount: number;
  busy: boolean;
  stateLabel: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPinToggle: (id: string) => void;
  onNew: () => void;
}) {
  const pinnedIndex = (id: string) => grid.tiles.indexOf(id);
  const dotClass = (s: TabStatus) =>
    "dmsTabDot" + (s === "connecting" ? " isConnecting" : s === "live" ? " isLive" : " isClosed");
  return (
    <div className="dmsTabs">
      <span className="dmsTabsLead" aria-hidden>
        {Icon.terminal()}
      </span>
      <div className="dmsTabsScroll" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={"dmsTab" + (t.id === active ? " isActive" : "") + (t.status === "closed" || t.status === "error" ? " isClosed" : "")}
            onClick={() => onSelect(t.id)}
          >
            <span className={dotClass(t.status)} />
            <span className="dmsTabLabel">{t.label}</span>
            <span
              className={"dmsTabPin" + (pinnedIndex(t.id) >= 0 ? " isPinned" : "")}
              role="button"
              title={pinnedIndex(t.id) >= 0 ? "从网格移回标签栏" : "钉入网格（同屏显示）"}
              onClick={(e) => {
                e.stopPropagation();
                onPinToggle(t.id);
              }}
            >
              {PinIcon()}
            </span>
            <span
              className="dmsTabClose"
              role="button"
              title={"关闭 " + t.label}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              {Icon.close()}
            </span>
          </button>
        ))}
      </div>
      <button
        className="dmsTab dmsTabNew"
        style={{ border: "none", padding: "0 8px", maxWidth: "none" }}
        title="连接服务器"
        aria-label="连接服务器"
        disabled={busy || serversCount === 0}
        onClick={onNew}
      >
        {Icon.plus()}
      </button>
      <span className="dmsTabsState" title={stateLabel}>
        {stateLabel}
      </span>
    </div>
  );
}

/* ---------------- grid body ---------------- */

/** The global GridState (ADR-0005): one Layout Template, one pin per Tile. */
interface GridState {
  template: string;
  tiles: (string | null)[];
}

const TEMPLATE_LABEL: Record<string, string> = {
  single: "单格",
  "split-h": "左右",
  "split-v": "上下",
  "grid-4": "2×2",
  "main-2": "1大2小",
};

function PinIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.9 1.1l.7.7-4.2 4.2.7.7 4.2-4.2.7.7-3.4 3.4 1.5 1.5 1.1-1.1 1.4 1.4-1.1 1.1 2.8 2.8-1.4 1.4-2.8-2.8-1.1 1.1L8 8.4 4.6 9.9l-1.5-1.5.7-.7-1.4-1.4-.7.7L.4 4.9 4.9.4 8.9 1.1z" fill="currentColor" />
    </svg>
  );
}

/**
 * The Grid: arranges pinned Terminal Sessions into Tiles per the Layout
 * Template. Shared by the Dock (cap 2 via fitCount) and the Focus View
 * (cap 4). Tiles are positional — `visCount` leading tiles render, trailing
 * ones degrade back to the tab strip. Empty Tiles offer a picker of unpinned
 * sessions; Tiles can be dragged onto each other to reorder.
 */
function GridBody({
  grid,
  tabs,
  visCount,
  surface,
  onStatus,
  onUnpin,
  onReorder,
  onPickEmpty,
}: {
  grid: GridState;
  tabs: TermTab[];
  visCount: number;
  surface: string;
  onStatus: (tabId: string, patch: Partial<TermTab>) => void;
  onUnpin: (tileIndex: number) => void;
  onReorder: (from: number, to: number) => void;
  onPickEmpty: (tileIndex: number, sessionId: string) => void;
}) {
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  const [pickFor, setPickFor] = React.useState<number | null>(null);
  const visible = Math.max(0, Math.min(visCount, grid.tiles.length));
  const pinned = new Set(grid.tiles.filter((t): t is string => t !== null));
  const unpinnedTabs = tabs.filter((t) => !pinned.has(t.id));

  // Release drag state on pointerup anywhere.
  React.useEffect(() => {
    if (dragFrom === null) return;
    const up = () => {
      setDragFrom(null);
      setDragOver(null);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragFrom]);

  const tileDragProps = (idx: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      setDragFrom(idx);
    },
    onPointerEnter: () => {
      if (dragFrom !== null && dragFrom !== idx) setDragOver(idx);
    },
    onPointerUp: () => {
      if (dragFrom !== null && dragOver !== null && dragOver !== dragFrom) {
        onReorder(dragFrom, dragOver);
      }
      setDragFrom(null);
      setDragOver(null);
    },
  });

  return (
    <div className="dmsGrid" style={{ gridTemplateAreas: gridAreas(grid.template) }}>
      {grid.tiles.slice(0, visible).map((sessionId, idx) => {
        const area = tileLetter(grid.template, idx);
        const dragClass =
          "dmsTile" +
          (dragFrom === idx ? " isDragFrom" : "") +
          (dragOver === idx ? " isDragTarget" : "");
        if (sessionId === null) {
          return (
            <div key={"tile-empty-" + idx} className={dragClass} style={{ gridArea: area }} {...tileDragProps(idx)}>
              <button className="dmsTileEmpty" onClick={() => setPickFor((v) => (v === idx ? null : idx))}>
                {Icon.plus()} 放入终端
              </button>
              {pickFor === idx && (
                <div className="dmsTilePick">
                  <div className="dmsTilePickTitle">选择要放入的终端</div>
                  {unpinnedTabs.length === 0 ? (
                    <span style={{ padding: "6px", color: "var(--dmst-picker-label-fg,#8b90a0)", fontSize: 12 }}>
                      没有可放入的终端，先开一个会话
                    </span>
                  ) : (
                    unpinnedTabs.map((t) => (
                      <button
                        key={t.id}
                        className="dmsPickerItem"
                        onClick={() => {
                          onPickEmpty(idx, t.id);
                          setPickFor(null);
                        }}
                      >
                        <span className="dmsPickerMeta">{Icon.terminal(13)}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        }
        const tab = tabs.find((t) => t.id === sessionId);
        return (
          <div key={"tile-" + sessionId} className={dragClass} style={{ gridArea: area }} {...tileDragProps(idx)}>
            <XtermPane
              tab={tab ?? { id: sessionId, serverId: "", label: "…", status: "connecting" }}
              active={true}
              surface={surface}
              onStatus={(patch) => onStatus(sessionId, patch)}
            />
            <button className="dmsTileUnpin" title="移回标签栏" aria-label="移回标签栏" onClick={() => onUnpin(idx)}>
              {Icon.close()}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- server form ---------------- */

function ServerForm({
  initial,
  defaults,
  onSaved,
  onCancel,
}: {
  initial: ServerView | null;
  /** Current Server Defaults, for the placeholder text; may be null before first load. */
  defaults: ServerDefaults | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [host, setHost] = React.useState(initial?.host ?? "");
  const [port, setPort] = React.useState(String(initial?.port ?? 22));
  const [username, setUsername] = React.useState(initial?.username ?? "");
  const [authKind, setAuthKind] = React.useState<AuthKind>(initial?.authKind ?? "password");
  const [password, setPassword] = React.useState("");
  const [privateKey, setPrivateKey] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [remoteCwd, setRemoteCwd] = React.useState(initial?.remoteCwd ?? "");
  // Advanced tunables: empty / "inherit" = leave the Server Default in charge.
  const [timeoutSec, setTimeoutSec] = React.useState(
    initial?.readyTimeout === undefined ? "" : String(Math.round(initial.readyTimeout / 1000)),
  );
  const [keepaliveSec, setKeepaliveSec] = React.useState(
    initial?.keepaliveInterval === undefined ? "" : String(Math.round(initial.keepaliveInterval / 1000)),
  );
  const [strictHostKey, setStrictHostKey] = React.useState<"inherit" | "on" | "off">(
    initial?.strictHostKey === undefined ? "inherit" : initial.strictHostKey ? "on" : "off",
  );
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [testRes, setTestRes] = React.useState<{ ok: boolean; message: string } | null>(null);

  const payload = () => {
    const p: Record<string, unknown> = {
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      authKind,
      remoteCwd: remoteCwd.trim(),
    };
    // Secrets: only send when the user typed something (blank = keep existing).
    if (authKind === "password" && password.length > 0) p.password = password;
    if (authKind === "privateKey" && privateKey.length > 0) p.privateKey = privateKey;
    if (authKind === "privateKey" && passphrase.length > 0) p.passphrase = passphrase;
    // Tunables: only send when set (blank = inherit the Server Default).
    if (timeoutSec.trim() !== "") p.readyTimeout = Number(timeoutSec) * 1000;
    if (keepaliveSec.trim() !== "") p.keepaliveInterval = Number(keepaliveSec) * 1000;
    if (strictHostKey !== "inherit") p.strictHostKey = strictHostKey === "on";
    return p;
  };

  const save = async () => {
    setErr("");
    if (host.trim() === "") {
      setErr("主机地址不能为空");
      return;
    }
    if (username.trim() === "") {
      setErr("用户名不能为空");
      return;
    }
    if (timeoutSec.trim() !== "") {
      const n = Number(timeoutSec);
      if (!Number.isInteger(n) || n < 3 || n > 120) {
        setErr("连接超时需为 3–120 的整数（秒），留空则继承全局默认。");
        return;
      }
    }
    if (keepaliveSec.trim() !== "") {
      const n = Number(keepaliveSec);
      if (!Number.isInteger(n) || n < 0 || n > 300) {
        setErr("Keepalive 间隔需为 0–300 的整数（秒），0 为禁用，留空则继承全局默认。");
        return;
      }
    }
    setBusy(true);
    try {
      if (initial) await api("/servers/" + initial.id, { method: "PUT", body: JSON.stringify(payload()) });
      else await api("/servers", { method: "POST", body: JSON.stringify(payload()) });
      onSaved();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setErr("");
    setTestRes(null);
    setBusy(true);
    try {
      const body = await api("/servers/test", { method: "POST", body: JSON.stringify(payload()) });
      setTestRes(body);
    } catch (e) {
      setTestRes({ ok: false, message: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  };

  const authLabel: Record<AuthKind, string> = {
    password: "密码",
    privateKey: "密钥",
    agent: "SSH Agent",
    none: "无认证",
  };

  return (
    <React.Fragment>
      <div className="dmsField">
        <label>名称</label>
        <input className="dmsInput" placeholder="例如 生产-01" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="dmsField">
        <label>主机 Host</label>
        <input className="dmsInput" placeholder="1.2.3.4 或 server.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="dmsField" style={{ flex: "0 0 100px" }}>
          <label>端口</label>
          <input className="dmsInput" value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
        <div className="dmsField" style={{ flex: 1 }}>
          <label>用户名</label>
          <input className="dmsInput" placeholder="root" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
      </div>
      <div className="dmsField">
        <label>认证方式</label>
        <div className="dmsRadioRow">
          {(Object.keys(authLabel) as AuthKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={"dmsRadio" + (authKind === k ? " isSel" : "")}
              onClick={() => setAuthKind(k)}
            >
              {authLabel[k]}
            </button>
          ))}
        </div>
      </div>
      {authKind === "password" && (
        <div className="dmsField">
          <label>密码 {initial?.hasPassword ? "（已保存，留空保持不变）" : ""}</label>
          <input className="dmsInput" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      {authKind === "privateKey" && (
        <React.Fragment>
          <div className="dmsField">
            <label>私钥 {initial?.hasPrivateKey ? "（已保存，留空保持不变）" : ""}</label>
            <textarea
              className="dmsInput"
              placeholder={"~/.ssh/id_ed25519 的路径，或直接粘贴 PEM 内容"}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
            />
            <span className="dmsHint">支持文件路径（~ 自动展开）或内联 PEM 内容</span>
          </div>
          <div className="dmsField">
            <label>密钥口令 Passphrase（可选）</label>
            <input className="dmsInput" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
        </React.Fragment>
      )}
      {authKind === "agent" && (
        <span className="dmsHint">使用本机 SSH Agent（Unix 读取 $SSH_AUTH_SOCK；Windows 支持 Pageant）</span>
      )}
      <div className="dmsField">
        <label>远程初始目录（可选）</label>
        <input className="dmsInput" placeholder="/root/workspace" value={remoteCwd} onChange={(e) => setRemoteCwd(e.target.value)} />
        <span className="dmsHint">登录后自动 cd 到该目录</span>
      </div>
      <div className="dmsField">
        <label>连接超时（秒，留空继承全局默认）</label>
        <input
          className="dmsInput"
          inputMode="numeric"
          placeholder={defaults ? `留空使用全局默认（${defaults.defaultReadyTimeoutSec} 秒）` : "3–120"}
          value={timeoutSec}
          onChange={(e) => setTimeoutSec(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <span className="dmsHint">3–120 秒；留空时按全局默认连接超时</span>
      </div>
      <div className="dmsField">
        <label>Keepalive 间隔（秒，留空继承全局默认）</label>
        <input
          className="dmsInput"
          inputMode="numeric"
          placeholder={defaults ? `留空使用全局默认（${defaults.defaultKeepaliveIntervalSec} 秒）` : "0–300"}
          value={keepaliveSec}
          onChange={(e) => setKeepaliveSec(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <span className="dmsHint">0–300 秒，0 为禁用；留空时按全局默认</span>
      </div>
      <div className="dmsField">
        <label>严格主机密钥校验</label>
        <select className="dmsInput" value={strictHostKey} onChange={(e) => setStrictHostKey(e.target.value as "inherit" | "on" | "off")}>
          <option value="inherit">继承全局默认</option>
          <option value="on">开启</option>
          <option value="off">关闭</option>
        </select>
        <span className="dmsHint">开启后连接要求 known-hosts 条目</span>
      </div>
      {err !== "" && <div className="dmsErrText">{err}</div>}
      {testRes !== null && (
        <div className={testRes.ok ? "dmsOkText" : "dmsErrText"}>{testRes.message}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="dmsBtn" onClick={test} disabled={busy || host.trim() === ""}>
          测试连接
        </button>
        <div className="dmsSpacer" />
        <button className="dmsBtn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="dmsBtn primary" onClick={save} disabled={busy}>
          {initial ? "保存" : "添加"}
        </button>
      </div>
    </React.Fragment>
  );
}

/* ---------------- server drawer ---------------- */

function ServerDrawer({
  servers,
  defaults,
  onClose,
  onChanged,
  onConnect,
}: {
  servers: ServerView[];
  defaults: ServerDefaults | null;
  onClose: () => void;
  onChanged: () => void;
  onConnect: (s: ServerView) => void;
}) {
  const [editing, setEditing] = React.useState<ServerView | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<Record<string, { ok: boolean; message: string }>>({});
  const [transferBusy, setTransferBusy] = React.useState(false);
  /** Dialog-level feedback for export/import (spec: failures surface in-dialog, not window.alert). */
  const [transferMsg, setTransferMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const importFileRef = React.useRef<HTMLInputElement | null>(null);

  /** Download the secret-stripped export as ssh-hub-servers.json. */
  const doExport = async () => {
    setTransferBusy(true);
    setTransferMsg(null);
    try {
      const res = await fetch(PREFIX + "/servers/export");
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          msg = (await res.json())?.error ?? msg;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ssh-hub-servers.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setTransferMsg({ ok: true, text: "已导出 ssh-hub-servers.json（不含密码/密钥）。" });
    } catch (e) {
      setTransferMsg({ ok: false, text: "导出失败：" + String(e instanceof Error ? e.message : e) });
    } finally {
      setTransferBusy(false);
    }
  };

  /** Upload an export file; every entry is added as a NEW server. */
  const doImportFile = async (file: File) => {
    setTransferBusy(true);
    setTransferMsg(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("文件不是有效的 JSON");
      }
      const res = await api("/servers/import", { method: "POST", body: JSON.stringify(parsed) });
      setTransferMsg({ ok: true, text: `已导入 ${res.imported} 台服务器（密码/密钥不随文件迁移，请逐台重新填写）。` });
      onChanged();
    } catch (e) {
      setTransferMsg({ ok: false, text: "导入失败：" + String(e instanceof Error ? e.message : e) });
    } finally {
      setTransferBusy(false);
    }
  };

  const doTest = async (s: ServerView) => {
    setBusyId(s.id);
    try {
      const res = await api("/servers/" + s.id + "/test", { method: "POST" });
      setTestResult((prev) => ({ ...prev, [s.id]: res }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [s.id]: { ok: false, message: String(e instanceof Error ? e.message : e) } }));
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (s: ServerView) => {
    if (!window.confirm(`删除服务器「${s.name}」？将同时关闭它的所有会话。`)) return;
    setBusyId(s.id);
    try {
      await api("/servers/" + s.id, { method: "DELETE" });
      onChanged();
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyId(null);
    }
  };

  const authBadge: Record<AuthKind, string> = {
    password: "密码",
    privateKey: "密钥",
    agent: "Agent",
    none: "无认证",
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dmsOverlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dmsDrawer">
        <div className="dmsDrawerHead">
          <span className="dmsDrawerTitle">
            {editing !== null ? "编辑服务器" : adding ? "添加服务器" : "服务器管理"}
          </span>
          <button className="dmsDrawerX" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            {Icon.close()}
          </button>
        </div>
        <div className="dmsDrawerBody">
          {editing !== null || adding ? (
            <ServerForm
              initial={editing}
              defaults={defaults}
              onSaved={() => {
                setEditing(null);
                setAdding(false);
                onChanged();
              }}
              onCancel={() => {
                setEditing(null);
                setAdding(false);
              }}
            />
          ) : servers.length === 0 ? (
            <div className="dmsEmptyState">
              <div>还没有配置任何服务器</div>
              <button className="dmsBtn primary" onClick={() => setAdding(true)}>
                {Icon.plus()} 添加第一台服务器
              </button>
            </div>
          ) : (
            <React.Fragment>
              {servers.map((s) => {
                const tr = testResult[s.id];
                return (
                  <div key={s.id} className="dmsSrvRow" onDoubleClick={() => onConnect(s)}>
                    <div className="dmsSrvMain" onClick={() => onConnect(s)}>
                      <div className="dmsSrvName">{s.name}</div>
                      <div className="dmsSrvMeta">
                        {s.username}@{s.host}:{s.port}
                        {tr ? (tr.ok ? " · ✓ " + tr.latencyMs + "ms" : " · ✗ " + tr.message) : ""}
                      </div>
                    </div>
                    <span className="dmsSrvBadge auth">{authBadge[s.authKind]}</span>
                    <div className="dmsSrvAct">
                      <button
                        className="dmsIconBtn"
                        title="测试连接"
                        aria-label="测试连接"
                        disabled={busyId === s.id}
                        onClick={() => doTest(s)}
                      >
                        {busyId === s.id ? <span style={{ fontSize: 12 }}>…</span> : <span style={{ fontSize: 12 }}>⚡</span>}
                      </button>
                      <button
                        className="dmsIconBtn"
                        title="编辑"
                        aria-label="编辑"
                        onClick={() => {
                          setAdding(false);
                          setEditing(s);
                        }}
                      >
                        {Icon.edit()}
                      </button>
                      <button
                        className="dmsIconBtn"
                        title="删除"
                        aria-label="删除"
                        onClick={() => doDelete(s)}
                      >
                        {Icon.trash()}
                      </button>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          )}
        </div>
        {editing === null && !adding && transferMsg !== null && (
          <div className="dmsTransferMsg">
            <div className={transferMsg.ok ? "dmsOkText" : "dmsErrText"}>{transferMsg.text}</div>
          </div>
        )}
        {editing === null && !adding && (
          <div className="dmsDrawerFoot">
            <button
              className="dmsBtn"
              disabled={transferBusy || servers.length === 0}
              title="导出为 JSON 文件（不含密码/密钥）"
              onClick={doExport}
            >
              导出配置
            </button>
            <button
              className="dmsBtn"
              disabled={transferBusy}
              title="从 JSON 文件导入（一律新增，不覆盖现有服务器）"
              onClick={() => importFileRef.current?.click()}
            >
              导入配置
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void doImportFile(f);
              }}
            />
            <div className="dmsSpacer" />
            <button className="dmsBtn primary" onClick={() => setAdding(true)}>
              {Icon.plus()} 添加服务器
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- main panel ---------------- */

export function TerminalPanel(_props?: { sessionId?: string }) {
  const [open, setOpen] = React.useState(false);
  const [tabs, setTabs] = React.useState<TermTab[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [servers, setServers] = React.useState<ServerView[]>([]);
  const [drawer, setDrawer] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const heightRef = React.useRef<number>(
    (() => {
      try {
        const v = Number(localStorage.getItem(HEIGHT_KEY));
        if (Number.isFinite(v) && v >= MIN_HEIGHT) return v;
      } catch {
        /* ignore */
      }
      return Math.round(window.innerHeight * 0.36);
    })(),
  );
  const [height, setHeight] = React.useState(heightRef.current);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  /* ---- global Grid state (ADR-0005) ---- */
  const [grid, setGrid] = React.useState<GridState>({ template: "single", tiles: [null] });
  /** Optimistic local mutation + authoritative PUT; broadcasts from the host
   *  (other surfaces, dead-session cleanup) overwrite via the ws below. A
   *  failed PUT reverts to the host's state so a pin that did not stick is
   *  visibly undone instead of silently diverging. */
  const commitGrid = React.useCallback((next: GridState) => {
    setGrid(next);
    api("/grid", { method: "PUT", body: JSON.stringify(next) }).catch((e) => {
      console.error("[dsh-ssh-hub] grid PUT failed, reverting:", e);
      api("/grid")
        .then((b) => setGrid(b.grid ?? { template: "single", tiles: [null] }))
        .catch(() => {
          /* host unreachable; keep local state until the next push */
        });
    });
  }, []);

  // Load the global GridState and subscribe to pushes: one world, many
  // viewfinders — every Dock and the Focus View converge on the same value.
  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    api("/grid")
      .then((b) => {
        if (!cancelled) setGrid(b.grid ?? { template: "single", tiles: [null] });
      })
      .catch(() => {
        /* older host: no grid route — keep the local default */
      });
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + PREFIX + "/grid/events");
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || cancelled) return;
        try {
          setGrid(JSON.parse(ev.data));
        } catch {
          /* ignore malformed push */
        }
      };
    } catch {
      /* ws unavailable */
    }
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  // Measure the Terminal Area so fitCount can decide how many Tiles fit here
  // (the Dock caps at two; the Focus View passes its own cap).
  const [gridSize, setGridSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el === null) return;
    const measure = () => setGridSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const visCount = gridSize.w > 0 ? fitCount(grid.template, gridSize.w, gridSize.h, 2) : 0;
  /** Dock template cycle: only the two-way splits are offered here. */
  const DOCK_TEMPLATES = ["single", "split-h", "split-v"];
  const cycleTemplate = () => {
    const cur = grid.template;
    const idx = DOCK_TEMPLATES.indexOf(cur);
    const next = DOCK_TEMPLATES[(idx + 1) % DOCK_TEMPLATES.length];
    commitGrid(gridWithTemplate(grid, next));
  };

  // Resolved Terminal Theme: the Theme Override wins over the GUI scheme.
  const guiScheme = React.useSyncExternalStore(subscribeGuiScheme, getGuiScheme);
  const [override, setOverride] = React.useState<ThemeOverride>(() => {
    try {
      const v = localStorage.getItem(OVERRIDE_KEY);
      if (v === "auto" || v === "dark" || v === "light") return v;
    } catch {
      /* ignore */
    }
    return "auto";
  });
  const cycleOverride = () => {
    setOverride((prev) => {
      const next = OVERRIDE_ORDER[(OVERRIDE_ORDER.indexOf(prev) + 1) % OVERRIDE_ORDER.length];
      try {
        localStorage.setItem(OVERRIDE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  // Theme chain: local override (dark/light) > defaultTerminalTheme > GUI.
  const defaultTheme = React.useSyncExternalStore(subscribeDefaultTheme, getDefaultTheme);
  const resolvedTheme: "dark" | "light" =
    override !== "auto" ? override : defaultTheme !== "auto" ? defaultTheme : guiScheme;

  // Push the Server Default into the theme signal whenever the settings
  // scope emits (hot-swaps open terminals through the existing effect).
  React.useEffect(() => {
    const scope = getSettingsScope();
    if (scope === null) return;
    const push = () => pushDefaultTheme(scope.getSnapshot().value?.defaultTerminalTheme);
    push();
    return scope.subscribe(push);
  }, []);

  // Terminal Area surface colors, applied declaratively so they are correct
  // the moment the panel body mounts (an effect would miss the mount when the
  // panel starts collapsed).
  const surfaceVars = React.useMemo<React.CSSProperties>(() => {
    const th = TERMINAL_THEMES[resolvedTheme];
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(th.surface)) {
      // camelCase key -> kebab-case CSS variable (custom properties are case-sensitive)
      const name = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      style["--dmst-" + name] = v;
    }
    return style as React.CSSProperties;
  }, [resolvedTheme]);

  // Hot-swap every open xterm instance when the resolved theme changes
  // (no reconnect, no reload).
  React.useEffect(() => {
    const th = TERMINAL_THEMES[resolvedTheme];
    for (const term of termRegistry.values()) term.options.theme = th.xterm;
  }, [resolvedTheme]);

  const refreshServers = React.useCallback(async () => {
    try {
      const body = await api("/servers");
      setServers(body.servers ?? []);
    } catch (e) {
      console.error("[dsh-ssh-hub] load servers failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Server Defaults power the form placeholders; refresh whenever they change. */
  const [defaults, setDefaults] = React.useState<ServerDefaults | null>(null);
  const refreshDefaults = React.useCallback(async () => {
    try {
      const body = await api("/defaults");
      setDefaults(body as ServerDefaults);
    } catch {
      /* route unavailable on older hosts — placeholders fall back to static copy */
    }
  }, []);

  React.useEffect(() => {
    refreshServers();
    refreshDefaults();
  }, [refreshServers, refreshDefaults]);

  // Rebuild the tab list from the host on mount. Terminal Sessions are
  // host-owned (ADR-0004): any surface (this panel, another conversation's
  // panel, the Focus View) attaches and detaches freely, so tab state is a
  // projection of the live session list, not per-conversation local state.
  // This is what makes "collapse / refresh / switch conversation" reconnect
  // to the same running shells with their scrollback replayed.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await api("/sessions");
        if (cancelled) return;
        const remote: Array<{ id: string; serverId: string; label: string; serverName: string; exited: boolean }> =
          body.sessions ?? [];
        setTabs(
          remote.map((s) => ({
            id: s.id,
            serverId: s.serverId,
            label: s.serverName || s.label,
            status: s.exited ? "closed" : "connecting",
          })),
        );
        if (remote.length > 0) setActive(remote[0].id);
        let prevOpen = false;
        try {
          prevOpen = localStorage.getItem("dsh-ssh-hub.open") === "1";
        } catch {
          /* ignore */
        }
        if (remote.length > 0 || prevOpen) setOpen(true);
      } catch (e) {
        console.error("[dsh-ssh-hub] load sessions failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.code === "Backquote") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 「管理服务器」 entry from the settings card: open the panel and the drawer.
  React.useEffect(() => {
    const onOpenServers = () => {
      setOpen(true);
      setDrawer(true);
    };
    window.addEventListener("dsh-ssh-hub:open-servers", onOpenServers);
    return () => window.removeEventListener("dsh-ssh-hub:open-servers", onOpenServers);
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem("dsh-ssh-hub.open", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  const connectTo = async (s: ServerView) => {
    setBusy(true);
    setPicker(false);
    try {
      const body = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({ serverId: s.id, cols: 80, rows: 24 }),
      });
      const tab: TermTab = {
        id: body.id,
        serverId: s.id,
        label: s.name || `${s.username}@${s.host}`,
        status: "connecting",
      };
      setTabs((prev) => [...prev, tab]);
      setActive(body.id);
      setOpen(true);
    } catch (e) {
      window.alert("连接失败：" + String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const closeTab = async (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (idx !== -1) {
        setActive((a) => (a === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : a));
      }
      return next;
    });
    api("/sessions/" + id, { method: "DELETE" }).catch(() => {});
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = heightRef.current;
    const maxH = Math.round(window.innerHeight * 0.78);
    const move = (ev: PointerEvent) => {
      const h = Math.min(maxH, Math.max(MIN_HEIGHT, startH + (startY - ev.clientY)));
      heightRef.current = h;
      setHeight(h);
    };
    const up = () => {
      document.body.classList.remove("dmsResizing");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
      } catch {
        /* ignore */
      }
    };
    document.body.classList.add("dmsResizing");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const activeTab = tabs.find((t) => t.id === active) ?? null;

  /* ---- Grid mutations (optimistic + PUT, broadcast converges) ---- */
  const pinTab = (id: string) => {
    const free = grid.tiles.indexOf(null);
    if (free === -1) return false;
    commitGrid(gridPin(grid, id, free));
    setActive(id);
    return true;
  };
  const unpinTile = (idx: number) => commitGrid(gridUnpin(grid, idx));
  const reorderTiles = (from: number, to: number) => commitGrid(gridReorder(grid, from, to));
  const pickEmpty = (idx: number, sessionId: string) => {
    commitGrid(gridPin(grid, sessionId, idx));
    setActive(sessionId);
  };
  const pinnedIndex = (id: string) => grid.tiles.indexOf(id);

  const stateLabel =
    tabs.length === 0
      ? loading
        ? "加载中…"
        : servers.length === 0
          ? "未配置服务器"
          : "就绪"
      : activeTab === null
        ? "空闲"
        : activeTab.status === "connecting"
          ? "连接中…"
          : activeTab.status === "live"
            ? activeTab.label
            : activeTab.status === "error"
              ? "连接失败"
              : "已断开";

  const dotClass = (s: TabStatus) =>
    "dmsTabDot" + (s === "connecting" ? " isConnecting" : s === "live" ? " isLive" : " isClosed");

  return (
    <div className="dmsRoot">
      {open ? (
        <div className="dmsPanel" id="dmsPanel" style={{ height: height + "px" }}>
          <div className="dmsResize" title="拖拽调整高度" onPointerDown={startDrag} />
          <div className="dmsTabs">
            <TabStrip
              tabs={tabs}
              active={active}
              grid={grid}
              serversCount={servers.length}
              busy={busy}
              stateLabel={stateLabel}
              onSelect={(id) => {
                setActive(id);
                // Clicking an unpinned tab shows it: pin it into the first
                // free Tile (when the Grid has room).
                const free = grid.tiles.indexOf(null);
                if (pinnedIndex(id) === -1 && free !== -1) {
                  commitGrid(gridPin(grid, id, free));
                }
              }}
              onClose={closeTab}
              onPinToggle={(id) => {
                const idx = pinnedIndex(id);
                if (idx >= 0) unpinTile(idx);
                else pinTab(id);
              }}
              onNew={() => setPicker((v) => !v)}
            />
            <button className="dmsBarAction" title="服务器管理" aria-label="服务器管理" onClick={() => setDrawer(true)}>
              {Icon.gear()}
            </button>
            <button className="dmsBarAction" title="收起面板（Ctrl+`）" aria-label="收起面板" onClick={() => setOpen(false)}>
              {Icon.chevronDown()}
            </button>
          </div>
          <div className="dmsTool">
            <button className="dmsToolBtn" disabled={servers.length === 0 || busy} onClick={() => setPicker((v) => !v)}>
              {Icon.plus()} 新会话
            </button>
            <button className="dmsToolBtn" onClick={() => setDrawer(true)}>
              {Icon.gear()} 管理服务器（{servers.length}）
            </button>
            <button
              className="dmsToolBtn"
              title="布局模板（点击切换：单格 / 左右 / 上下）"
              aria-label="布局模板（点击切换）"
              onClick={cycleTemplate}
            >
              布局:{TEMPLATE_LABEL[grid.template] ?? grid.template}
            </button>
            <button
              className="dmsToolBtn"
              style={{ marginLeft: "auto" }}
              title={"终端主题：" + OVERRIDE_LABEL[override] + "（点击切换）"}
              aria-label={"终端主题：" + OVERRIDE_LABEL[override] + "（点击切换）"}
              onClick={cycleOverride}
            >
              {override === "auto" ? Icon.autoTheme() : override === "dark" ? Icon.moon() : Icon.sun()}
              {OVERRIDE_LABEL[override]}
            </button>
            <span className="dmsHint" style={{ marginLeft: 4 }}>
              {servers.length === 0 ? "先添加一台服务器，才能连接" : "双击服务器行或点「新会话」开始"}{" "}
              {tabs.length > 0 ? "· 关闭最后一个终端标签会自动断开" : ""}
            </span>
          </div>
          <div className="dmsBody" ref={bodyRef} data-term-theme={resolvedTheme} style={surfaceVars}>
            {tabs.length === 0 ? (
              <div className="dmsEmpty">
                <span>{servers.length === 0 ? "还没有服务器，先添加一台" : "选择一台服务器开始连接"}</span>
                {servers.length > 0 ? (
                  <button className="dmsEmptyBtn" onClick={() => setPicker(true)}>
                    {Icon.plus()} 连接服务器
                  </button>
                ) : (
                  <button className="dmsEmptyBtn" onClick={() => setDrawer(true)}>
                    {Icon.plus()} 添加服务器
                  </button>
                )}
              </div>
            ) : visCount === 0 ? (
              <div className="dmsDegrade">
                窗口太小，已钉的终端收回到标签栏。展开面板或进入专注视图可获得完整分屏。
              </div>
            ) : (
              <GridBody
                grid={grid}
                tabs={tabs}
                visCount={visCount}
                surface="dock"
                onStatus={(tabId, patch) =>
                  setTabs((prev) => prev.map((x) => (x.id === tabId ? { ...x, ...patch } : x)))
                }
                onUnpin={unpinTile}
                onReorder={reorderTiles}
                onPickEmpty={pickEmpty}
              />
            )}
            {picker && (
              <ServerPicker servers={servers} busy={busy} onPick={connectTo} onManage={() => setDrawer(true)} onClose={() => setPicker(false)} />
            )}
          </div>
        </div>
      ) : (
        <div
          className="dmsBar"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-controls="dmsPanel"
          title="多服务器终端面板（Ctrl+` 切换）"
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="dmsBarLead" aria-hidden>
            {Icon.terminal()}
          </span>
          <span className="dmsBarTitle">多服务器终端{tabs.length > 0 ? " · " + tabs.length : ""}</span>
          <span className="dmsBarState">{stateLabel}</span>
          <span className="dmsBarActions" onClick={(e) => e.stopPropagation()}>
            <button className="dmsBarAction" title="服务器管理" aria-label="服务器管理" onClick={() => setDrawer(true)}>
              {Icon.gear()}
            </button>
          </span>
          <span className="dmsBarChevron" aria-hidden>
            {Icon.chevronUp()}
          </span>
        </div>
      )}
      {drawer && (
        <ServerDrawer
          servers={servers}
          defaults={defaults}
          onClose={() => setDrawer(false)}
          onChanged={refreshServers}
          onConnect={(s) => {
            setDrawer(false);
            connectTo(s);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- focus view (frame-wide, root scope) ---------------- */

/** Frame-wide visibility signal for the Focus View (ADR-0005). */
let focusVisible = false;
const focusListeners = new Set<() => void>();
export function setFocusVisible(v: boolean) {
  const next = Boolean(v);
  if (next === focusVisible) return;
  focusVisible = next;
  for (const l of [...focusListeners]) l();
}
export function getFocusVisible() {
  return focusVisible;
}
function subscribeFocusVisible(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/**
 * The Focus View: a single frame-wide surface covering the whole GUI for
 * focused terminal work, isolated from the conversation (ADR-0005). Hosts the
 * full Grid (cap 4, all five templates) plus a toolbar with parity to the
 * Dock. Renders nothing while inactive; sessions and Grid state are global,
 * so entering/exiting never interrupts anything.
 */
export function FocusView() {
  const visible = React.useSyncExternalStore(subscribeFocusVisible, getFocusVisible);

  /* ---- theme chain (same resolution as the Dock) ---- */
  const guiScheme = React.useSyncExternalStore(subscribeGuiScheme, getGuiScheme);
  const [override, setOverride] = React.useState<ThemeOverride>(() => {
    try {
      const v = localStorage.getItem(OVERRIDE_KEY);
      if (v === "auto" || v === "dark" || v === "light") return v;
    } catch {
      /* ignore */
    }
    return "auto";
  });
  const cycleOverride = () => {
    setOverride((prev) => {
      const next = OVERRIDE_ORDER[(OVERRIDE_ORDER.indexOf(prev) + 1) % OVERRIDE_ORDER.length];
      try {
        localStorage.setItem(OVERRIDE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const defaultTheme = React.useSyncExternalStore(subscribeDefaultTheme, getDefaultTheme);
  const resolvedTheme: "dark" | "light" =
    override !== "auto" ? override : defaultTheme !== "auto" ? defaultTheme : guiScheme;
  React.useEffect(() => {
    const scope = getSettingsScope();
    if (scope === null) return;
    const push = () => pushDefaultTheme(scope.getSnapshot().value?.defaultTerminalTheme);
    push();
    return scope.subscribe(push);
  }, []);
  const surfaceVars = React.useMemo<React.CSSProperties>(() => {
    const th = TERMINAL_THEMES[resolvedTheme];
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(th.surface)) {
      const name = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      style["--dmst-" + name] = v;
    }
    return style as React.CSSProperties;
  }, [resolvedTheme]);
  React.useEffect(() => {
    const th = TERMINAL_THEMES[resolvedTheme];
    for (const term of termRegistry.values()) term.options.theme = th.xterm;
  }, [resolvedTheme]);

  /* ---- world state (projections of host truth) ---- */
  const [servers, setServers] = React.useState<ServerView[]>([]);
  const [defaults, setDefaults] = React.useState<ServerDefaults | null>(null);
  const [tabs, setTabs] = React.useState<TermTab[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [grid, setGrid] = React.useState<GridState>({ template: "single", tiles: [null] });
  const [drawer, setDrawer] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [gridSize, setGridSize] = React.useState({ w: 0, h: 0 });
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const refreshServers = React.useCallback(async () => {
    try {
      const body = await api("/servers");
      setServers(body.servers ?? []);
    } catch (e) {
      console.error("[dsh-ssh-hub] load servers failed:", e);
    }
  }, []);
  const refreshDefaults = React.useCallback(async () => {
    try {
      const body = await api("/defaults");
      setDefaults(body as ServerDefaults);
    } catch {
      /* older host */
    }
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    refreshServers();
    refreshDefaults();
    // Rebuild tabs from the host (host-owned sessions, ADR-0004).
    api("/sessions")
      .then((b) => {
        const remote: Array<{ id: string; serverId: string; label: string; serverName: string; exited: boolean }> =
          b.sessions ?? [];
        setTabs(
          remote.map((s) => ({
            id: s.id,
            serverId: s.serverId,
            label: s.serverName || s.label,
            status: s.exited ? "closed" : "connecting",
          })),
        );
        if (remote.length > 0) setActive(remote[0].id);
      })
      .catch(() => {});
    // Grid state + pushes.
    let ws: WebSocket | null = null;
    let cancelled = false;
    api("/grid")
      .then((b) => {
        if (!cancelled) setGrid(b.grid ?? { template: "single", tiles: [null] });
      })
      .catch(() => {});
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + PREFIX + "/grid/events");
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || cancelled) return;
        try {
          setGrid(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ws unavailable */
    }
    // Measure the Terminal Area for fitCount.
    const el = bodyRef.current;
    let ro: ResizeObserver | null = null;
    if (el !== null) {
      const measure = () => setGridSize({ w: el.clientWidth, h: el.clientHeight });
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      cancelled = true;
      ws?.close();
      ro?.disconnect();
    };
  }, [visible, refreshServers, refreshDefaults]);

  // Esc exits back to the Dock.
  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusVisible(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const visCount = gridSize.w > 0 ? fitCount(grid.template, gridSize.w, gridSize.h, 4) : 0;
  const commitGrid = React.useCallback((next: GridState) => {
    setGrid(next);
    api("/grid", { method: "PUT", body: JSON.stringify(next) }).catch((e) => {
      console.error("[dsh-ssh-hub] grid PUT failed, reverting:", e);
      api("/grid")
        .then((b) => setGrid(b.grid ?? { template: "single", tiles: [null] }))
        .catch(() => {
          /* host unreachable; keep local state until the next push */
        });
    });
  }, []);
  const cycleTemplate = () => {
    const i = TEMPLATES.indexOf(grid.template);
    const next = TEMPLATES[(i + 1) % TEMPLATES.length];
    commitGrid(gridWithTemplate(grid, next));
  };

  const connectTo = async (s: ServerView) => {
    setBusy(true);
    setPicker(false);
    try {
      const body = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({ serverId: s.id, cols: 80, rows: 24 }),
      });
      const tab: TermTab = {
        id: body.id,
        serverId: s.id,
        label: s.name || `${s.username}@${s.host}`,
        status: "connecting",
      };
      setTabs((prev) => [...prev, tab]);
      setActive(body.id);
    } catch (e) {
      window.alert("连接失败：" + String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const closeTab = async (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (idx !== -1) {
        setActive((a) => (a === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : a));
      }
      return next;
    });
    api("/sessions/" + id, { method: "DELETE" }).catch(() => {});
  };
  const pinnedIndex = (id: string) => grid.tiles.indexOf(id);
  const pinTab = (id: string) => {
    const free = grid.tiles.indexOf(null);
    if (free === -1) return;
    commitGrid(gridPin(grid, id, free));
    setActive(id);
  };
  const unpinTile = (idx: number) => commitGrid(gridUnpin(grid, idx));
  const reorderTiles = (from: number, to: number) => commitGrid(gridReorder(grid, from, to));
  const pickEmpty = (idx: number, sessionId: string) => {
    commitGrid(gridPin(grid, sessionId, idx));
    setActive(sessionId);
  };

  const activeTab = tabs.find((t) => t.id === active) ?? null;
  const stateLabel =
    tabs.length === 0
      ? servers.length === 0
        ? "未配置服务器"
        : "就绪"
      : activeTab === null
        ? "空闲"
        : activeTab.status === "connecting"
          ? "连接中…"
          : activeTab.status === "live"
            ? activeTab.label
            : activeTab.status === "error"
              ? "连接失败"
              : "已断开";

  if (!visible) return null;

  return (
    <div className="dmsFocusRoot" role="dialog" aria-label="终端专注视图">
      <div className="dmsFocusHead">
        <span className="dmsFocusTitle">{Icon.terminal()} 终端专注视图</span>
        <TabStrip
          tabs={tabs}
          active={active}
          grid={grid}
          serversCount={servers.length}
          busy={busy}
          stateLabel={stateLabel}
          onSelect={(id) => {
            setActive(id);
            const free = grid.tiles.indexOf(null);
            if (pinnedIndex(id) === -1 && free !== -1) {
              commitGrid(gridPin(grid, id, free));
            }
          }}
          onClose={closeTab}
          onPinToggle={(id) => {
            const idx = pinnedIndex(id);
            if (idx >= 0) unpinTile(idx);
            else pinTab(id);
          }}
          onNew={() => setPicker((v) => !v)}
        />
        <button className="dmsFocusExit" onClick={() => setFocusVisible(false)} title="退出（Esc）">
          {Icon.close()} 退出（Esc）
        </button>
      </div>
      <div className="dmsTool">
        <button className="dmsToolBtn" disabled={servers.length === 0 || busy} onClick={() => setPicker((v) => !v)}>
          {Icon.plus()} 新会话
        </button>
        <button className="dmsToolBtn" onClick={() => setDrawer(true)}>
          {Icon.gear()} 管理服务器（{servers.length}）
        </button>
        <button className="dmsToolBtn" title="布局模板（点击切换）" aria-label="布局模板（点击切换）" onClick={cycleTemplate}>
          布局:{TEMPLATE_LABEL[grid.template] ?? grid.template}
        </button>
        <button
          className="dmsToolBtn"
          style={{ marginLeft: "auto" }}
          title={"终端主题：" + OVERRIDE_LABEL[override] + "（点击切换）"}
          aria-label={"终端主题：" + OVERRIDE_LABEL[override] + "（点击切换）"}
          onClick={cycleOverride}
        >
          {override === "auto" ? Icon.autoTheme() : override === "dark" ? Icon.moon() : Icon.sun()}
          {OVERRIDE_LABEL[override]}
        </button>
      </div>
      <div className="dmsBody" ref={bodyRef} data-term-theme={resolvedTheme} style={surfaceVars}>
        {tabs.length === 0 ? (
          <div className="dmsEmpty">
            <span>{servers.length === 0 ? "还没有服务器，先添加一台" : "选择一台服务器开始连接"}</span>
            {servers.length > 0 ? (
              <button className="dmsEmptyBtn" onClick={() => setPicker(true)}>
                {Icon.plus()} 连接服务器
              </button>
            ) : (
              <button className="dmsEmptyBtn" onClick={() => setDrawer(true)}>
                {Icon.plus()} 添加服务器
              </button>
            )}
          </div>
        ) : visCount === 0 ? (
          <div className="dmsDegrade">窗口太小，终端已收回到标签栏。</div>
        ) : (
          <GridBody
            grid={grid}
            tabs={tabs}
            visCount={visCount}
            surface="focus"
            onStatus={(tabId, patch) =>
              setTabs((prev) => prev.map((x) => (x.id === tabId ? { ...x, ...patch } : x)))
            }
            onUnpin={unpinTile}
            onReorder={reorderTiles}
            onPickEmpty={pickEmpty}
          />
        )}
        {picker && (
          <ServerPicker servers={servers} busy={busy} onPick={connectTo} onManage={() => setDrawer(true)} onClose={() => setPicker(false)} />
        )}
      </div>
      {drawer && (
        <ServerDrawer
          servers={servers}
          defaults={defaults}
          onClose={() => setDrawer(false)}
          onChanged={refreshServers}
          onConnect={(s) => {
            setDrawer(false);
            connectTo(s);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- sidebar entry (sidebar.footer.action) ---------------- */

/**
 * One button at the sidebar foot that opens the Focus View (ADR-0005). The
 * sidebar's browsing and settings seats are single and occupied, so this is
 * the only incremental seat — nothing shipped is replaced.
 */
export function SidebarEntry({ wide }: { wide?: boolean }) {
  return (
    <button
      className={"dmsSidebarEntry" + (wide === false ? " isRail" : "")}
      title="SSH 终端（专注视图）"
      aria-label="SSH 终端（专注视图）"
      onClick={() => setFocusVisible(true)}
    >
      <span className="dmsSidebarEntryIcon" aria-hidden>
        {Icon.terminal(15)}
      </span>
      {wide !== false && <span className="dmsSidebarEntryLabel">SSH 终端</span>}
    </button>
  );
}

/* ---------------- server picker (inline) ---------------- */

function ServerPicker({
  servers,
  busy,
  onPick,
  onManage,
  onClose,
}: {
  servers: ServerView[];
  busy: boolean;
  onPick: (s: ServerView) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="dmsPicker"
      style={{
        position: "absolute",
        bottom: 8,
        left: 10,
        minWidth: 260,
        maxWidth: 340,
        borderRadius: 10,
        padding: 8,
        boxShadow: "0 8px 28px rgba(0,0,0,.5)",
        zIndex: 5,
      }}
    >
      <div className="dmsPickerLabel">选择服务器</div>
      {servers.map((s) => (
        <button
          key={s.id}
          className="dmsPickerItem"
          disabled={busy}
          onClick={() => onPick(s)}
        >
          <span className="dmsPickerMeta">{Icon.terminal(13)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
            <span className="dmsPickerMeta" style={{ marginLeft: 6, fontSize: 11 }}>
              {s.username}@{s.host}
            </span>
          </span>
        </button>
      ))}
      <div className="dmsPickerFoot">
        <button className="dmsPickerLink" onClick={onManage}>
          + 添加服务器…
        </button>
        <button className="dmsPickerLink" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

export default TerminalPanel;
