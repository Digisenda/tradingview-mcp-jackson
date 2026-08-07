import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server) {
  server.tool('tab_list', 'List all open TradingView chart tabs', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_new', 'Open a new chart tab', {}, async () => {
    try { return jsonResult(await core.newTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close', 'Close the current chart tab', {}, async () => {
    try { return jsonResult(await core.closeTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch', 'Switch to a chart tab by index', {
    index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
  }, async ({ index }) => {
    try { return jsonResult(await core.switchTab({ index })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_pin_tab', 'Pin every subsequent tool call to one exact TradingView chart tab by chart_id (from tab_list). REQUIRED before any other tool call whenever tab_list reports 2+ tabs and none is pinned yet — without a pin, tools now fail loudly instead of guessing, because guessing wrong means silently reading or mutating someone else\'s live chart (e.g. a manual trading tab). Call with no chart_id to unpin.', {
    chart_id: z.string().optional().describe('The chart_id segment from the target tab\'s URL, as returned by tab_list (e.g. "AzrxylzJ"). Omit to unpin.'),
  }, async ({ chart_id }) => {
    try { return jsonResult(await core.pinTab({ chart_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_get_pin', 'Report which chart_id (if any) is currently pinned for this MCP session', {}, async () => {
    try { return jsonResult(core.getPin()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
