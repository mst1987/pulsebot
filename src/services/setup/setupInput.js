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
//   attendance  rosterAttendance, per raider in the event's category - within the event's version (#740)
//   history     earlier nights of the same categories: from *approved* setups
//               (`event.setup.status === "approved"`) — the bench is never
//               stored separately. As long as no setup was approved yet, the
//               stored signups stand in (signed/late = placed, "Ersatzbank" = bench).
//   fixed       the places the orga locked in the event's current setup draft
//   rosterStatus  the roster of the event's category and version (#658, #739): `{ userId: status }`
//               of its members — core before trial before bench in the proposal;
//               empty for a category without roster
//   leaders     per event the signed-up user ids whose leader flags (#1034) cover the raid's
//               version and instances, plus the orga's choice `setup.leaderUserId` (#1036)
//   shadowbanned  user ids with an active shadowban on the raid's server (Vermerke, #981) -
//               only when the caller hands in `shadowbannedOf`; the proposal keeps them in the pool
//
// Only own events (`source: "eventhelper"`) have a setup; Raid-Helper events
// keep theirs at Raid-Helper.

const eventStore = require("../../stores/events/eventStore");
const signupStore = require("../../stores/events/signupStore");
const profileStore = require("../../stores/roster/raiderProfileStore");
const settingsStore = require("../../stores/settings/settingsStore");
const rosterStore = require("../../stores/roster/rosterStore");
const { buildAttendanceContext, attendanceFor } = require("../characters/rosterAttendance");
const { listStoredEvents } = require("../events/eventSources");
const { versionOfEvent } = require("../versions/mainVersion");
const { buildSetupProposal } = require("../../utils/setup/proposal");
const { benchAndPool } = require("./setupCore");
const { signupEventIdOf } = require("../../utils/raidGroup");
const leaderFlagsStore = require("../../stores/roster/leaderFlagsStore");
const { canLead, instanceChoices } = require("../roster/leaderFlags");

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

    // the further raids of a group (#811) ran that night too, each with its own approved setup
    const approved = eventStore.listEvents(guildId, { siblings: true })
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

/**
 * The places locked in an event's current draft: `{ userId, eventId, group, spec, role }` or `{ userId, bench }`.
 * `keepPlaced` ("Freie Plätze füllen"): every raider in a group stays where they stand, locked or not.
 */
