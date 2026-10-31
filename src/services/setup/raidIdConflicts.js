// One instance per raid ID: a character that stands in a group of another raid
// of the same instance in the same raid ID (lockout week) is saved there — the
// setup editor marks it and the proposal leaves it in the pool. A hint only:
// the orga can still drag it in.
//
// What counts: a slot in a group (not the bench, not the pool) of another event
// whose instanceIds overlap and whose start falls in the same raid ID — past or
// upcoming, any server of the Verbund, the other raids of a raid group too.
// Cancelled events do not count, deleted ones are gone from the store.
// Only weekly instances: one whose lockout resets on another rhythm (Classic
// Era ZG/AQ20 3 days, Onyxia 5, TBC's Zul'Aman 3 - gameVersions.resetDaysOf)
// has no raid ID to check, so it neither gets a hint nor counts for one.
// Another server counts only when it plays on the same realm: region and realm
// of the raid's version (settingsForVersion with that server's overrides) must
// match - a guild on another realm has its own lockouts.
//
// Logs and loot count too, without any setup entry (raidIdHistory.js): a
// character in a report or with loot of the instance this raid ID is saved
// there ("laut Log" / "laut Loot"). A setup entry wins over them. Their names are
// what the game wrote - a Forever character often only by its first name
// ("Devi" for "Devi Res"): such a name counts only when exactly one character of
// the raid's signups has that first name, never on a guess.
//
// Per character (characterKeyOf), never per person. A raid of another server
// only says "another raid of this ID" — no title, no id, no person (Daten je
// Server): the payload never carries a foreign event's id or name.
//
// Cheap: listEvents filters the frozen cached index by start time, instance,
// status and raid ID before it clones - only the matching raids of that week
// are copied. takenKeysFor asks once per raid ID, not once per raid.
const eventStore = require("../../stores/events/eventStore");
const { raidIdOf, DAY_MS } = require("../../utils/time/raidId");
const { characterKeyOf } = require("../../utils/loot/lootImport");
const { inRaidGroup, raidIndexOf } = require("../../utils/raidGroup");
const profileStore = require("../../stores/roster/raiderProfileStore");
const { versionOfEvent } = require("../versions/mainVersion");
const { settingsForVersion } = require("../versions/versionSettings");
const { resetDaysOf, instanceById } = require("../../config/gameVersions");
const signupStore = require("../../stores/events/signupStore");
const { signupEventIdOf } = require("../../utils/raidGroup");
const { historyOfRaidId } = require("./raidIdHistory");

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** The event's weekly instances - the ones a raid ID locks (resetDaysOf 7). */
function instancesOf(event) {
    return new Set((Array.isArray(event && event.instanceIds) ? event.instanceIds : []).map(str).filter((i) => i && resetDaysOf(i) === 7));
}

/** The raid ID of an event (its start in seconds), null without a start. */
function raidIdOfEvent(event) {
    const start = Number(event && event.startTime);
    return Number.isFinite(start) && start > 0 ? raidIdOf(start * 1000) : null;
}

const overlaps = (a, b) => [...a].some((i) => b.has(i));

/**
 * The events of raid ID `id` with a group setup and an instance in `instances`
 * (not cancelled, not in `exclude`) - filtered on the stored record, so only
 * these are cloned.
 */
function weekEvents(id, instances, exclude) {
    if (!instances.size || id === null) return [];
    // a day of margin either side: the week starts Wednesday 05:00 server time, raidIdOf decides exactly
    const sinceSeconds = Math.floor((id - DAY_MS) / 1000);
    const untilSeconds = Math.floor((id + 8 * DAY_MS) / 1000);
    const where = (raw) => !exclude.has(str(raw.id))
        && raw.status !== "cancelled"
        && !!(raw.setup && Array.isArray(raw.setup.groups) && raw.setup.groups.length)
        && overlaps(instancesOf(raw), instances)
        && raidIdOfEvent(raw) === id;
    // (checked again on the copies: a store without `where` must not hand the raid itself back)
    return (eventStore.listEvents("", { sinceSeconds, untilSeconds, siblings: true, where }) || []).filter((e) => e && where(e));
}

