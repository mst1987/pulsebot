// The one place that knows events come from two sources — Raid-Helper and the
// EventHelper's own store (eventStore.js / signupStore.js) — and hands both out
// in the same shape. Every reader (raid list and detail, attendance, roster,
// dashboard, log and loot matching, bot commands) only ever sees that common
// shape plus a `source` field, so none of them has to know where an event lives.
//
// Raid-Helper events stay fully in use wherever one exists, also in a category
// whose new events are created in the EventHelper (`categorySignupSource`):
// nothing is imported, nothing expires, and one event has exactly one source.
const { listEvents, getEvent, isOwnEventId } = require("../stores/eventStore");
const { listSignups } = require("../stores/signupStore");
const { listRaidEvents, getRaidEvent } = require("../stores/raidEventStore");
const { getConfig } = require("../stores/settingsStore");
const { ALIASES } = require("../config/classlist");

const SOURCES = ["raidhelper", "eventhelper"];
const DEFAULT_SOURCE = "raidhelper";

// Rule-set spec key → the Raid-Helper spec name the readers already understand
// (config/classlist.js via setupView.specProfile, dashboardOverview's role
// buckets, the bot's class emojis). Holy and Protection exist for two classes,
// so the key carries the class.
const RH_SPEC_NAMES = {
    "Warrior-Arms": "Arms", "Warrior-Fury": "Fury", "Warrior-Protection": "Protection",
    "Paladin-Holy": "Holy1", "Paladin-Protection": "Protection1", "Paladin-Retribution": "Retribution",
    "Hunter-BeastMastery": "Beastmastery", "Hunter-Marksmanship": "Marksmanship", "Hunter-Survival": "Survival",
    "Rogue-Assassination": "Assassination", "Rogue-Combat": "Combat", "Rogue-Subtlety": "Sublety",
    "Priest-Discipline": "Discipline", "Priest-Holy": "HolyPriest", "Priest-Shadow": "Shadow",
    "Shaman-Elemental": "Elemental", "Shaman-Enhancement": "Enhancement", "Shaman-Restoration": "Restoration1",
    "Mage-Arcane": "Arcane", "Mage-Fire": "Fire", "Mage-Frost": "Frost",
    "Warlock-Affliction": "Affliction", "Warlock-Demonology": "Demonology", "Warlock-Destruction": "Destro",
    "Druid-Balance": "Balance", "Druid-Feral": "Feral", "Druid-Guardian": "Guardian", "Druid-Restoration": "Restoration",
};

// Raid-Helper writes a sign-off as its own pseudo class/spec; readers that only
// look at `specName` (signupCount, the bot's "not signed up" list) rely on it.
const PSEUDO_SPECS = { absence: "Absence" };

/** The Raid-Helper spec name of a rule-set spec key, or "" when unknown. */
function specNameFor(specKey) {
    return RH_SPEC_NAMES[String(specKey || "")] || "";
}

// Raid-Helper spec name → rule-set spec key: the reverse of RH_SPEC_NAMES, used
// to read Raid-Helper signups as spec history (#291). Raid-Helper's own names are
// unique across classes ("Holy1" = paladin, "HolyPriest" = priest).
const SPEC_KEY_BY_RH_NAME = Object.fromEntries(Object.entries(RH_SPEC_NAMES).map(([key, name]) => [name.toLowerCase(), key]));
const WOW_CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

/**
 * The rule-set spec key of one Raid-Helper signup (`className`, `specName`), or
 * "" when it names no playable spec (Absence, Bench, a death knight, a typo).
 * Aliases of config/classlist.js ("Destro", "RestoSham", "ProtPala") resolve to
 * their spec; when `className` is a real class it wins over an ambiguous name —
 * "Holy" on a paladin is a holy paladin, not the priest classlist's alias means.
 */
function specKeyFromRaidHelper(className, specName) {
    const raw = String(specName || "").trim();
    if (!raw) return "";
    const cls = WOW_CLASSES.find((c) => c.toLowerCase() === String(className || "").trim().toLowerCase()) || "";
    // An alias counts when it names a spec of the rule set (not a class-only
    // entry, not a death knight).
    const aliasKey = Object.prototype.hasOwnProperty.call(ALIASES, raw) ? ALIASES[raw] : "";
    const found = SPEC_KEY_BY_RH_NAME[raw.toLowerCase()]
        || (RH_SPEC_NAMES[aliasKey] ? aliasKey : "");
    if (!cls) return found;
    if (found && found.startsWith(`${cls}-`)) return found;
    // The class says otherwise: its spec of the same name ("Holy1" → "Holy").
    const bare = raw.replace(/\d+$/, "").toLowerCase();
    const own = Object.keys(RH_SPEC_NAMES).find((key) => key.startsWith(`${cls}-`)
        && [key.split("-")[1].toLowerCase(), RH_SPEC_NAMES[key].replace(/\d+$/, "").toLowerCase()].includes(bare));
    return own || "";
}

