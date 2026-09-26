// Collects what the setup proposal (utils/setup/proposal.js) needs from the
// stores, so the algorithm itself stays free of I/O:
//
//   events      eventStore (size, composition, fairness/wishes flags) plus the
//               required buffs of the category's raid template
//   signups     signupStore — read through listSignups(), so every signup
//               carries its `characters` in priority order, each with its own
//               status (#320): the proposal weighs the status of the character
//               it would place, not the signup's
//   profiles    raiderProfileStore — gear per spec, can offtank/heal, wishes
//   attendance  rosterAttendance, per raider in the event's category
//   history     earlier nights of the same categories: from *approved* setups
//               (`event.setup.status === "approved"`) — the bench is never
//               stored separately. As long as no setup was approved yet, the
//               stored signups stand in (signed/late = placed, "Ersatzbank" = bench).
//   fixed       the places the orga locked in the event's current setup draft
//
// Only own events (`source: "eventhelper"`) have a setup; Raid-Helper events
// keep theirs at Raid-Helper.

const eventStore = require("../stores/eventStore");
const signupStore = require("../stores/signupStore");
const profileStore = require("../stores/raiderProfileStore");
const settingsStore = require("../stores/settingsStore");
const { buildAttendanceContext, attendanceFor } = require("./rosterAttendance");
const { listStoredEvents } = require("./eventSources");
const { buildSetupProposal } = require("../utils/setup/proposal");

// How many earlier nights per category go into the fairness history.
const HISTORY_NIGHTS = 10;

/** The user ids a stored setup placed and benched, across its events. */
function setupMembers(setup) {
    const placed = new Set();
    const bench = new Set();
    const groupsOf = (s) => (Array.isArray(s && s.groups) ? s.groups : []);
    const all = [setup, ...(Array.isArray(setup.events) ? setup.events : [])];
    for (const part of all) {
        for (const g of groupsOf(part)) {
            for (const slot of Array.isArray(g.slots) ? g.slots : []) if (slot && slot.userId) placed.add(String(slot.userId));
        }
    }
    for (const b of Array.isArray(setup.bench) ? setup.bench : []) {
        if (b && b.userId && !placed.has(String(b.userId))) bench.add(String(b.userId));
    }
    return { placed: [...placed], bench: [...bench] };
}

/**
 * The lineup a night actually ran with: the approved snapshot (setupEditor.js),
 * never a draft that was changed after the approval. A setup marked approved
 * without a snapshot counts as itself.
 */
function approvedLineup(setup) {
    if (!setup) return null;
    if (setup.approved && Array.isArray(setup.approved.groups)) return setup.approved;
    return setup.status === "approved" ? setup : null;
}

/** Earlier nights of these categories, newest first, from approved setups — or signups while there are none. */
function benchHistory(events, { guildId, now }) {
    const ids = new Set(events.map((e) => e.id));
    const categories = new Set(events.map((e) => e.categoryId).filter(Boolean));
    const before = Math.min(...events.map((e) => e.startTime || Infinity));
    const inScope = (e) => !ids.has(String(e.id)) && (!categories.size || categories.has(e.categoryId)) && (Number(e.startTime) || 0) < before;

    const approved = eventStore.listEvents(guildId)
        .filter(inScope)
        .map((e) => ({ e, lineup: approvedLineup(e.setup) }))
        .filter((x) => x.lineup)
        .slice(0, HISTORY_NIGHTS)
        .map(({ e, lineup }) => ({ eventId: e.id, startTime: e.startTime, ...setupMembers(lineup) }));
    if (approved.length) return { source: "setups", history: approved };

    const fromSignups = listStoredEvents(guildId, { now })
        .filter(inScope)
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
        .slice(0, HISTORY_NIGHTS)
        .map((e) => {
            const signUps = Array.isArray(e.signUps) ? e.signUps : [];
            const ofStatus = (...st) => [...new Set(signUps.filter((s) => s && s.userId && st.includes(s.status)).map((s) => String(s.userId)))];
            return { eventId: String(e.id), startTime: e.startTime, placed: ofStatus("signed", "late"), bench: ofStatus("bench") };
        })
        .filter((h) => h.placed.length || h.bench.length);
    return { source: fromSignups.length ? "signups" : "none", history: fromSignups };
}

