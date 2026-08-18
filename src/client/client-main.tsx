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
 * Visual language follows DSH design tokens; the terminal surface is always
 * dark (Campbell palette) so ANSI colors stay readable in both themes.
 */
import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const PREFIX = "/ssh-hub";
const HEIGHT_KEY = "dsh-ssh-hub.height";
const MIN_HEIGHT = 120;

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
.dmsRoot{position:fixed;bottom:0;z-index:50;font-family:Inter,var(--dsw-font-family)}
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
.dmsTool{flex:none;box-sizing:border-box;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip);font-size:12px}
.dmsToolBtn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer;flex:none}
.dmsToolBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsToolBtn:disabled{cursor:default;opacity:.45}
.dmsToolBtn.primary{background:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));border-color:transparent;color:#fff}
.dmsToolBtn.primary:hover:not(:disabled){filter:brightness(1.1)}
.dmsBody{flex:auto;min-height:0;position:relative;background:#1e2128;box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}
.dmsPane{position:absolute;inset:0;display:none;padding:4px 10px 8px;background:#1e2128}
.dmsPane.isActive{display:block}
.dmsEmpty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#8b90a0;font-family:Inter,var(--dsw-font-family);font-size:12px}
.dmsEmptyBtn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:#2a2e38;color:#e6e8ee;font-family:Inter,var(--dsw-font-family);font-size:12px;font-weight:500;cursor:pointer}
.dmsEmptyBtn:hover{background:#343946}
.dmsErr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;color:#e6b0b0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;text-align:center}
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
.dmsBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-family:Inter,var(--dsw-font-family);font-size:12.5px;font-weight:500;cursor:pointer;flex:none}
.dmsBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmsBtn:disabled{cursor:default;opacity:.45}
.dmsBtn.primary{background:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));border-color:transparent;color:#fff}
.dmsBtn.primary:hover:not(:disabled){filter:brightness(1.1)}
.dmsBtn.danger:hover{background:rgba(231,72,86,.14);border-color:rgba(231,72,86,.5);color:#ff8b93}
.dmsSpacer{flex:1}
.dmsEmptyState{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12.5px}
`.trim();
if (typeof document !== "undefined" && document.getElementById(STYLE_TAG) === null) {
  const tag = document.createElement("style");
  tag.id = STYLE_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const TERM_THEME = {
  foreground: "#d7dae0",
  background: "#1e2128",
  cursor: "#d7dae0",
  cursorAccent: "#1e2128",
  selectionBackground: "#3b4252aa",
  black: "#0c0c0c",
  red: "#e74856",
  green: "#16c60c",
  yellow: "#c19c00",
  blue: "#3b78ff",
  magenta: "#d64fa8",
  cyan: "#3a96dd",
  white: "#cccccc",
  brightBlack: "#8a8a8a",
  brightRed: "#ff6b6b",
  brightGreen: "#2ee62e",
  brightYellow: "#f9f1a5",
  brightBlue: "#7aa2ff",
  brightMagenta: "#f27fd8",
  brightCyan: "#61d6d6",
  brightWhite: "#f2f2f2",
};

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
  strictHostKey?: boolean;
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
  onStatus,
}: {
  tab: TermTab;
  active: boolean;
  onStatus: (patch: Partial<TermTab>) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const closedByUs = React.useRef(false);
  // keep the latest callback without re-running the ws effect
  const onStatusRef = React.useRef(onStatus);
  onStatusRef.current = onStatus;

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
      theme: TERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url, "_blank", "noopener,noreferrer")));
    term.open(el);
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
      onStatusRef.current({ status: "live" });
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

/* ---------------- server form ---------------- */

function ServerForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: ServerView | null;
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
  onClose,
  onChanged,
  onConnect,
}: {
  servers: ServerView[];
  onClose: () => void;
  onChanged: () => void;
  onConnect: (s: ServerView) => void;
}) {
  const [editing, setEditing] = React.useState<ServerView | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<Record<string, { ok: boolean; message: string }>>({});

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
        {editing === null && !adding && (
          <div className="dmsDrawerFoot">
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

  React.useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  // restore previous panel state across refresh
  React.useEffect(() => {
    try {
      const prev = localStorage.getItem("dsh-ssh-hub.open");
      if (prev === "1" && tabs.length === 0) setOpen(true);
    } catch {
      /* ignore */
    }
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
                  onClick={() => setActive(t.id)}
                >
                  <span className={dotClass(t.status)} />
                  <span className="dmsTabLabel">{t.label}</span>
                  <span
                    className="dmsTabClose"
                    role="button"
                    title={"关闭 " + t.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
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
              disabled={busy || servers.length === 0}
              onClick={() => setPicker((v) => !v)}
            >
              {Icon.plus()}
            </button>
            <span className="dmsTabsState" title={stateLabel}>
              {stateLabel}
            </span>
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
            <span className="dmsHint" style={{ marginLeft: 4 }}>
              {servers.length === 0 ? "先添加一台服务器，才能连接" : "双击服务器行或点「新会话」开始"}{" "}
              {tabs.length > 0 ? "· 关闭最后一个终端标签会自动断开" : ""}
            </span>
          </div>
          <div className="dmsBody">
            {tabs.map((t) => (
              <XtermPane
                key={t.id}
                tab={t}
                active={t.id === active}
                onStatus={(patch) => {
                  setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
                }}
              />
            ))}
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
            ) : null}
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
      style={{
        position: "absolute",
        bottom: 8,
        left: 10,
        minWidth: 260,
        maxWidth: 340,
        background: "#262a33",
        border: "1px solid #3a3f4b",
        borderRadius: 10,
        padding: 8,
        boxShadow: "0 8px 28px rgba(0,0,0,.5)",
        zIndex: 5,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "#8b90a0", padding: "2px 6px 6px" }}>
        选择服务器
      </div>
      {servers.map((s) => (
        <button
          key={s.id}
          disabled={busy}
          onClick={() => onPick(s)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "7px 8px",
            borderRadius: 7,
            border: "none",
            background: "transparent",
            color: "#e6e8ee",
            fontFamily: "Inter,var(--dsw-font-family)",
            fontSize: 12.5,
            textAlign: "left",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#2e333d")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ color: "#8b90a0" }}>{Icon.terminal(13)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
            <span style={{ color: "#8b90a0", marginLeft: 6, fontSize: 11 }}>{s.username}@{s.host}</span>
          </span>
        </button>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 0", borderTop: "1px solid #333947", marginTop: 4 }}>
        <button
          onClick={onManage}
          style={{ border: "none", background: "transparent", color: "#8b90a0", fontSize: 11.5, cursor: "pointer", padding: "4px 6px" }}
        >
          + 添加服务器…
        </button>
        <button
          onClick={onClose}
          style={{ border: "none", background: "transparent", color: "#8b90a0", fontSize: 11.5, cursor: "pointer", padding: "4px 6px" }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

export default TerminalPanel;