/**
 * The character keys standing in a group of the event's stored setup (the bench
 * and the pool do not count). A slot without a character name plays the
 * raider's first character of the event's version - as setupInput reads such a signup.
 */
function placedKeys(event) {
    const keys = new Set();
    let versionId = null;
    for (const g of (event.setup && event.setup.groups) || []) {
        for (const s of (g && g.slots) || []) {
            if (!s) continue;
            let name = str(s.character);
            if (!name && str(s.userId)) {
                if (versionId === null) versionId = versionOfEvent(event) || "";
                name = (profileStore.firstCharacter(profileStore.getProfile(s.userId), versionId) || {}).name || "";
            }
            const key = name ? characterKeyOf(name) : "";
            if (key) keys.add(key);
        }
    }
    return keys;
}

/**
 * What the hint may say about the other raid: details on the same server,
 * nothing elsewhere. A raid without a server is never "the same" - not even
 * against an event without one (Daten je Server).
 */
function entryOf(other, guildId) {
    if (!str(guildId) || str(other.guildId) !== str(guildId)) return { other: true };
    return {
        local: true,
        title: str(other.title),
        raidNo: inRaidGroup(other) ? raidIndexOf(other) : 0,
        startTime: Number(other.startTime) || 0,
    };
}

/** A local entry beats a foreign one; a setup entry one from a log or loot; then the earlier raid. */
function better(a, b) {
    if (!a) return b;
    if (!!a.local !== !!b.local) return a.local ? a : b;
    if (!a.source !== !b.source) return a.source ? b : a;
    return (b.startTime || 0) < (a.startTime || 0) ? b : a;
}

/**
 * The characters already placed in another raid of this event's instance and
 * raid ID: Map<characterKey, { local, title, raidNo, startTime, source? } | { other: true }>
 * (`source`: "log" | "loot" for an entry without a setup place).
 * @param {object} event
 * @param {{ excludeIds?: string[] }} [opts] further event ids that do not count (the proposal's own raids)
 */
function takenInRaidId(event, { excludeIds = [] } = {}) {
    if (!event) return new Map();
    const exclude = new Set([str(event.id), ...excludeIds.map(str)]);
    const id = raidIdOfEvent(event);
    const placed = weekEvents(id, instancesOf(event), exclude).map((other) => ({ other, keys: placedKeys(other) }));
    const sameRealm = realmReader();
    const taken = collect(event, placed, sameRealm);
    if (instancesOf(event).size) collectHistory(event, historyOfRaidId(id), exclude, sameRealm, taken);
    return taken;
}

/**
 * A reader "same realm?" for one pass: region + realm slug of a version on a
 * server (its overrides win), read once per server and version. Two empty
 * realms are the same (an install without realm settings).
 */
function realmReader() {
    let config = null;
    const cache = new Map();
    const realmOf = (versionId, guildId) => {
        const k = `${versionId}|${guildId}`;
        if (!cache.has(k)) {
            if (config === null) {
                try {
                    config = require("../../stores/settings/configStore").getConfig() || {};
                } catch {
                    config = {};
                }
            }
            const s = settingsForVersion(versionId, { config, guildId: guildId || undefined });
            cache.set(k, `${str(s.blizzardRegion).toLowerCase()}|${str(s.blizzardRealmSlug).toLowerCase()}`);
        }
        return cache.get(k);
    };
    return (versionId, a, b) => str(a) === str(b) || realmOf(versionId, str(a)) === realmOf(versionId, str(b));
}

