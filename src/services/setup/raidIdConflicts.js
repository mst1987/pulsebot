// One instance per raid ID: a character that stands in a group of another raid
// of the same instance in the same raid ID (lockout week) is saved there — the
// setup editor marks it and the proposal leaves it in the pool. A hint only:
// the orga can still drag it in.
//
// What counts: a slot in a group (not the bench, not the pool) of another event
// whose instanceIds overlap and whose start falls in the same raid ID — past or
// upcoming, any server of the Verbund, the other raids of a raid group too.
// Cancelled events do not count, deleted ones are gone from the store.
//
// Per character (characterKeyOf), never per person. A raid of another server
// only says "another raid of this ID" — no title, no id, no person (Daten je
// Server): the payload never carries a foreign event's id or name.
//
// Cheap: listEvents filters the cached index by start time and clones only the
// events of that one week.
const eventStore = require("../../stores/events/eventStore");
const { raidIdOf, DAY_MS } = require("../../utils/time/raidId");
const { characterKeyOf } = require("../../utils/loot/lootImport");
const { inRaidGroup, raidIndexOf } = require("../../utils/raidGroup");

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

function instancesOf(event) {
    return new Set((Array.isArray(event && event.instanceIds) ? event.instanceIds : []).map(str).filter(Boolean));
}

/** The raid ID of an event (its start in seconds), null without a start. */
function raidIdOfEvent(event) {
    const start = Number(event && event.startTime);
    return Number.isFinite(start) && start > 0 ? raidIdOf(start * 1000) : null;
}

/** The other events of the same instance in the same raid ID (not cancelled, not in `exclude`). */
function sameIdEvents(event, exclude) {
    const instances = instancesOf(event);
    const id = raidIdOfEvent(event);
    if (!instances.size || id === null) return [];
    // a day of margin either side: the week starts Wednesday 05:00 server time, raidIdOf decides exactly
    const sinceSeconds = Math.floor((id - DAY_MS) / 1000);
    const untilSeconds = Math.floor((id + 8 * DAY_MS) / 1000);
    return (eventStore.listEvents("", { sinceSeconds, untilSeconds, siblings: true }) || []).filter((e) =>
        e && !exclude.has(str(e.id))
        && e.status !== "cancelled"
        && raidIdOfEvent(e) === id
        && [...instancesOf(e)].some((i) => instances.has(i)));
}

/** The character keys standing in a group of a stored setup (the bench and the pool do not count). */
function placedKeys(setup) {
    const keys = new Set();
    for (const g of (setup && setup.groups) || []) {
        for (const s of (g && g.slots) || []) {
            const key = s && s.character ? characterKeyOf(s.character) : "";
            if (key) keys.add(key);
        }
    }
    return keys;
}

/** What the hint may say about the other raid: details on the same server, nothing elsewhere. */
function entryOf(other, guildId) {
    if (str(other.guildId) !== str(guildId)) return { other: true };
    return {
        local: true,
        title: str(other.title),
        raidNo: inRaidGroup(other) ? raidIndexOf(other) : 0,
        startTime: Number(other.startTime) || 0,
    };
}

/** A local entry beats a foreign one; among locals the earlier raid. */
function better(a, b) {
    if (!a) return b;
    if (a.local !== b.local) return a.local ? a : b;
    return (b.startTime || 0) < (a.startTime || 0) ? b : a;
}

/**
 * The characters already placed in another raid of this event's instance and
 * raid ID: Map<characterKey, { local, title, raidNo, startTime } | { other: true }>.
 * @param {object} event
 * @param {{ excludeIds?: string[] }} [opts] further event ids that do not count (the proposal's own raids)
 */
function takenInRaidId(event, { excludeIds = [] } = {}) {
    const taken = new Map();
    if (!event) return taken;
    const exclude = new Set([str(event.id), ...excludeIds.map(str)]);
    for (const other of sameIdEvents(event, exclude)) {
        const keys = placedKeys(other.setup);
        if (!keys.size) continue;
        const entry = entryOf(other, event.guildId);
        for (const key of keys) taken.set(key, better(taken.get(key), entry));
    }
    return taken;
}

/** The editor's lineup with `raidIdTaken` on every person and character choice that is saved elsewhere. */
function markLineup(lineup, taken) {
    if (!lineup || !taken || !taken.size) return lineup;
    const hintOf = (name) => (name ? taken.get(characterKeyOf(name)) : undefined);
    const mark = (p) => {
        if (!p) return p;
        const own = hintOf(p.character);
        const characters = Array.isArray(p.characters)
            ? p.characters.map((c) => {
                const hint = hintOf(c.character);
                return hint ? { ...c, raidIdTaken: hint } : c;
            })
            : p.characters;
        if (!own && characters === p.characters) return p;
        return { ...p, ...(own ? { raidIdTaken: own } : {}), ...(characters ? { characters } : {}) };
    };
    return {
        ...lineup,
        groups: (lineup.groups || []).map((g) => ({ ...g, slots: (g.slots || []).map(mark) })),
        bench: (lineup.bench || []).map(mark),
        pool: (lineup.pool || []).map(mark),
    };
}

/**
 * For the proposal over `events` (one raid or the raids of a group): per event
 * id the character keys it must leave out. The events planned together do not
 * count against each other — the proposal splits them itself.
 * @returns {Record<string, string[]>}
 */
function takenKeysFor(events) {
    const list = (events || []).filter(Boolean);
    const ids = list.map((e) => str(e.id));
    const out = {};
    for (const event of list) {
        const keys = [...takenInRaidId(event, { excludeIds: ids }).keys()];
        if (keys.length) out[str(event.id)] = keys;
    }
    return out;
}

module.exports = { takenInRaidId, markLineup, takenKeysFor };
