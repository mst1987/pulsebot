// The end of a trial (#658): members with status "trial" whose `trialUntil`
// lies within the next TRIAL_HINT_DAYS days or has passed. The roster overview
// lists them per roster (`trialEnding`), the dashboard turns them into a calm
// task for the managers with "Übernehmen" (status core) and "Verlängern"
// (trialUntil + TRIAL_EXTEND_DAYS) — both through POST /api/rosters/members.
//
// Nothing here changes a member by itself: a trial that ran out stays a trial
// until a person decides.
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_HINT_DAYS = 7;
const TRIAL_EXTEND_DAYS = 14;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const msOf = (iso) => {
    const t = new Date(str(iso)).getTime();
    return Number.isFinite(t) ? t : NaN;
};

/**
 * The trial members of a roster whose trial ends within `days` or is overdue,
 * the earliest first: `[{ userId, displayName, trialUntil, overdue }]`.
 * @param {object} roster  a rosterStore roster
 * @param {{ now?: number, days?: number, nameOf?: (userId: string) => string }} [opts]
 */
function trialEnding(roster, { now = Date.now(), days = TRIAL_HINT_DAYS, nameOf = (id) => id } = {}) {
    const limit = now + days * DAY_MS;
    const out = [];
    for (const [userId, member] of Object.entries((roster && roster.members) || {})) {
        if (member.status !== "trial" || !member.trialUntil) continue;
        const until = msOf(member.trialUntil);
        if (!Number.isFinite(until) || until > limit) continue;
        out.push({ userId, displayName: str(nameOf(userId)) || userId, trialUntil: member.trialUntil, overdue: until < now });
    }
    return out.sort((a, b) => msOf(a.trialUntil) - msOf(b.trialUntil) || a.displayName.localeCompare(b.displayName));
}

/**
 * The new end of an extended trial: TRIAL_EXTEND_DAYS after the old end, or
 * after today when the old end has already passed (an ISO string).
 * @param {string|null} trialUntil
 * @param {{ now?: number, days?: number }} [opts]
 */
function extendedTrialUntil(trialUntil, { now = Date.now(), days = TRIAL_EXTEND_DAYS } = {}) {
    const until = msOf(trialUntil);
    const from = Number.isFinite(until) && until > now ? until : now;
    return new Date(from + days * DAY_MS).toISOString();
}

module.exports = { trialEnding, extendedTrialUntil, TRIAL_HINT_DAYS, TRIAL_EXTEND_DAYS };
