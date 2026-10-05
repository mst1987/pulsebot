// The data behind the raider organizer (utils/signup/organizerPanel.js): the
// next raid of a category and the newest evaluation a raider is in.
//
// "Next raid" reads the own events only — the ones absences and attendances
// act on, and a store read rather than a Raid-Helper request every time the
// panels are redrawn. A category still on Raid-Helper shows "no raid planned".
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { listReports, getReportRoster } = require("../../stores/reportStore");
const { accountCount } = require("../../utils/signup/capacity");

/** How many of the newest evaluations "Evaluation" looks through. */
const MAX_REPORTS = 40;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The category's next own raid (not cancelled, not begun), or null. */
function nextRaid(categoryId, { now = Date.now() } = {}) {
    const cat = str(categoryId);
    if (!cat) return null;
    const nowSec = Math.floor(now / 1000);
    return eventStore.listEvents("", { sinceSeconds: nowSec })
        .filter((e) => e && str(e.categoryId) === cat && e.status !== "cancelled" && Number(e.startTime) > nowSec)
        .sort((a, b) => Number(a.startTime) - Number(b.startTime))[0] || null;
}

/** What the panel shows of the next raid: `{ startTime, attending }` or null. */
function nextRaidSummary(categoryId, opts = {}) {
    const event = nextRaid(categoryId, opts);
    if (!event) return null;
    return { startTime: Number(event.startTime), attending: accountCount(signupStore.listSignups(event.id)) };
}

/** A raider's signup to an event, or null. */
function signupOf(eventId, userId) {
    return signupStore.getSignup(eventId, userId);
}

/**
 * The newest evaluation one of a raider's profile characters is in:
 * `{ id, title, generatedAt, character, idx }` (`idx` = their place in the
 * roster, the player page's index), or null. Matched by name alone: a
 * profile key carries the game version ("forever~devi res", #543), a log's
 * roster only the name.
 */
function latestReportFor(userId, { maxReports = MAX_REPORTS } = {}) {
    const profile = profiles.getProfile(str(userId));
    const names = new Set(((profile && profile.characters) || []).map((c) => profiles.nameKey(c.key)).filter(Boolean));
    if (!names.size) return null;
    for (const meta of listReports().slice(0, maxReports)) {
        const report = getReportRoster(meta.id);
        const roster = (report && report.roster) || [];
        const idx = roster.findIndex((p) => p && names.has(profiles.nameKey(p.name)));
        if (idx >= 0) {
            return { id: meta.id, title: meta.title || report.title || "", generatedAt: Number(meta.generatedAt || report.generatedAt) || 0, character: roster[idx].name, idx };
        }
    }
    return null;
}

module.exports = { nextRaid, nextRaidSummary, signupOf, latestReportFor, MAX_REPORTS };
