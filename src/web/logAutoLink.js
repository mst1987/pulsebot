// Persisting the automatic log->event assignment.
//
// logEventMatch.js only *computes* which raid a detected Warcraft-Log belongs
// to; until this module ran, that verdict lived nowhere. That was the source of
// the "the raid list shows a log, the event detail page says none is assigned"
// mismatch: the list re-derived the time match on every render while the detail
// page (rightly) only ever read the stored `eventId`.
//
// So the match is applied and written to the log store as soon as a log is
// detected, plus periodically as a safety net (a log posted while Raid-Helper is
// down, or before its event exists, gets picked up on the next sweep). Admins
// still correct a wrong assignment on the event detail page — the automatic pass
// never touches a log that already carries an `eventId`.

const logStore = require("./logStore");
const discord = require("./discord");
const { autoMatches } = require("./logEventMatch");
const { loadMatchableEvents, eventLinkFields } = require("./matchableEvents");

/**
 * Assign every still-unlinked log of one guild to its unambiguous event.
 * Best-effort: a Raid-Helper failure is reported, never thrown, so neither the
 * message listener nor the background timer can be taken down by it.
 * @returns {Promise<{ linked: number, remaining: number, error: string|null }>}
 *   `remaining` counts the logs left without an event (nothing in the window, or
 *   two equally plausible raids — those stay for an admin to decide).
 */
async function autoLinkLogs(guildId) {
    if (!guildId) return { linked: 0, remaining: 0, error: null };
    const logs = logStore.listLogs().filter((l) => (!l.guildId || l.guildId === guildId) && !l.eventId);
    if (!logs.length) return { linked: 0, remaining: 0, error: null };

    // A reported error is not fatal here: loadMatchableEvents falls back to the
    // locally persisted event snapshot, which carries everything a time match
    // needs. Only an empty list means there is genuinely nothing to match against.
    const { events, error } = await loadMatchableEvents(guildId);
    if (!events.length) return { linked: 0, remaining: logs.length, error };

    const matches = autoMatches(logs, events);
    for (const m of matches) logStore.linkEvent(m.log.id, eventLinkFields(m.event, "auto"));
    return { linked: matches.length, remaining: logs.length - matches.length, error: null };
}

/** Run the assignment for every guild the bot is currently in. Best-effort per guild. */
async function autoLinkAllGuilds() {
    let linked = 0;
    for (const g of discord.listGuilds()) {
        const result = await autoLinkLogs(g.id);
        if (result.error) console.error(`[logAutoLink] ${g.name || g.id}: ${result.error}`);
        linked += result.linked;
    }
    return linked;
}

let timer = null;

/**
 * Start the periodic assignment sweep (idempotent). Runs once on boot, then on
 * an interval, so a log whose event could not be resolved at detection time
 * (Raid-Helper hiccup) still ends up assigned without anyone clicking anything.
 * The timer is unref'd so it never keeps the process alive on its own.
 */
function startLogAutoLink({ intervalMs = 10 * 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => autoLinkAllGuilds().catch((e) => console.error("[logAutoLink]", e.message));
    run();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Test-only: forget the running timer so a suite can start a fresh one. */
function _resetTimerForTests() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { autoLinkLogs, autoLinkAllGuilds, startLogAutoLink, _resetTimerForTests };
