// The one answer to "may this server use this feature?" (docs/server-plans.md).
//
// A server without an entry, with a plan that no longer exists or whose `until` has
// passed is on the default plan. That is fail-open on purpose: `free` unlocks every
// feature today, so nothing a store mishap does can take a function away from a
// server, and the default only starts to refuse once `free` lists its features.
// hasFeature() always asks the plan, so that needs no change here.
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const plans = require("../../config/plans");
const store = require("../../stores/settings/serverPlanStore");

const MAX_NOTE = 200;
const DATE_FORMAT = "yyyy-MM-dd";

const dayOf = (until) => DateTime.fromFormat(until, DATE_FORMAT, { zone: TIMEZONE });
const knownPlan = (id) => (Object.hasOwn(plans.PLANS, id) ? plans.PLANS[id] : null);

/**
 * Whether a date has passed: it holds through its whole day, server time. No date never
 * expires; a date nobody can read counts as passed, so it never extends a plan.
 */
function isExpired(until, now = Date.now()) {
    if (!until) return false;
    const day = dayOf(until);
    return !day.isValid || day.endOf("day").toMillis() < now;
}

/** The plan a server is on right now (see the head comment). */
function serverPlan(guildId, now = Date.now()) {
    const entry = store.getEntry(String(guildId || ""));
    const plan = entry && !isExpired(entry.until, now) ? knownPlan(entry.plan) : null;
    return plan || plans.PLANS[plans.DEFAULT_PLAN];
}

/** Whether a server may use a feature. The helper a job asks too. */
function hasFeature(guildId, feature, now = Date.now()) {
    return plans.planAllows(serverPlan(guildId, now), feature);
}

/** The features unlocked for a server, for the client's menu. */
function serverFeatures(guildId, now = Date.now()) {
    return plans.planFeatureList(serverPlan(guildId, now));
}

/**
 * Checks and saves the entry of a server. An entry that says nothing beyond the default
 * plan is removed instead, so the file only holds what somebody decided.
 * @returns {{ code?: string }} `code` is the refusal: unknown_plan, bad_until or note_too_long
 */
function setServerPlan(guildId, input) {
    const plan = String((input && input.plan) || "");
    const until = String((input && input.until) || "").trim();
    const note = String((input && input.note) || "").trim();
    if (!knownPlan(plan)) return { code: "unknown_plan" };
    if (until && !dayOf(until).isValid) return { code: "bad_until" };
    if (note.length > MAX_NOTE) return { code: "note_too_long" };
    const plain = plan === plans.DEFAULT_PLAN && !until && !note;
    store.setEntry(String(guildId), plain ? null : { plan, until, note });
    return {};
}

/** The table of the full admins: each server's entry as it is saved, with `expired` beside it. */
function planRows(guilds, now = Date.now()) {
    const saved = store.readAll();
    const rowOf = (guildId, name) => {
        const entry = Object.hasOwn(saved, guildId) ? saved[guildId] : { plan: plans.DEFAULT_PLAN, until: "", note: "" };
        return {
            guildId,
            name,
            plan: knownPlan(entry.plan) ? entry.plan : plans.DEFAULT_PLAN,
            until: entry.until,
            note: entry.note,
            expired: isExpired(entry.until, now),
        };
    };
    const known = new Set(guilds.map((g) => g.id));
    // the bot left a server: its entry stays visible, so it can be cleared
    const gone = Object.keys(saved).filter((id) => !known.has(id));
    return [...guilds.map((g) => rowOf(g.id, g.name)), ...gone.map((id) => rowOf(id, ""))];
}

module.exports = { MAX_NOTE, isExpired, serverPlan, hasFeature, serverFeatures, setServerPlan, planRows };