function fixedFromSetup(event, { keepPlaced = false } = {}) {
    const setup = event.setup;
    if (!setup) return [];
    const out = [];
    for (const g of Array.isArray(setup.groups) ? setup.groups : []) {
        for (const slot of Array.isArray(g.slots) ? g.slots : []) {
            // the orga's leader (#1036) keeps its place like a locked one
            const leads = !!setup.leaderUserId && slot && String(slot.userId) === String(setup.leaderUserId);
            if (slot && (slot.locked || keepPlaced || leads) && slot.userId) {
                out.push({ userId: String(slot.userId), eventId: event.id, group: Number(g.index) || null, spec: slot.spec || "", role: slot.role || "", character: slot.character || "" });
            }
        }
    }
    // #517: the whole explicit bench stays on the bench — a new proposal never undoes the orga's choice
    for (const b of benchAndPool(setup).bench) {
        if (b.userId) out.push({ userId: String(b.userId), bench: true, locked: !!b.locked, ...(b.character ? { character: String(b.character) } : {}) });
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
/**
 * The leader rule of a raid (#1036): who of `userIds` may lead it (flags covering its version
 * and instances), the instances' short names for the reason text, and the orga's choice.
 */
function leaderFacts(event, userIds, allLeads, config) {
    const versionId = versionOfEvent(event, { config });
    const instanceIds = Array.isArray(event.instanceIds) ? event.instanceIds.map(String) : [];
    const shorts = instanceChoices(versionId).filter((i) => instanceIds.includes(i.id)).map((i) => i.short);
    return {
        leaders: [...userIds].filter((u) => canLead(allLeads[u], versionId, instanceIds)),
        instanceShort: shorts.join("/"),
        leaderUserId: (event.setup && event.setup.leaderUserId) ? String(event.setup.leaderUserId) : "",
    };
}

function collectSetupInput(eventIds, { now = Date.now(), keepPlaced = false, shadowbannedOf = null } = {}) {
    const events = [...new Set((Array.isArray(eventIds) ? eventIds : [eventIds]).map(String))]
        .map((id) => eventStore.getEvent(id))
        .filter(Boolean);
    if (!events.length) return null;
    const guildId = events[0].guildId;
    const config = settingsStore.getConfig();

    // A raid group (#811): every raid takes the signups of the group's first raid — the raiders
    // signed up there once — so each of them can be placed in any raid, and the proposal's hard
    // rule "each raider at most once across all events" keeps it to one seat.
    const signups = events.flatMap((e) => signupStore.listSignups(signupEventIdOf(e)).map((s) => ({ ...s, eventId: e.id })));
    const userIds = new Set(signups.map((s) => String(s.userId)));
    const profiles = profileStore.listProfiles().filter((p) => userIds.has(p.userId));

    const attendance = {};
    // within the version of the raid being set up (#740)
    const ctx = buildAttendanceContext(guildId, { now, versionId: versionOfEvent(events[0]) });
    const eventById = new Map(events.map((e) => [e.id, e]));
    const profileById = new Map(profiles.map((p) => [p.userId, p]));
    for (const s of signups) {
        if (attendance[s.userId] !== undefined || s.status === "absence") continue;
        const event = eventById.get(s.eventId);
        // a signup without a name: the raider's first character of the event's version (their own order)
        const character = s.character || (profileStore.firstCharacter(profileById.get(String(s.userId)), event.versionId || "") || {}).name || "";
        if (!event.categoryId || !character) continue;
        attendance[s.userId] = attendanceFor(ctx, event.categoryId, character, [s.userId]).pct;
    }

    const { history, source: historySource } = benchHistory(events, { guildId, now });
    const rosterStatus = rosterStatusFor(events);
    const allLeads = leaderFlagsStore.allLeads();
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
            ...leaderFacts(e, userIds, allLeads, config),
        })),
        signups,
        profiles,
        attendance,
        history,
        historySource,
        fixed: events.flatMap((e) => fixedFromSetup(e, { keepPlaced })),
        rosterStatus,
        // Vermerke (#981): who has an active shadowban on the raid's server - a raid group's raids
        // all live on the first raid's server. Handed in by the orga's caller (`shadowbannedOf`,
        // services/vermerke/vermerkeShort.shadowbannedAmong): this module is loaded by pages a
        // raider reads, which must never load the Vermerke (vermerkeNeverToPerson.test.js).
        shadowbanned: typeof shadowbannedOf === "function" ? (shadowbannedOf(guildId, [...userIds], { now }) || []).map(String) : [],
    };
}

/**
 * The roster status of every member of the events' categories' rosters (#658):
 * `{ userId: "core" | "trial" | "bench" | "pause" }`, the first event's roster
 * first; empty when no category has a roster.
 */
function rosterStatusFor(events) {
    const out = {};
    for (const e of events) {
        // the roster of the event's version (#739)
        const roster = e.categoryId ? rosterStore.rosterForCategory(String(e.categoryId), versionOfEvent(e)) : null;
        if (!roster) continue;
        for (const [userId, member] of Object.entries(roster.members)) {
            if (out[userId] === undefined) out[userId] = member.status;
        }
    }
    return out;
}

/** Collect and propose in one go — for the setup editor (#263). `null` for unknown events. */
function proposeSetup(eventIds, options = {}) {
    const input = collectSetupInput(eventIds, options);
    if (!input) return null;
    return { ...buildSetupProposal(input, options), historySource: input.historySource };
}

module.exports = { collectSetupInput, proposeSetup, benchHistory, fixedFromSetup, setupMembers, approvedLineup, rosterStatusFor, HISTORY_NIGHTS };
