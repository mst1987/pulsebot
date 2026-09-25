// Where the raid plan gets an event and its players from (docs/raidplan.md, "Raid-Helper-Events").
//
//   - An own event: its record (eventStore) and its setup, exactly as before - raidplan.js reads both itself.
//   - A Raid-Helper event whose plan the orga switched on (raidplanStore `link`): the plan record says what the event itself does not
//     (instances, size, version, composition - taken from the title at switch-on, corrected there), the players come from Raid-Helper:
//     its Aufstellung (getSetup, with the group numbers) or else its signups (getEvent), through raidhelperRoster.js. READ ONLY - nothing
//     here ever writes to Raid-Helper.
//
// Raid-Helper is asked at most once a minute per event (CACHE_MS); the client itself gives up after 20 s. When it does not answer, the
// line-up falls back, most recent first: the last answer of this process, the snapshot raidEventScan.js keeps of a past raid, the line-up
// the plan remembered at its last save ("gespeicherter Stand"). Only a fresh answer is `authoritative`: only then may a save drop a
// raider Raid-Helper no longer lists - every fallback keeps every player the plan names (raidplanBoard ANY_PLAYER), so an outage never
// costs the plan its players.
const { createRaidhelperClient, raidhelperDisabled } = require("../utils/raidhelperClient");
const { getEvent, isOwnEventId } = require("./eventStore");
const { getRaidEvent } = require("./raidEventStore");
const raiderProfiles = require("./raiderProfileStore");
const store = require("./raidplanStore");
const { raidhelperLineup } = require("./raidhelperRoster");
const raidplan = require("./raidplan");

const CACHE_MS = 60_000;
const cache = new Map(); // eventId -> { at, raw: { setupSlots, signUps } }
const lastGood = new Map(); // eventId -> { at, raw }

/** Test-only: forget every cached answer. */
function _resetForTests() {
    cache.clear();
    lastGood.clear();
}

/** Raid-Helper's current answer for an event: `{ setupSlots, signUps }`; throws when it does not answer or does not know the event. */
async function fetchRaw(eventId) {
    const rh = createRaidhelperClient();
    if (rh.disabled) {
        const e = new Error("Raid-Helper ist abgeschaltet.");
        e.code = "raidhelper_disabled";
        throw e;
    }
    // getSetup resolves `undefined` for "no Aufstellung" and for a network error alike; getEvent tells whether Raid-Helper answers at all
    const [ev, setup] = await Promise.all([rh.getEvent(eventId), rh.getSetup(eventId).catch(() => undefined)]);
    if (!ev || typeof ev !== "object" || !ev.id) throw new Error("Raid-Helper kennt das Event nicht (mehr).");
    return {
        setupSlots: setup && Array.isArray(setup.setup) ? setup.setup : [],
        signUps: Array.isArray(ev.signUps) ? ev.signUps : [],
    };
}

/** The raw answer, cached for a minute; `{ raw, at, origin: "live" | "cache" | "last", error }` - raw null when there is none. */
async function rawFor(eventId, { fresh = false, now = Date.now() } = {}) {
    const hit = cache.get(eventId);
    if (!fresh && hit && now - hit.at < CACHE_MS) return { raw: hit.raw, at: hit.at, origin: "cache" };
    try {
        const raw = await fetchRaw(eventId);
        const entry = { at: now, raw };
        cache.set(eventId, entry);
        lastGood.set(eventId, entry);
        return { raw, at: now, origin: "live" };
    } catch (e) {
        cache.delete(eventId);
        const good = lastGood.get(eventId);
        const error = (e && e.message) || "Raid-Helper nicht erreichbar.";
        if (good) return { raw: good.raw, at: good.at, origin: "last", error };
        return { raw: null, at: 0, origin: "none", error, disabled: !!(e && e.code === "raidhelper_disabled") };
    }
}

/** The line-up the plan remembered, as setup slots (all in their last group). */
function savedLineup(known) {
    const groups = new Map();
    for (const [userId, k] of Object.entries(known || {})) {
        const g = Number(k.group) || 1;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({ userId, character: k.character, spec: k.spec, classId: k.spec ? k.spec.split("-")[0] : "", role: "", rhName: k.rhName });
    }
    return { groups: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([index, slots]) => ({ index, slots })), bench: [] };
}

/**
 * The event and players of a Raid-Helper plan: `{ event, info }`. `event` is what raidplan.js reads (id, title, startTime, instanceIds,
 * versionId, size, composition, guildId) plus `roster` (the players, the ones Raid-Helper no longer lists marked `gone`) and
 * `rosterSource` (= `info`, what the editor header says: origin, when, stale, available, hasGroups, unknown, unmatchedNames, disabled).
 */
