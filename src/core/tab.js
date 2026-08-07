/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 */
import { getClient, evaluate, pinToChartId, getPinnedChartId } from '../connection.js';

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

/**
 * List all open chart tabs (CDP page targets).
 */
export async function list() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const pinnedId = getPinnedChartId();

  const tabs = targets
    .filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    .map((t, i) => {
      const chart_id = t.url.match(/\/chart\/([^/?]+)/)?.[1] || null;
      return {
        index: i,
        id: t.id,
        title: t.title.replace(/^Live stock.*charts on /, ''),
        url: t.url,
        chart_id,
        pinned: !!pinnedId && chart_id === pinnedId,
      };
    });

  return {
    success: true,
    tab_count: tabs.length,
    pinned_chart_id: pinnedId,
    ambiguous: tabs.length > 1 && !pinnedId,
    tabs,
  };
}

/**
 * Pin every subsequent tool call to one exact chart tab by chart_id (the
 * segment of its TradingView URL, as returned by list()). Pass null/undefined
 * to unpin.
 *
 * Needed as soon as 2+ TradingView chart tabs are open at once (e.g. manual
 * trading tabs alongside a scan/automation tab) — without a pin, connection.js
 * throws instead of guessing which tab to drive, since guessing wrong means
 * silently reading or mutating someone else's live chart (see connection.js
 * selectChartTarget for the incident this was built to prevent).
 */
export async function pinTab({ chart_id } = {}) {
  const id = chart_id || null;
  pinToChartId(id);

  if (!id) {
    return { success: true, action: 'unpinned', pinned_chart_id: null };
  }

  // Verify the chart_id actually exists among open tabs before reporting success,
  // and surface the current tab list either way for confirmation.
  const state = await list();
  const match = state.tabs.find(t => t.chart_id === id);
  if (!match) {
    return {
      success: false,
      action: 'pin_set_but_not_found',
      pinned_chart_id: id,
      warning: `Se guardó el pin (chart_id=${id}) pero ninguna pestaña abierta lo tiene ahora mismo.`,
      tabs: state.tabs,
    };
  }
  return { success: true, action: 'pinned', pinned_chart_id: id, tab: match };
}

export function getPin() {
  return { success: true, pinned_chart_id: getPinnedChartId() };
}

/**
 * Open a new chart tab via keyboard shortcut (Ctrl+T / Cmd+T).
 */
export async function newTab() {
  const c = await getClient();

  // Electron/TradingView Desktop uses Ctrl+T for new tab on macOS too
  // But some versions use Cmd+T
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2; // 4 = meta (Cmd), 2 = ctrl

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 't',
    code: 'KeyT',
    windowsVirtualKeyCode: 84,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 't', code: 'KeyT' });

  await new Promise(r => setTimeout(r, 2000));

  // Verify a new tab appeared
  const state = await list();
  return { success: true, action: 'new_tab_opened', ...state };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W).
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  const c = await getClient();
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2;

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'w', code: 'KeyW' });

  await new Promise(r => setTimeout(r, 1000));

  const after = await list();
  return { success: true, action: 'tab_closed', tabs_before: before.tab_count, tabs_after: after.tab_count };
}

/**
 * Switch to a tab by index. Reconnects CDP to the new target.
 */
export async function switchTab({ index }) {
  const tabs = await list();
  const idx = Number(index);

  if (idx >= tabs.tab_count) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
  }

  const target = tabs.tabs[idx];

  // Use CDP Target.activateTarget to bring the tab to front
  try {
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
    const text = await resp.text();
    return { success: true, action: 'switched', index: idx, tab_id: target.id, chart_id: target.chart_id };
  } catch (e) {
    throw new Error(`Failed to activate tab ${idx}: ${e.message}`);
  }
}