/** The source a category without its own choice gets (config.signupSourceDefault). */
function defaultSignupSource(config = getConfig()) {
    const value = config && config.signupSourceDefault;
    return SOURCES.includes(value) ? value : DEFAULT_SOURCE;
}

/**
 * A category's source for NEW events: its own choice, else the default —
 * EventHelper since #291 for a category that is new, while the categories an
 * install already had stay on Raid-Helper until someone switches them
 * (settingsStore.signupSourcesOf pins them).
 */
function signupSourceFor(categoryId, config = getConfig()) {
    const map = (config && config.categorySignupSource) || {};
    const value = map[String(categoryId || "")];
    return SOURCES.includes(value) ? value : defaultSignupSource(config);
}

/** Which source an event id belongs to. */
function sourceOfEventId(id) {
    return isOwnEventId(id) ? "eventhelper" : "raidhelper";
}

/**
 * One EventHelper signup in the shape of a normalised Raid-Helper signup
 * ({ userId, specName, className, status }), plus what only we know.
 */
function toSignUpShape(signup) {
    const status = String((signup && signup.status) || "signed");
    const pseudo = PSEUDO_SPECS[status];
    const specKey = String((signup && signup.spec) || "");
    return {
        userId: String((signup && signup.userId) || ""),
        specName: pseudo || specNameFor(specKey),
        className: pseudo || specKey.split("-")[0] || "",
        status,
        spec: specKey,
        role: (signup && signup.role) || "",
        character: (signup && signup.character) || "",
        // Every named character in priority order (#293); the fields above are characters[0].
        characters: (signup && Array.isArray(signup.characters)) ? signup.characters : [],
        canAlso: (signup && signup.canAlso) || [],
        comment: (signup && signup.comment) || "",
        at: (signup && signup.at) || 0,
    };
}

/** The signups of an own event in the common shape. */
function ownSignUps(eventId) {
    return listSignups(eventId).map(toSignUpShape);
}

/** Channel/category name: the live Discord join first, the stored name second. */
function placement(ev, catMap) {
    const meta = (catMap || {})[ev.channelId];
    return {
        channelName: meta ? (meta.name || ev.channelName || "") : (ev.channelName || ""),
        categoryId: meta ? (meta.categoryId || ev.categoryId || "") : (ev.categoryId || ""),
        categoryName: meta ? (meta.categoryName || ev.categoryName || "") : (ev.categoryName || ""),
    };
}

/** What only an own event carries, kept on every shape it is handed out in. */
function planFields(ev) {
    return {
        versionId: ev.versionId, instanceIds: ev.instanceIds, size: ev.size,
        composition: ev.composition, signupDeadline: ev.signupDeadline,
        // #305: how long the raid takes and where it meets (a voice channel).
        durationMinutes: ev.durationMinutes, voiceChannelId: ev.voiceChannelId || "",
        // #307: colour and picture of the event message, so the edit dialog
        // reads back what it sent ("" = the rule set of the instances decides).
        color: ev.color || "", image: ev.image || { mode: "thumbnail", url: "" },
        // #288: readers skip or mark a cancelled event (reminders, talk overview).
        status: ev.status || "active", signupsClosed: !!ev.signupsClosed,
    };
}

/** An own event as a row of loadEventGroups()'s groups. */
function toEventGroupShape(ev, { catMap, signUps } = {}) {
    const place = placement(ev, catMap);
    const rows = signUps || ownSignUps(ev.id);
    return {
        id: ev.id,
        source: "eventhelper",
        title: ev.title,
        startTime: ev.startTime,
        leaderId: ev.leaderId,
        channelId: ev.channelId,
        channelName: place.channelName,
        categoryId: place.categoryId,
        templateId: "",
        description: ev.description || "",
        signupCount: rows.filter((s) => s.specName !== "Absence").length,
        signUps: rows,
        signUpsFromSnapshot: false,
        ...planFields(ev),
        // categoryName is not part of a group row (the group carries it); the
        // caller places the row under it.
        _categoryName: place.categoryName,
    };
}

/** An own event as a loadMatchableEvents() row. */
function toMatchableShape(ev, { catMap } = {}) {
    const place = placement(ev, catMap);
    return {
        id: ev.id,
        source: "eventhelper",
        title: ev.title,
        startTime: ev.startTime,
        channelId: ev.channelId,
        channelName: place.channelName,
        categoryId: place.categoryId,
        categoryName: place.categoryName,
    };
}

/** An own event in the shape of a raidEventStore snapshot row. */
function toStoredShape(ev) {
    return {
        id: ev.id,
        source: "eventhelper",
        guildId: ev.guildId,
        title: ev.title,
        channelId: ev.channelId,
        channelName: ev.channelName,
        categoryId: ev.categoryId,
        categoryName: ev.categoryName,
        startTime: ev.startTime,
        signUps: ownSignUps(ev.id),
        setup: [],
        ...planFields(ev),
    };
}

/**
 * The raw event list of a source in the shape Raid-Helper's own API answers
 * with ({ id, title, startTime, channelId, leaderId, signUps, ... }) — for the
 * few readers that consume that list directly (dashboard, bot commands).
 */
