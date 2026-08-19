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
  defaultCollection,
  normalizeCollection,
  addTab,
  removeTab,
  renameItem,
  setActiveIndex,
  addMember,
  removeMember,
  reorderMember,
  swapMembers,
  setOrientation,
  setSize,
  collectSessions as collectAllSessions,
} from "../shared/group.mjs";
/* Settings card + the shared bound settings scope (rc.7 settings.plugin.item).
 * getSettingsScope is imported for module-internal use (the theme chain);
 * SettingsCard/setSettingsScope are re-exported for the build.mjs wrapper. */
import { getSettingsScope } from "./settings-card.js";
import { loadKeys, parseBinding, eventMatches, DEFAULT_KEYS } from "../shared/keybind.mjs";
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
/* Terminal Window (shell.overlay, ADR-0006) */
/* Wave palette (spec #32, extracted from Wave's tailwind @theme): dark by
 * default; under a light DSH theme the chrome falls back to DSH tokens
 * (user's concession, Q5b). The Terminal Area keeps its own adaptive
 * palettes. */
.dmsWin{position:fixed;z-index:80;display:flex;flex-direction:column;background:var(--wave-bg,#222);border:1px solid var(--wave-border,rgba(255,255,255,.16));border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);overflow:hidden;font-family:Inter,var(--dsw-font-family);transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease,border-radius .18s ease;--wave-bg:#222;--wave-fg:#f7f7f7;--wave-secondary:rgba(215,218,224,.7);--wave-accent:#58c142;--wave-border:rgba(255,255,255,.16);--wave-panel:rgba(31,33,31,.5);--wave-hover:rgba(255,255,255,.1)}
.dmsWin.isLight{--wave-bg:var(--dsw-bg,#1b1d23);--wave-fg:var(--dsw-alias-label-primary);--wave-secondary:var(--dsw-alias-label-secondary);--wave-accent:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));--wave-border:var(--dsw-alias-border-l1);--wave-panel:var(--dsw-specific-tip);--wave-hover:var(--dsw-alias-interactive-bg-hover)}
.dmsWin.isMoving{transition:none}
@media (prefers-reduced-motion:reduce){.dmsWin{transition:none}}
.dmsWin.isMax{left:0!important;top:0!important;width:100%!important;height:100%!important;border-radius:0;border:none}
.dmsWin.isBlur .dmsWinBar,.dmsWin.isBlur .dmsWinTool{opacity:.55}
.dmsWin.isBlur .dmsWinBody{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.dmsWin.isOpening{animation:dmsWinIn .15s ease-out}
.dmsWin.isClosing{animation:dmsWinOut .15s ease-in forwards}
@keyframes dmsWinIn{from{transform:scale(.95);opacity:.4}to{transform:none;opacity:1}}
@keyframes dmsWinOut{from{transform:none;opacity:1}to{transform:scale(.95);opacity:.3}}
.dmsWinActions{flex:none;display:flex;gap:2px}
.dmsWinAction{width:26px;height:26px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:7px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsWinAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmsWinAction.isOn{color:var(--dsw-alias-accent,var(--dsw-accent,#4c8dff))}
.dmsWinTool{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip)}
.dmsWinBody{flex:1;min-height:0;position:relative;background:var(--dmst-bg,#1e2128)}
.dmsWinResize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:9}
.dmsWinResize:after{content:'';position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid var(--dsw-alias-label-tertiary);border-bottom:2px solid var(--dsw-alias-label-tertiary);border-radius:1px;opacity:.6}

.dmsWinTabs{flex:none;display:flex;align-items:center;gap:4px;padding:4px 8px 0;border-bottom:1px solid var(--wave-border);background:var(--wave-bg);position:relative}
.dmsTabList{flex:1;min-width:0;display:flex;align-items:flex-end;gap:2px;overflow-x:auto;scrollbar-width:none}
.dmsTabList::-webkit-scrollbar{display:none}
.dmsTab{flex:none;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:7px 7px 0 0;border:1px solid transparent;border-bottom:none;color:var(--dsw-alias-label-tertiary);font-size:12px;max-width:180px;cursor:default}
.dmsTab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsTab.isActive{background:var(--wave-panel);border-color:var(--wave-border);color:var(--wave-fg)}
.dmsTabName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:none;color:inherit;font:inherit;cursor:pointer;padding:0}
.dmsTabEdit{width:120px;height:22px;border:1px solid var(--dsw-alias-accent,var(--dsw-accent,#4c8dff));border-radius:5px;background:var(--dsw-bg-input,transparent);color:var(--dsw-alias-label-primary);font:inherit;padding:0 6px;outline:none}
.dmsTabX{flex:none;width:18px;height:18px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:5px;cursor:pointer;display:grid;place-items:center;padding:0;opacity:0}
.dmsTab:hover .dmsTabX,.dmsTab.isActive .dmsTabX{opacity:.7}
.dmsTabX:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dmsTabAdd{flex:none;width:26px;height:26px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:7px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsTabAdd:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* Right sidebar (Wave widget picker, spec #32) */
.dmsSidebar{position:absolute;top:0;right:0;bottom:0;width:240px;z-index:10;display:flex;flex-direction:column;background:var(--wave-panel);border-left:1px solid var(--wave-border);box-shadow:-8px 0 24px rgba(0,0,0,.3);overflow:hidden}
.dmsSidebarHead{flex:none;height:34px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-bottom:1px solid var(--wave-border);font-size:12.5px;font-weight:600;color:var(--wave-fg)}
.dmsSidebarClose{margin-left:auto;width:24px;height:24px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:6px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsSidebarClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsSidebarSection{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 6px;overflow-y:auto}
.dmsSidebarSection + .dmsSidebarSection{border-top:1px solid var(--dsw-alias-border-l1)}
.dmsSidebarTitle{flex:none;padding:2px 6px 6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dmsSidebarEmpty{padding:8px 6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dmsSidebarRow{display:flex;align-items:center;gap:8px;width:100%;padding:6px;border-radius:7px;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12.5px}
button.dmsSidebarRow{border:none;background:transparent;text-align:left;cursor:pointer}
button.dmsSidebarRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsSidebarIcon{flex:none;display:grid;place-items:center}
.dmsSidebarLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0}

/* Split tree */
.dmsSplit{position:relative;display:flex;min-width:0;min-height:0;height:100%}
.dmsSplit.isH{flex-direction:row}
.dmsSplit.isV{flex-direction:column}
.dmsSplitPane{min-width:0;min-height:0;display:flex;position:relative}
.dmsDivider{position:absolute;z-index:5;background:transparent;transition:background .1s ease .5s}
.dmsDivider.isV{width:6px;top:0;bottom:0;cursor:col-resize;transform:translateX(-50%)}
.dmsDivider.isH{height:6px;left:0;right:0;cursor:row-resize;transform:translateY(-50%)}
.dmsDivider:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsBlock{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dmst-bg,#1c1c1c);border:1px solid var(--wave-border);border-radius:8px;margin:1.5px;overflow:hidden}
.dmsBlock:hover{border-color:var(--dsw-alias-label-dimmed)}
.dmsBlock.isActive{border-color:var(--wave-accent);box-shadow:0 0 0 1px var(--wave-accent)}
.dmsBlock.isSwapTarget{border-color:#fff}
.dmsDropHint{position:absolute;z-index:8;pointer-events:none;background:rgba(88,193,66,.35);border:1px solid rgba(88,193,66,.9);border-radius:6px}
.dmsDrop-inline-before[data-dir="row"]{left:2px;top:6px;bottom:6px;width:30%}
.dmsDrop-inline-after[data-dir="row"]{right:2px;top:6px;bottom:6px;width:30%}
.dmsDrop-inline-before[data-dir="col"]{top:2px;left:6px;right:6px;height:30%}
.dmsDrop-inline-after[data-dir="col"]{bottom:2px;left:6px;right:6px;height:30%}
.dmsDrop-outer-before[data-dir="row"]{left:2px;top:2px;width:34%;height:34%}
.dmsDrop-outer-after[data-dir="row"]{right:2px;bottom:2px;width:34%;height:34%}
.dmsDrop-outer-before[data-dir="col"]{left:2px;top:2px;width:34%;height:34%}
.dmsDrop-outer-after[data-dir="col"]{right:2px;bottom:2px;width:34%;height:34%}
.dmsDrop-inner-before[data-dir="row"]{left:33%;top:2px;width:34%;height:34%}
.dmsDrop-inner-after[data-dir="row"]{left:33%;bottom:2px;width:34%;height:34%}
.dmsDrop-inner-before[data-dir="col"]{top:33%;left:2px;width:34%;height:34%}
.dmsDrop-inner-after[data-dir="col"]{top:33%;right:2px;width:34%;height:34%}
.dmsDrop-swap{left:50%;top:50%;width:22%;height:22%;transform:translate(-50%,-50%);background:rgba(88,193,66,.5);border-radius:8px}
.dmsBlock.isDragging{opacity:.6}
.dmsBlockDrag{position:absolute;top:0;left:0;right:0;height:8px;z-index:6;cursor:grab}
.dmsBlockBadge{position:absolute;top:4px;left:6px;z-index:6;display:inline-flex;align-items:center;gap:4px;pointer-events:none;font-size:10px;color:var(--wave-secondary)}
.dmsBlockBadgeNum{min-width:14px;height:14px;display:grid;place-items:center;border-radius:4px;background:rgba(0,0,0,.45);color:#ddd;font-weight:600;padding:0 3px}
.dmsBlockDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary);box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.dmsBlockDot.isConnecting{background:#e8b339;animation:dmsPulse 1s ease-in-out infinite}
.dmsBlockDot.isLive{background:#2ee62e}
.dmsBlockDot.isClosed{background:#e74856}
.dmsBlockFloat{position:absolute;top:3px;right:5px;z-index:6;display:none;align-items:center;gap:1px;background:rgba(0,0,0,.35);border-radius:6px;padding:1px}
.dmsBlock:hover .dmsBlockFloat{display:flex}
.dmsSplitBtn,.dmsBlockRemove{width:20px;height:20px;border:none;background:transparent;color:#ddd;border-radius:5px;cursor:pointer;display:grid;place-items:center;padding:0;font-size:11px}
.dmsSplitBtn:hover{background:rgba(255,255,255,.15);color:#fff}
.dmsBlockRemove:hover{background:rgba(231,72,86,.35);color:#ff8b93}
.dmsBlockEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:transparent;width:100%;cursor:pointer;color:var(--wave-secondary);font-size:12px;font-weight:500}
.dmsBlockEmpty:hover{background:var(--dsw-alias-interactive-bg-hover)}

/* Session list panel */
.dmsListPanel{position:absolute;right:8px;bottom:8px;top:8px;width:260px;z-index:8;display:flex;flex-direction:column;background:var(--dsw-specific-tip,var(--dsw-bg,#1b1d23));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.5);overflow:hidden}
.dmsListHead{flex:none;height:34px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dmsListClose{margin-left:auto;width:24px;height:24px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:6px;cursor:pointer;display:grid;place-items:center;padding:0}
.dmsListClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsListBody{flex:1;min-height:0;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:4px}
.dmsListEmpty{padding:16px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
.dmsListRow{display:flex;align-items:center;gap:8px;width:100%;padding:5px 6px;border-radius:7px;color:var(--dsw-alias-label-secondary);font-family:Inter,var(--dsw-font-family);font-size:12.5px}
.dmsListRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsListLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:2px 0}
.dmsListKill{flex:none;width:18px;height:18px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:5px;cursor:pointer;display:grid;place-items:center;padding:0;opacity:0}
.dmsListRow:hover .dmsListKill{opacity:.8}
.dmsListKill:hover{opacity:1;background:rgba(231,72,86,.2);color:#ff8b93}
.dmsListDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.dmsListDot.isLive{background:#2ee62e}
.dmsListLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmsListHint{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}

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
  list: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x={1.6} y={2} width={10.8} height={1.6} rx={0.8} fill="currentColor" />
      <rect x={1.6} y={6.2} width={10.8} height={1.6} rx={0.8} fill="currentColor" />
      <rect x={1.6} y={10.4} width={7} height={1.6} rx={0.8} fill="currentColor" />
    </svg>
  ),
  maximize: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x={1.5} y={1.5} width={11} height={11} rx={1.5} stroke="currentColor" strokeWidth={1.1} />
      <path d="M4 1.5v-1M1.5 4h-1" stroke="currentColor" strokeWidth={0.01} />
    </svg>
  ),
  minimize: () => (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x={1.5} y={1.5} width={11} height={11} rx={1.5} stroke="currentColor" strokeWidth={1.1} />
      <path d="M5 4l5 6M5 10l5-6" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
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

/* ---------------- shared hooks (Dock + Focus View) ---------------- */

/**
 * The theme chain, shared by both surfaces: per-browser Theme Override wins,
 * then the defaultTerminalTheme Server Default, then the GUI scheme. Also
 * exposes the Terminal Area surface variables and hot-swaps every open xterm
 * (all surfaces) when the resolved theme changes.
 */
function useTerminalTheme() {
  const guiScheme = React.useSyncExternalStore(subscribeGuiScheme, getGuiScheme, getGuiScheme);
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
  const defaultTheme = React.useSyncExternalStore(subscribeDefaultTheme, getDefaultTheme, getDefaultTheme);
  const resolvedTheme: "dark" | "light" =
    override !== "auto" ? override : defaultTheme !== "auto" ? defaultTheme : guiScheme;

  // Push the Server Default into the theme signal whenever the settings
  // scope emits (hot-swaps open terminals through the effect below).
  React.useEffect(() => {
    const scope = getSettingsScope();
    if (scope === null) return;
    const push = () => pushDefaultTheme(scope.getSnapshot().value?.defaultTerminalTheme);
    push();
    return scope.subscribe(push);
  }, []);

  // Terminal Area surface colors, applied declaratively so they are correct
  // the moment the surface body mounts.
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

  return { override, cycleOverride, resolvedTheme, surfaceVars };
}


/* ---------------- workspace tree (ADR-0006) ---------------- */

/** The global workspace collection (ADR-0007): the floating window and the
 *  full-screen view are viewports over the active (workspace, tab) tree,
 *  host-authoritative and pushed via /workspace/events. */
function useWorkspaceState(enabled: boolean) {
  const [collection, setCollection] = React.useState<any>(defaultCollection());
  React.useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    api("/workspace")
      .then((b) => {
        if (!cancelled) setCollection(b.workspace ?? defaultCollection());
      })
      .catch(() => {
        /* older host: no workspace route — keep the local default */
      });
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + PREFIX + "/workspace/events");
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || cancelled) return;
        try {
          setCollection(JSON.parse(ev.data));
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
  }, [enabled]);
  const commit = React.useCallback((next: any) => {
    setCollection(next);
    api("/workspace", { method: "PUT", body: JSON.stringify(next) }).catch((e) => {
      console.error("[dsh-ssh-hub] workspace PUT failed, reverting:", e);
      api("/workspace")
        .then((b) => setCollection(b.workspace ?? defaultCollection()))
        .catch(() => {
          /* host unreachable; keep local state until the next push */
        });
    });
  }, []);
  return { collection, commit };
}

/** Frame-wide visibility of the terminal window (ADR-0006). */
let terminalVisible = false;
let terminalMaximized = false;
const terminalListeners = new Set<() => void>();
export function setTerminalVisible(v: boolean) {
  const next = Boolean(v);
  if (next === terminalVisible) return;
  terminalVisible = next;
  if (next && terminalMaximized) terminalMaximized = false; // reopen windowed
  for (const l of [...terminalListeners]) l();
}
export function getTerminalVisible() {
  return terminalVisible;
}
export function setTerminalMaximized(v: boolean) {
  const next = Boolean(v);
  if (next === terminalMaximized) return;
  terminalMaximized = next;
  for (const l of [...terminalListeners]) l();
}
export function getTerminalMaximized() {
  return terminalMaximized;
}
function subscribeTerminal(listener: () => void) {
  terminalListeners.add(listener);
  return () => {
    terminalListeners.delete(listener);
  };
}

/** Reduce-motion check (opening/closing animation and drags respect it). */
function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------------- split tree view ---------------- */



/**
 * Recursive renderer for the workspace tree. A Leaf renders a Block (a
 * Terminal Session or an empty slot); a Split renders a flex row/column with
 * a draggable divider. Blocks carry a slim title bar: block number, session
 * label, four split buttons, and a remove button (session returns to the
 * unplaced list, the block stays). Blocks drag: onto another block's centre
 * swaps the two sessions, onto its edges opens a new pane in that direction
 * (RGB-coded preview: red=left, green=right, cyan=top, blue=bottom).
 */
/* ---------------- items view (tab full-window / workspace side-by-side) ---- */

/** A workspace member tile: status badge + terminal, hover float actions. */
function MemberTile({
  member,
  tabs,
  onStatus,
  onMagnify,
  isMagnified,
  onClose,
  onRemove,
}: {
  member: { sessionId: string; name: string };
  tabs: TermTab[];
  onStatus: (tabId: string, patch: Partial<TermTab>) => void;
  onMagnify: () => void;
  isMagnified: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const tab = tabs.find((t) => t.id === member.sessionId);
  const dotClass =
    tab === undefined || tab.status === "connecting"
      ? "dmsBlockDot isConnecting"
      : tab.status === "live"
        ? "dmsBlockDot isLive"
        : "dmsBlockDot isClosed";
  return (
    <div className="dmsMember" onClick={() => onMagnify()}>
      <span className="dmsBlockBadge" title={member.name}>
        <span className={dotClass} />
        <span className="dmsBlockBadgeNum">{member.name}</span>
      </span>
      <span className="dmsBlockFloat">
        <button
          className="dmsSplitBtn"
          title={isMagnified ? "还原" : "放大"}
          aria-label={isMagnified ? "还原" : "放大"}
          onClick={(e) => {
            e.stopPropagation();
            onMagnify();
          }}
        >
          {isMagnified ? Icon.minimize() : Icon.maximize()}
        </button>
        <button className="dmsBlockRemove" title="移出组合（会话回清单）" aria-label="移出组合" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          {Icon.close()}
        </button>
      </span>
      <XtermPane
        tab={tab ?? { id: member.sessionId, serverId: "", label: member.name, status: "connecting" }}
        active={true}
        surface="window"
        onStatus={(patch) => onStatus(member.sessionId, patch)}
      />
    </div>
  );
}

/** The active item: a tab shows its session full-window; a workspace shows
 *  its members side-by-side (orientation + draggable dividers). */
function ItemsView({
  collection,
  tabs,
  magnifiedMember,
  onMagnifyMember,
  onStatus,
  onCommit,
  onCloseItem,
  onPlace,
  openSidebar,
}: {
  collection: any;
  tabs: TermTab[];
  magnifiedMember: number | null;
  onMagnifyMember: (idx: number | null) => void;
  onStatus: (tabId: string, patch: Partial<TermTab>) => void;
  onCommit: (next: any) => void;
  onCloseItem: (idx: number) => void;
  onPlace: (sessionId: string) => void;
  openSidebar: () => void;
}) {
  const it = collection.items[collection.activeIndex] ?? null;
  if (it === null) {
    return (
      <div className="dmsItemsEmpty">
        <span>还没有会话</span>
        <button className="dmsEmptyBtn" onClick={openSidebar}>
          {Icon.plus()} 打开侧栏放入会话
        </button>
      </div>
    );
  }
  if (it.kind === "tab") {
    if (it.sessionId === null) {
      return (
        <div className="dmsItemsEmpty">
          <span>空标签——从右侧边栏放入会话</span>
          <button className="dmsEmptyBtn" onClick={openSidebar}>
            {Icon.plus()} 打开侧栏
          </button>
        </div>
      );
    }
    const tab = tabs.find((t) => t.id === it.sessionId);
    return (
      <XtermPane
        tab={tab ?? { id: it.sessionId, serverId: "", label: it.name, status: "connecting" }}
        active={true}
        surface="window"
        onStatus={(patch) => onStatus(it.sessionId!, patch)}
      />
    );
  }
  // workspace: members side-by-side
  const total = it.sizes.reduce((a, b) => a + b, 0) || it.members.length;
  const shown = magnifiedMember !== null ? [it.members[magnifiedMember]] : it.members;
  const shownSizes = magnifiedMember !== null ? [1] : it.sizes;
  const shownTotal = shownSizes.reduce((a, b) => a + b, 0) || shown.length;
  return (
    <div className={"dmsWsView" + (it.orientation === "v" ? " isV" : " isH")}>
      {shown.map((m, i) => {
        const idx = magnifiedMember !== null ? magnifiedMember : i;
        const pct = shownTotal > 0 ? (shownSizes[i] / shownTotal) * 100 : 100 / shown.length;
        return (
          <React.Fragment key={m.sessionId}>
            <div className="dmsWsMember" style={{ flex: `${pct}% 1 0` }}>
              <MemberTile
                member={m}
                tabs={tabs}
                onStatus={onStatus}
                onMagnify={() => onMagnifyMember(magnifiedMember === idx ? null : idx)}
                isMagnified={magnifiedMember === idx}
                onClose={() => onCloseItem(collection.activeIndex)}
                onRemove={() => onCommit(removeMember(collection, collection.activeIndex, idx).collection)}
              />
            </div>
            {i < shown.length - 1 && (
              <GroupDivider
                wsIdx={collection.activeIndex}
                memberIdx={idx}
                orientation={it.orientation}
                collection={collection}
                onCommit={onCommit}
              />
            )}
          </React.Fragment>
        );
      })}
      {magnifiedMember === null && (
        <button
          className="dmsWsOrient"
          title="切换并排方向（左右 / 上下）"
          onClick={() => onCommit(setOrientation(collection, collection.activeIndex, it.orientation === "h" ? "v" : "h"))}
        >
          {it.orientation === "h" ? "⇄ 上下" : "⇅ 左右"}
        </button>
      )}
    </div>
  );
}

/** Draggable divider between workspace members; adjusts the member's size. */
function GroupDivider({
  wsIdx,
  memberIdx,
  orientation,
  collection,
  onCommit,
}: {
  wsIdx: number;
  memberIdx: number;
  orientation: "h" | "v";
  collection: any;
  onCommit: (next: any) => void;
}) {
  const dragRef = React.useRef<{ x: number; y: number; size: number } | null>(null);
  const [overriding, setOverriding] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (dragRef.current === null) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d === null) return;
      const el = (e.target as HTMLElement).closest(".dmsWsView") as HTMLElement | null;
      const extent = el === null ? 600 : orientation === "h" ? el.clientWidth : el.clientHeight;
      const delta = orientation === "h" ? (e.clientX - d.x) / extent : (e.clientY - d.y) / extent;
      const size = Math.min(0.85, Math.max(0.15, d.size + delta));
      setOverriding(size);
    };
    const up = () => {
      if (dragRef.current !== null && overriding !== null) {
        onCommit(setSize(collection, wsIdx, memberIdx, overriding));
      }
      dragRef.current = null;
      setOverriding(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [orientation, collection, wsIdx, memberIdx, onCommit, overriding]);
  return (
    <div
      className={"dmsGroupDivider" + (orientation === "h" ? " isV" : " isH")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragRef.current = { x: e.clientX, y: e.clientY, size: overriding ?? collection.items[wsIdx]?.sizes?.[memberIdx] ?? 1 };
      }}
    />
  );
}

/* ---------------- terminal window (frame-wide surface) ---------------- */

const WIN_KEY = "dsh-ssh-hub.win";
function loadWin() {
  try {
    const v = JSON.parse(localStorage.getItem(WIN_KEY) ?? "");
    if (typeof v.x === "number" && typeof v.y === "number" && typeof v.w === "number" && typeof v.h === "number") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return {
    x: Math.max(0, Math.round((window.innerWidth - 780) / 2)),
    y: Math.max(0, Math.round((window.innerHeight - 480) / 2)),
    w: Math.min(780, window.innerWidth - 24),
    h: Math.min(480, window.innerHeight - 24),
  };
}
function saveWin(v: { x: number; y: number; w: number; h: number }) {
  try {
    localStorage.setItem(WIN_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function TerminalWindow() {
  const visible = React.useSyncExternalStore(subscribeTerminal, getTerminalVisible, getTerminalVisible);
  const maximized = React.useSyncExternalStore(subscribeTerminal, getTerminalMaximized, getTerminalMaximized);
  const { collection, commit } = useWorkspaceState(visible);
  const [renaming, setRenaming] = React.useState<{ tab: number; text: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  /** The active item (tab = one session full-window; workspace = a flat group)
   *  and a commit writing the collection back. */
  const activeItem = collection.items[collection.activeIndex] ?? null;
  const commitItems = React.useCallback((next: any) => commit(next), [commit]);
  /** Magnify: a workspace member fills the window (member index). */
  const [magnifiedMember, setMagnifiedMember] = React.useState<number | null>(null);
  const { override, cycleOverride, resolvedTheme, surfaceVars } = useTerminalTheme();
  const guiScheme = React.useSyncExternalStore(subscribeGuiScheme, getGuiScheme, getGuiScheme);

  const [tabs, setTabs] = React.useState<TermTab[]>([]);
  const [servers, setServers] = React.useState<ServerView[]>([]);
  const [defaults, setDefaults] = React.useState<ServerDefaults | null>(null);
  const [drawer, setDrawer] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [win, setWin] = React.useState(loadWin);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [focused, setFocused] = React.useState(true);
  const [opening, setOpening] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const movedRef = React.useRef(false);
  const lastClickRef = React.useRef<{ t: number; x: number; y: number } | null>(null);

  /* ---- world state: sessions + servers (projections of host truth) ---- */
  React.useEffect(() => {
    if (!visible) return;
    refreshServers();
    refreshDefaults();
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
        if (remote.length > 0 && collection.items.length === 0) {
          // no items yet: open the first session as its own tab
          commit({ ...collection, items: [{ kind: "tab", sessionId: remote[0].id, name: remote[0].label }], activeIndex: 0 });
        }
      })
      .catch(() => {});
  }, [visible]);

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

  /* ---- measure content for canSplit ---- */
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el === null) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, maximized]);

  /* ---- opening/closing animation (skipped under reduced motion) ---- */
  React.useEffect(() => {
    if (visible) {
      if (prefersReducedMotion()) return;
      setOpening(true);
      const t = setTimeout(() => setOpening(false), 170);
      return () => clearTimeout(t);
    }
    // closing: keep the component mounted briefly so the reverse plays
    if (prefersReducedMotion()) return;
    setClosing(true);
    const t = setTimeout(() => setClosing(false), 160);
    return () => clearTimeout(t);
  }, [visible]);

  /* ---- focus dimming: only the frame dims, content stays readable ---- */
  React.useEffect(() => {
    if (!visible) return;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [visible]);



  /* ---- keyboard: Esc (maximized then close), plus basic Wave bindings.
   * Hardcoded here; the full configurable preset lands in T4. ---- */
  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (magnifiedMember !== null) setMagnifiedMember(null);
        else if (getTerminalMaximized()) setTerminalMaximized(false);
        else setTerminalVisible(false);
        return;
      }
      // Configurable bindings (Wave preset by default); read fresh each
      // keydown so settings-card changes apply immediately.
      const keys = loadKeys();
      const match = (action: string) => eventMatches(e, parseBinding(keys[action] ?? DEFAULT_KEYS[action] ?? ""));
      if (match("newTab")) {
        e.preventDefault();
        newTab();
        return;
      }
      if (match("closeTab") || match("closeBlock")) {
        // both map to closing the active item (a tab or the focused member)
        e.preventDefault();
        closeTabAt(collection.activeIndex ?? 0);
        return;
      }
      if (match("magnify")) {
        e.preventDefault();
        if (magnifiedMember !== null) setMagnifiedMember(null);
        else if (activeItem?.kind === "workspace") setMagnifiedMember(0);
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        setRenaming({ tab: collection.activeIndex ?? 0, text: collection.items[collection.activeIndex ?? 0]?.name ?? "" });
        return;
      }
      // Fixed Wave-style numeric binding: Alt+1-9 switches items.
      if (!e.ctrlKey && !e.metaKey && e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const target = Number(e.key) - 1;
        if (target < collection.items.length) commit(setActiveIndex(collection, target));
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, collection, activeItem, magnifiedMember]);

  /* ---- tab operations ---- */
  const newTab = () => {
    const next = addTab(collection);
    commit(setActiveTab(next, next.tabs.length - 1));
  };
  const closeTabAt = (tabIdx: number) => {
    const [next] = removeTab(collection, tabIdx);
    commit(next);
  };
  const doRenameTab = (tabIdx: number, name: string) => {
    commit(renameTab(collection, tabIdx, name));
    setRenaming(null);
  };


  /* ---- window chrome: move (clamped) / resize / maximize ---- */
  const startMove = (e: React.PointerEvent) => {
    if (e.button !== 0 || maximized) return;
    if ((e.target as HTMLElement).closest("button, .dmsTab, .dmsTabAdd")) return;
    e.preventDefault();
    const sx = e.clientX - win.x;
    const sy = e.clientY - win.y;
    let moved = false;
    setMoving(true);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 4) moved = true;
      if (!moved) return;
      const x = Math.min(Math.max(0, ev.clientX - sx), Math.max(0, window.innerWidth - 60));
      const y = Math.min(Math.max(0, ev.clientY - sy), Math.max(0, window.innerHeight - 36));
      setWin((w) => ({ ...w, x, y }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMoving(false);
      // a real drag must not count as a double-click on release
      movedRef.current = moved;
      setWin((w) => {
        saveWin(w);
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0 || maximized) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = win.w;
    const sh = win.h;
    setMoving(true);
    const move = (ev: PointerEvent) => {
      const w = Math.max(480, Math.min(window.innerWidth - 24, sw + (ev.clientX - sx)));
      const h = Math.max(320, Math.min(window.innerHeight - 24, sh + (ev.clientY - sy)));
      setWin((p) => ({ ...p, w, h }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMoving(false);
      setWin((w) => {
        saveWin(w);
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleMax = () => setTerminalMaximized(!getTerminalMaximized());


  const placeInto = (sessionId: string) => {
    // Put the session into the active item: an empty tab takes it; a
    // workspace appends it; otherwise a new tab. A busy tab spawns a new tab.
    const it = activeItem;
    const tab = tabs.find((t) => t.id === sessionId);
    const name = tab?.label ?? sessionId;
    let next = collection;
    if (it !== null && it.kind === "tab" && it.sessionId === null) {
      const items = collection.items.map((x, i) => (i === collection.activeIndex ? { ...x, sessionId, name } : x));
      next = { ...collection, items };
    } else if (it !== null && it.kind === "workspace") {
      next = addMember(collection, collection.activeIndex, { sessionId, name });
    } else {
      next = addTab(collection);
      const items = next.items.map((x, i) => (i === next.items.length - 1 ? { ...x, sessionId, name } : x));
      next = { ...next, items };
    }
    commitItems(next);
    setSidebarOpen(false);
  };
  const connectTo = async (s: ServerView) => {
    setBusy(true);
    setPicker(false);
    try {
      const body = await api("/sessions", { method: "POST", body: JSON.stringify({ serverId: s.id, cols: 80, rows: 24 }) });
      const tab: TermTab = { id: body.id, serverId: s.id, label: s.name || `${s.username}@${s.host}`, status: "connecting" };
      setTabs((prev) => [...prev, tab]);
      // open it in the focused block (or the first empty leaf / a new right split)
      const next = addTab(collection);
      const items = next.items.map((x, i) => (i === next.items.length - 1 ? { ...x, sessionId: body.id, name: tab.label } : x));
      commitItems({ ...next, items, activeIndex: next.items.length - 1 });
    } catch (e) {
      window.alert("连接失败：" + String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const killSession = async (id: string) => {
    try {
      await api("/sessions/" + id, { method: "DELETE" });
    } catch {
      /* already gone */
    }
    // reconcile from the host
    try {
      const body = await api("/sessions");
      const remote: Array<{ id: string; serverId: string; label: string; serverName: string; exited: boolean }> = body.sessions ?? [];
      setTabs(remote.map((s) => ({ id: s.id, serverId: s.serverId, label: s.serverName || s.label, status: s.exited ? "closed" : "connecting" })));
    } catch {
      /* host unreachable */
    }
  };
  const closeTab = async (id: string) => {
    try {
      await api("/sessions/" + id, { method: "DELETE" });
    } catch {
      /* the session may already be gone; reconcile below */
    }
    try {
      const body = await api("/sessions");
      const remote: Array<{ id: string; serverId: string; label: string; serverName: string; exited: boolean }> = body.sessions ?? [];
      setTabs(remote.map((s) => ({ id: s.id, serverId: s.serverId, label: s.serverName || s.label, status: s.exited ? "closed" : "connecting" })));
    } catch {
      /* host unreachable */
    }
  };

  if (!visible && !closing) return null;

  const placedCount = collectAllSessions(collection).length;
  const stateLabel =
    tabs.length === 0
      ? servers.length === 0
        ? "未配置服务器"
        : "就绪"
      : `${placedCount} 个会话在窗口中`;

  return (
    <div
      ref={rootRef}
      className={"dmsWin" + (maximized ? " isMax" : "") + (focused ? "" : " isBlur") + (opening ? " isOpening" : "") + (closing ? " isClosing" : "") + (moving ? " isMoving" : "") + (guiScheme === "light" ? " isLight" : "")}
      style={maximized ? undefined : { left: win.x, top: win.y, width: win.w, height: win.h }}
      onPointerDown={() => setFocused(true)}
      role="dialog"
      aria-label="SSH 终端"
    >
      <div className="dmsWinTabs" onPointerDown={startMove}>
        <div className="dmsTabList" role="tablist">
          {collection.items.map((it, i) => (
            <span
              key={i}
              className={"dmsTab" + (i === collection.activeIndex ? " isActive" : "") + (it.kind === "workspace" ? " isGroup" : "")}
              onDoubleClick={() => setRenaming({ tab: i, text: it.name })}
            >
              {renaming !== null && renaming.tab === i ? (
                <input
                  className="dmsTabEdit"
                  autoFocus
                  value={renaming.text}
                  onChange={(e) => setRenaming({ ...renaming, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doRenameTab(i, renaming.text.trim() || it.name);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <button
                  className="dmsTabName"
                  role="tab"
                  aria-selected={i === collection.activeIndex}
                  onClick={() => commit(setActiveIndex(collection, i))}
                >
                  {it.kind === "workspace" ? `${it.name} · ${it.members.length}` : it.name}
                </button>
              )}
              <button
                className="dmsTabX"
                title={it.kind === "workspace" ? "解散组合（会话回到清单）" : "关闭标签页（Alt+Shift+w）"}
                aria-label={it.kind === "workspace" ? "解散组合" : "关闭标签页"}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTabAt(i);
                }}
              >
                {Icon.close()}
              </button>
            </span>
          ))}
        </div>
        <button className="dmsTabAdd" title="新标签页（Alt+t）" aria-label="新标签页" onClick={newTab}>
          {Icon.plus()}
        </button>
        <span className="dmsWinActions" onClick={(e) => e.stopPropagation()}>
          <button className={"dmsWinAction" + (sidebarOpen ? " isOn" : "")} title="Widgets（服务器 / 未放置会话）" aria-label="Widgets" onClick={() => setSidebarOpen((v) => !v)}>
            {Icon.list()}
          </button>
          <button className="dmsWinAction" title="服务器管理" aria-label="服务器管理" onClick={() => setDrawer(true)}>
            {Icon.gear()}
          </button>
          <button className="dmsWinAction" title={"终端主题：" + OVERRIDE_LABEL[override]} aria-label="终端主题" onClick={cycleOverride}>
            {override === "auto" ? Icon.autoTheme() : override === "dark" ? Icon.moon() : Icon.sun()}
          </button>
          <button className="dmsWinAction" title={maximized ? "还原窗口" : "最大化"} aria-label="最大化/还原" onClick={toggleMax}>
            {maximized ? Icon.minimize() : Icon.maximize()}
          </button>
          <button className="dmsWinAction" title="收起（Esc）" aria-label="收起" onClick={() => setTerminalVisible(false)}>
            {Icon.close()}
          </button>
        </span>
      </div>
      <div className="dmsWinBody" ref={bodyRef} data-term-theme={resolvedTheme} style={surfaceVars}>
        <ItemsView
          collection={collection}
          tabs={tabs}
          magnifiedMember={magnifiedMember}
          onMagnifyMember={setMagnifiedMember}
          onStatus={(tabId, patch) => setTabs((prev) => prev.map((x) => (x.id === tabId ? { ...x, ...patch } : x)))}
          onCommit={commitItems}
          onCloseItem={closeTabAt}
          onPlace={placeInto}
          openSidebar={() => setSidebarOpen(true)}
        />
        {picker && (
          <ServerPicker servers={servers} busy={busy} onPick={connectTo} onManage={() => setDrawer(true)} onClose={() => setPicker(false)} />
        )}
        {sidebarOpen && (
          <RightSidebar
            servers={servers}
            tabs={tabs}
            collection={collection}
            onStart={(s) => connectTo(s)}
            onPlace={(id) => placeInto(id)}
            onKill={(id) => killSession(id)}
            onClose={() => setSidebarOpen(false)}
          />
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
      {!maximized && <div className="dmsWinResize" onPointerDown={startResize} title="拖动缩放" />}
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
      onClick={() => setTerminalVisible(true)}
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

// TerminalWindow replaced the Dock-era TerminalPanel (ADR-0006); the default
// export must name a real component — a dangling identifier here previously
// shipped as an undefined global and broke the loader entry at runtime.
export default TerminalWindow;
