// Background sweeper that deletes each raid's throwaway sheet TAB once it is due
// (a few days after the raid). It only ever deletes tab gids we recorded in the
// event-sheets store — never the source template tab. A failure leaves the
// record in place so the next sweep retries.

const SheetsClient = require("../classes/sheets");
const { listEventSheets, deleteEventSheet } = require("../web/eventSheetStore");

/**
 * Delete every tracked tab whose deleteAfter is due (<= now). Best-effort:
 * per-tab failures are logged and retried on the next sweep. Returns the number
 * of tabs actually deleted. `makeClient` is injectable for tests.
 */
async function sweepDueSheets(now = Date.now(), makeClient = (spreadsheetId) => new SheetsClient({ spreadsheetId })) {
    const due = listEventSheets().filter(
        (s) => s && s.spreadsheetId && (s.sheetGid || s.sheetGid === 0) && s.deleteAfter && s.deleteAfter <= now
    );
    let deleted = 0;
    for (const s of due) {
        try {
            await makeClient(s.spreadsheetId).deleteTab(s.sheetGid);
            deleteEventSheet(s.eventId);
            deleted += 1;
        } catch (e) {
            console.error(`[sheetCleanup] tab delete failed for ${s.spreadsheetId}#${s.sheetGid}: ${e.message}`);
        }
    }
    return deleted;
}

let timer = null;

/**
 * Start the periodic sweep (idempotent). Sweeps once on boot, then on an
 * interval. The timer is unref'd so it never keeps the process alive on its own.
 */
function startSheetCleanup({ intervalMs = 60 * 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => sweepDueSheets().catch((e) => console.error("[sheetCleanup]", e.message));
    run();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { sweepDueSheets, startSheetCleanup };