/** Folds the placed characters of the other raids that share `event`'s instance (and realm) into one map. */
function collect(event, placed, sameRealm = realmReader()) {
    const taken = new Map();
    const instances = instancesOf(event);
    let versionId = null;
    for (const { other, keys } of placed) {
        if (!keys.size || !overlaps(instancesOf(other), instances)) continue;
        if (versionId === null) versionId = versionOfEvent(event) || "";
        if (!sameRealm(versionId, other.guildId, event.guildId)) continue;
        const entry = entryOf(other, event.guildId);
        for (const key of keys) taken.set(key, better(taken.get(key), entry));
    }
    return taken;
}

/**
 * The first names of the characters signed up for `event` (its version): first
 * name -> the full character keys. "devi" -> {"devi res"}. Only names of two words or more.
 */
function firstNamesOf(event) {
    const versionId = versionOfEvent(event) || "";
    const byFirst = new Map();
    const add = (name) => {
        const key = characterKeyOf(name);
        const space = key.indexOf(" ");
        if (space <= 0) return;
        const first = key.slice(0, space);
        if (!byFirst.has(first)) byFirst.set(first, new Set());
        byFirst.get(first).add(key);
    };
    let signups;
    try {
        signups = signupStore.listSignups(signupEventIdOf(event)) || [];
    } catch {
        signups = [];
    }
    for (const s of signups) {
        if (!s) continue;
        add(s.character);
        for (const c of profileStore.charactersOfVersion(profileStore.getProfile(s.userId), versionId)) add(c && c.name);
    }
    return byFirst;
}

/**
 * Folds the log and loot records of the raid ID into `taken`: same instance,
 * not one of the raids planned here, same realm. A one-word name stands for the
 * one signed-up character with that first name - or for nobody.
 */
function collectHistory(event, records, exclude, sameRealm, taken) {
    const instances = instancesOf(event);
    let versionId = null;
    let firstNames = null;
    const keyOf = (key) => {
        if (key.includes(" ")) return key;
        if (firstNames === null) firstNames = firstNamesOf(event);
        const full = firstNames.get(key);
        if (full) return full.size === 1 ? [...full][0] : "";
        return key;
    };
    for (const rec of records || []) {
        if (str(rec.eventId) && exclude.has(str(rec.eventId))) continue;
        const shared = [...rec.contentIds].filter((i) => instances.has(i));
        if (!shared.length) continue;
        if (versionId === null) versionId = versionOfEvent(event) || "";
        if (!sameRealm(versionId, rec.guildId, event.guildId)) continue;
        const local = !!str(event.guildId) && str(rec.guildId) === str(event.guildId);
        const inst = instanceById(shared[0]);
        const entry = local
            ? { local: true, title: str(inst && (inst.short || inst.name)) || shared[0], startTime: rec.startTime || 0, source: rec.source }
            : { other: true };
        for (const raw of rec.keys) {
            const key = keyOf(raw);
            if (key) taken.set(key, better(taken.get(key), entry));
        }
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
    const exclude = new Set(list.map((e) => str(e.id)));
    // one store pass per raid ID (a raid group shares one), with every instance the raids of it play
    const byId = new Map();
    for (const event of list) {
        const id = raidIdOfEvent(event);
        if (id === null || !instancesOf(event).size) continue;
        if (!byId.has(id)) byId.set(id, { events: [], instances: new Set() });
        const week = byId.get(id);
        week.events.push(event);
        for (const i of instancesOf(event)) week.instances.add(i);
    }
    const out = {};
    const sameRealm = realmReader();
    for (const [id, week] of byId) {
        const placed = weekEvents(id, week.instances, exclude).map((other) => ({ other, keys: placedKeys(other) }));
        const history = historyOfRaidId(id);
        for (const event of week.events) {
            const taken = collectHistory(event, history, exclude, sameRealm, collect(event, placed, sameRealm));
            const keys = [...taken.keys()];
            if (keys.length) out[str(event.id)] = keys;
        }
    }
    return out;
}

module.exports = { takenInRaidId, markLineup, takenKeysFor };