async function raidhelperPlanEvent(plan, { fresh = false, now = Date.now() } = {}) {
    const link = plan.link;
    const eventId = plan.eventId;
    const profileOf = (uid) => raiderProfiles.getProfile(uid);
    const got = await rawFor(eventId, { fresh, now });
    let lineup = null;
    let origin = got.origin;
    let at = got.at;
    if (got.raw) lineup = raidhelperLineup({ ...got.raw, profileOf });
    // Raid-Helper answered but lists nobody (yet) - or did not answer: a past raid's snapshot, else the remembered line-up
    if (!lineup || lineup.source === "none") {
        const snap = getRaidEvent(eventId);
        const snapSlots = (snap && Array.isArray(snap.setup) && snap.setup) || [];
        if (snapSlots.length && (!got.raw || !got.raw.signUps.length)) {
            lineup = raidhelperLineup({ setupSlots: snapSlots, profileOf });
            origin = "snapshot";
            at = Number(snap.updatedAt) || 0;
        } else if (!got.raw && Object.keys(plan.known || {}).length) {
            lineup = { ...savedLineup(plan.known), source: "saved", hasGroups: true, unknown: [], unmatchedNames: 0 };
            origin = "saved";
            at = plan.updatedAt || 0;
        }
    }
    const loaded = lineup ? raidplan.rosterFrom(lineup, link.versionId) : [];
    // the raiders the plan names that the line-up no longer has: kept, under the name the plan remembered, and marked
    const inRoster = new Set(loaded.map((p) => p.userId));
    const goneSlots = [...store.playersOf(plan.bosses)].filter((uid) => !inRoster.has(uid)).map((uid) => {
        const k = (plan.known || {})[uid] || {};
        return { userId: uid, character: k.character || "", spec: k.spec || "", classId: k.spec ? k.spec.split("-")[0] : "", role: "", rhName: k.rhName || "", gone: true };
    });
    const gone = raidplan.rosterFrom({ groups: [], bench: goneSlots }, link.versionId).map((p) => ({ ...p, gone: true }));
    // an empty answer is no line-up: a save then must not drop anybody either
    const authoritative = (origin === "live" || origin === "cache") && loaded.length > 0;
    const info = {
        kind: "raidhelper",
        origin,
        fetchedAt: at,
        available: loaded.length > 0,
        authoritative,
        stale: !authoritative,
        lineupSource: lineup ? lineup.source : "none",
        hasGroups: !!(lineup && lineup.hasGroups),
        unknown: lineup ? lineup.unknown : [],
        unmatchedNames: lineup ? lineup.unmatchedNames : 0,
        goneCount: gone.length,
        disabled: raidhelperDisabled(),
        error: got.error || "",
    };
    const event = {
        id: eventId,
        source: "raidhelper",
        title: link.title,
        startTime: link.startTime,
        instanceIds: link.instanceIds,
        versionId: link.versionId,
        size: link.size,
        composition: link.composition,
        guildId: link.guildId,
        roster: [...loaded, ...gone],
        rosterSource: info,
    };
    return { event, info, loaded };
}

/**
 * The event of a raid plan: `{ kind: "own", event }` for an own event, `{ kind: "raidhelper", event, info, loaded, plan }` for a
 * Raid-Helper event whose plan is switched on, `{ kind: "off", plan }` for one whose plan is switched off, `null` when there is none.
 */
async function planEventFor(eventId, opts = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    if (isOwnEventId(id)) {
        const event = getEvent(id);
        return event ? { kind: "own", event } : null;
    }
    const plan = store.getPlan(id);
    if (!plan || !plan.link) return null;
    if (!plan.link.enabled) return { kind: "off", plan };
    const r = await raidhelperPlanEvent(plan, opts);
    return { kind: "raidhelper", plan, ...r };
}

/**
 * The players a save / template may name: the loaded line-up when Raid-Helper just answered (a raider it no longer lists drops out),
 * else ANY_PLAYER - an outage, the snapshot or the remembered line-up never cost the plan a player.
 */
function allowedFor(found) {
    if (found.kind !== "raidhelper") return raidplan.editorRoster(found.event).map((p) => p.userId);
    return found.info.authoritative ? found.loaded.map((p) => p.userId) : require("./raidplanBoard").ANY_PLAYER;
}

module.exports = { planEventFor, raidhelperPlanEvent, allowedFor, fetchRaw, rawFor, CACHE_MS, _resetForTests };