function toRaidHelperShape(ev) {
    return {
        id: ev.id,
        source: "eventhelper",
        title: ev.title,
        description: ev.description || "",
        startTime: ev.startTime,
        channelId: ev.channelId,
        channelName: ev.channelName,
        categoryId: ev.categoryId,
        categoryName: ev.categoryName,
        leaderId: ev.leaderId,
        templateId: "",
        signUps: ownSignUps(ev.id),
        ...planFields(ev),
    };
}

/**
 * Own events for loadEventGroups(): upcoming ones (start ≥ now) by default,
 * everything since `sinceSeconds` when a lookback is asked for — the same
 * semantics as Raid-Helper's StartTimeFilter.
 * @returns {{ categoryId: string, categoryName: string, row: object }[]}
 */
function ownEventGroupRows(guildId, { sinceSeconds, catMap, now = Date.now() } = {}) {
    if (!guildId) return [];
    const lower = sinceSeconds || Math.floor(now / 1000);
    return listEvents(guildId, { sinceSeconds: lower }).map((ev) => {
        const row = toEventGroupShape(ev, { catMap });
        const { _categoryName, ...clean } = row;
        return { categoryId: clean.categoryId, categoryName: _categoryName, row: clean };
    });
}

/** Own events that already started within [fromSeconds, now], for log/loot matching. */
function ownMatchableEvents(guildId, fromSeconds, { catMap, now = Date.now() } = {}) {
    if (!guildId) return [];
    return listEvents(guildId, { sinceSeconds: fromSeconds, untilSeconds: Math.floor(now / 1000) })
        .map((ev) => toMatchableShape(ev, { catMap }));
}

/** Own upcoming events of a guild in Raid-Helper's raw list shape, soonest first. */
function ownUpcomingRaw(guildId, { now = Date.now(), categoryId } = {}) {
    return listEvents(guildId, { sinceSeconds: Math.floor(now / 1000) })
        .filter((ev) => !categoryId || ev.categoryId === categoryId)
        .sort((a, b) => a.startTime - b.startTime)
        .map(toRaidHelperShape);
}

/**
 * Own upcoming events (every guild) a user signed up for and did not sign off
 * from, in Raid-Helper's raw list shape — the own half of the bot's
 * `show-allsetups`, whose Raid-Helper half comes from `getUserSignUps`.
 */
function ownSignedUpEvents(userId, { now = Date.now() } = {}) {
    const uid = String(userId || "");
    if (!uid) return [];
    return listEvents("", { sinceSeconds: Math.floor(now / 1000) })
        .filter((ev) => listSignups(ev.id).some((s) => String(s.userId) === uid && s.status !== "absence"))
        .map(toRaidHelperShape);
}

/**
 * The stored events of both sources, newest start first: Raid-Helper's
 * snapshot (raidEventStore.js, which only holds raids that already took place)
 * plus the own events that already started. The drop-in for listRaidEvents().
 */
function listStoredEvents(guildId, { now = Date.now() } = {}) {
    const rh = listRaidEvents(guildId).map((e) => ({ source: "raidhelper", ...e }));
    const own = listEvents(guildId, { untilSeconds: Math.floor(now / 1000) }).map(toStoredShape);
    return [...rh, ...own].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

/**
 * The own event a Discord channel belongs to, for the bot's channel-bound
 * commands (`/signup`, `/fillsetup` without an id, #291): the next
 * one that has not started, else the one that started last. A cancelled event
 * counts only when nothing else is there. Null without an own event.
 */
function ownEventInChannel(channelId, { now = Date.now() } = {}) {
    const cid = String(channelId || "");
    if (!cid) return null;
    const nowSec = Math.floor(now / 1000);
    const inChannel = listEvents("").filter((ev) => ev.channelId === cid);
    const active = inChannel.filter((ev) => ev.status !== "cancelled");
    const pool = active.length ? active : inChannel;
    const upcoming = pool.filter((ev) => Number(ev.startTime) >= nowSec).sort((a, b) => a.startTime - b.startTime);
    return upcoming[0] || pool[0] || null; // listEvents: newest start first
}

/** One stored event of either source by id (the drop-in for getRaidEvent()), or null. */
function getStoredEvent(id) {
    if (isOwnEventId(id)) {
        const ev = getEvent(id);
        return ev ? toStoredShape(ev) : null;
    }
    const snap = getRaidEvent(id);
    return snap ? { source: "raidhelper", ...snap } : null;
}

module.exports = {
    SOURCES, DEFAULT_SOURCE,
    specNameFor, specKeyFromRaidHelper, signupSourceFor, defaultSignupSource, sourceOfEventId,
    toSignUpShape, ownSignUps, toEventGroupShape, toMatchableShape, toStoredShape, toRaidHelperShape,
    ownEventGroupRows, ownMatchableEvents, ownUpcomingRaw, ownSignedUpEvents, ownEventInChannel, listStoredEvents, getStoredEvent,
};
