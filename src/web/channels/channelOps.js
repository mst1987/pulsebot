// The logic between the Kanäle API and Discord (issue #259): run one action over
// several channels one after another, say per channel what happened, and tell
// which channels belong to an upcoming or a past event.
//
// Serial with a short pause on purpose. Discord allows only a couple of channel
// edits per channel every few minutes and a handful per second per guild; firing
// twenty renames at once gets most of them bounced with a 429 and leaves the
// admin with a half-renamed category.

const { discordErrorText } = require("../../services/discord/discordChannels");
const { plural } = require("../../utils/text");

const DEFAULT_PAUSE_MS = 350;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `action(id, index)` for every id, one after another. Never throws: a
 * failing channel becomes `{ id, ok: false, error }` and the rest goes on.
 */
async function runSerial(ids, action, { pauseMs = DEFAULT_PAUSE_MS } = {}) {
    const unique = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    const results = [];
    for (let i = 0; i < unique.length; i++) {
        if (i > 0 && pauseMs > 0) await sleep(pauseMs);
        const id = unique[i];
        try {
            const value = await action(id, i);
            results.push({ id, ok: true, ...(value && typeof value === "object" ? value : {}) });
        } catch (e) {
            results.push({ id, ok: false, error: discordErrorText(e) });
        }
    }
    return results;
}


/**
 * "3 Kanäle geändert, 1 fehlgeschlagen: fehlende Rechte" — the toast line for a
 * bulk result. The reasons are grouped, so ten identical failures read once.
 */
function summarize(results, verb = "geändert") {
    const done = (results || []).filter((r) => r.ok).length;
    const failed = (results || []).filter((r) => !r.ok);
    const reasons = [...new Set(failed.map((r) => r.error).filter(Boolean))];
    let message = `${plural(done, "Kanal", "Kanäle")} ${verb}`;
    if (failed.length) message += `, ${failed.length} fehlgeschlagen${reasons.length ? `: ${reasons.join(", ")}` : ""}`;
    return { done, failed: failed.length, message };
}

/**
 * Which channels carry a raid event: `{ [channelId]: { status, title, startTime } }`.
 * "event" = the newest event in that channel still lies ahead (or started less
 * than `graceHours` ago — a raid in progress is not "vergangen"), "past" = it is
 * over. Built from the persisted Raid-Helper snapshot, so it costs no API call.
 */
function eventStatusByChannel(events, { now = Date.now(), graceHours = 12 } = {}) {
    const newest = new Map();
    for (const ev of events || []) {
        if (!ev || !ev.channelId) continue;
        const known = newest.get(ev.channelId);
        if (!known || (ev.startTime || 0) > (known.startTime || 0)) newest.set(ev.channelId, ev);
    }
    const out = {};
    const cutoff = now / 1000 - graceHours * 3600;
    for (const [channelId, ev] of newest) {
        out[channelId] = {
            status: (ev.startTime || 0) >= cutoff ? "event" : "past",
            title: ev.title || "",
            startTime: ev.startTime || 0,
            eventId: ev.id || "",
        };
    }
    return out;
}

module.exports = { DEFAULT_PAUSE_MS, runSerial, summarize, eventStatusByChannel };
