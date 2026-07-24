// Background sweeper that deletes each raid's throwaway sheet copy once it is
// due (a few days after the raid). It only ever deletes Drive files whose ids
// we recorded in the event-sheets store — never a source raidsheet. A Drive
// failure leaves the record in place so the next sweep retries.

const Drive = require("../classes/drive");
const { listEventSheets, deleteEventSheet } = require("../web/eventSheetStore");

/**
 * Delete every tracked copy whose deleteAfter is due (<= now). Best-effort:
 * per-copy failures are logged and retried on the next sweep. Returns the
 * number of copies actually deleted.
 */
async function sweepDueSheets(now = Date.now(), drive = new Drive()) {
    const due = listEventSheets().filter(
        (s) => s && s.spreadsheetId && s.deleteAfter && s.deleteAfter <= now
    );
    let deleted = 0;
    for (const s of due) {
        try {
            await drive.deleteFile(s.spreadsheetId);
            deleteEventSheet(s.eventId);
            deleted += 1;
        } catch (e) {
            console.error(`[sheetCleanup] delete failed for ${s.spreadsheetId}: ${e.message}`);
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