/** The places locked in an event's current draft: `{ userId, eventId, group, spec, role }` or `{ userId, bench }`. */
function fixedFromSetup(event) {
    const setup = event.setup;
    if (!setup) return [];
    const out = [];
    for (const g of Array.isArray(setup.groups) ? setup.groups : []) {
        for (const slot of Array.isArray(g.slots) ? g.slots : []) {
            if (slot && slot.locked && slot.userId) {
                out.push({ userId: String(slot.userId), eventId: event.id, group: Number(g.index) || null, spec: slot.spec || "", role: slot.role || "", character: slot.character || "" });
            }
        }
    }
    for (const b of Array.isArray(setup.bench) ? setup.bench : []) {
        if (b && b.locked && b.userId) out.push({ userId: String(b.userId), bench: true });
    }
    return out;
}

/**
 * The required buffs of an event: its own list once it was planned from a raid
 * template or has one (#261 — changed per event, possibly to none), else those
 * of the category's raid template, [] without one.
 */
function requiredBuffsFor(event, config) {
    if (event.raidTemplateId || (Array.isArray(event.requiredBuffs) && event.requiredBuffs.length)) return event.requiredBuffs || [];
    const templateId = (config.categoryRaidTemplate || {})[event.categoryId];
    const template = templateId ? settingsStore.getRaidTemplate(templateId) : null;
    return template && Array.isArray(template.requiredBuffs) ? template.requiredBuffs : [];
}

/**
 * The event's composition in the proposal's shape: melee/ranged become
 * `{ min, max }` where the event stores a maximum (`compositionMax`, #261), a
 * plain minimum otherwise.
 */
function compositionLimits(event) {
    const comp = { ...(event.composition || {}) };
    const max = event.compositionMax || {};
    for (const role of ["melee", "ranged"]) {
        if (max[role] !== null && max[role] !== undefined) comp[role] = { min: Number(comp[role]) || 0, max: max[role] };
    }
    return comp;
}

/**
 * Everything buildSetupProposal() needs for these own events (several = they
 * run in parallel and share the raiders). Unknown ids are skipped; `null` when
 * none is left.
 */
function collectSetupInput(eventIds, { now = Date.now() } = {}) {
    const events = [...new Set((Array.isArray(eventIds) ? eventIds : [eventIds]).map(String))]
        .map((id) => eventStore.getEvent(id))
        .filter(Boolean);
    if (!events.length) return null;
    const guildId = events[0].guildId;
    const config = settingsStore.getConfig();

    const signups = events.flatMap((e) => signupStore.listSignups(e.id).map((s) => ({ ...s, eventId: e.id })));
    const userIds = new Set(signups.map((s) => String(s.userId)));
    const profiles = profileStore.listProfiles().filter((p) => userIds.has(p.userId));

    const attendance = {};
    const ctx = buildAttendanceContext(guildId, { now });
    for (const s of signups) {
        if (attendance[s.userId] !== undefined || s.status === "absence") continue;
        const event = events.find((e) => e.id === s.eventId);
        const character = s.character || ((profiles.find((p) => p.userId === s.userId) || { characters: [] }).characters.find((c) => c.main) || {}).name || "";
        if (!event.categoryId || !character) continue;
        attendance[s.userId] = attendanceFor(ctx, event.categoryId, character, [s.userId]).pct;
    }

    const { history, source: historySource } = benchHistory(events, { guildId, now });
    return {
        versionId: events[0].versionId,
        events: events.map((e) => ({
            id: e.id,
            title: e.title,
            size: e.size,
            composition: compositionLimits(e),
            requiredBuffs: requiredBuffsFor(e, config),
            fairness: e.fairness,
            wishes: e.wishes,
        })),
        signups,
        profiles,
        attendance,
        history,
        historySource,
        fixed: events.flatMap(fixedFromSetup),
    };
}

/** Collect and propose in one go — for the setup editor (#263). `null` for unknown events. */
function proposeSetup(eventIds, options = {}) {
    const input = collectSetupInput(eventIds, options);
    if (!input) return null;
    return { ...buildSetupProposal(input, options), historySource: input.historySource };
}

module.exports = { collectSetupInput, proposeSetup, benchHistory, fixedFromSetup, setupMembers, approvedLineup, HISTORY_NIGHTS };
