// Raid groups (#811): "Weiteren Raid hinzufügen" — an overbooked own event
// gets further raids at the same time (same start, duration, category, version,
// template, size, composition, buffs and channel), titled "Zul'Aman 2". The
// raiders sign up once, at the first raid (the group's primary); the orga splits
// them in one setup editor and every raid keeps its own setup, approval and
// setup message.
//
// The record fields and the pure readers are in utils/raidGroup.js. This module
// is the store side: which raids form a group, who stands in which of them, how
// a raid is added and how a further raid is dissolved again.
const eventStore = require("../../stores/events/eventStore");
const { raidGroupIdOf, isRaidSibling, signupEventIdOf, raidIndexOf, inRaidGroup } = require("../../utils/raidGroup");
const { approvedSetupOf, benchAndPool } = require("../setup/setupCore");
const { str } = require("../../utils/text");

// More raids than this from one signup is no longer one evening's split.
const MAX_RAIDS = 8;
const MAX_TITLE = 100;

const fail = (status, code, error) => ({ status, code, error });

/** Raids of the group in their order (the primary first); just [event] outside a group. */
function groupEvents(event) {
    if (!event) return [];
    const id = raidGroupIdOf(event);
    if (!id) return [event];
    const list = eventStore.listEvents(event.guildId || "", { siblings: true }).filter((e) => raidGroupIdOf(e) === id);
    if (!list.some((e) => e.id === event.id)) list.push(event);
    return list.sort((a, b) => raidIndexOf(a) - raidIndexOf(b) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** The group's primary — the raid the raiders sign up at — or the event itself outside a group. */
function primaryOf(event) {
    if (!event || !isRaidSibling(event)) return event || null;
    return eventStore.getEvent(signupEventIdOf(event)) || event;
}

/** Who stands in a setup's groups or on its explicit bench (the draft — what the editor shows). */
function lineupMembers(setup) {
    const out = new Map();
    if (!setup) return out;
    for (const g of Array.isArray(setup.groups) ? setup.groups : []) {
        for (const s of Array.isArray(g && g.slots) ? g.slots : []) if (s && s.userId) out.set(String(s.userId), { group: Number(g.index) || 0 });
    }
    for (const b of benchAndPool(setup).bench) if (b && b.userId && !out.has(String(b.userId))) out.set(String(b.userId), { bench: true });
    return out;
}

/** How many stand in a setup's groups. */
const placedCount = (setup) => ((setup && setup.groups) || []).reduce((n, g) => n + ((g && g.slots) || []).length, 0);

/**
 * Everybody the OTHER raids of the event's group already hold (groups or bench):
 * `Map<userId, { eventId, title, index }>` — one seat per person across the group.
 * Empty outside a group.
 */
function placedElsewhere(event) {
    const out = new Map();
    if (!inRaidGroup(event)) return out;
    for (const other of groupEvents(event)) {
        if (other.id === event.id) continue;
        for (const userId of lineupMembers(other.setup).keys()) {
            if (!out.has(userId)) out.set(userId, { eventId: other.id, title: other.title, index: raidIndexOf(other) });
        }
    }
    return out;
}

/** The setup state of one raid as the tabs and lists read it. */
function raidState(event) {
    const setup = event.setup;
    const posted = !!(event.setupPost && event.setupPost.messageId && approvedSetupOf(event));
    return {
        id: event.id,
        title: event.title,
        index: raidIndexOf(event),
        size: Number(event.size) || 0,
        placed: placedCount(setup),
        status: !setup ? "none" : (setup.status === "approved" ? "approved" : "draft"),
        approved: !!approvedSetupOf(event),
        posted,
        cancelled: event.status === "cancelled",
    };
}

/**
 * What the pages read about the event's group: null outside one, else
 * `{ id, primaryId, count, places, raids: [{ id, title, index, size, placed, status, approved, posted, cancelled }] }`
 * — `places` = the seats of every raid together ("2 Raids · 20 Plätze").
 */
function groupSummary(event) {
    if (!inRaidGroup(event)) return null;
    const raids = groupEvents(event).map(raidState);
    if (raids.length < 2) return null;
    return {
        id: raidGroupIdOf(event),
        primaryId: signupEventIdOf(event),
        count: raids.length,
        places: raids.reduce((n, r) => n + r.size, 0),
        raids,
    };
}

/** The seats of the event's group together (its own size outside a group). */
function groupPlaces(event) {
    if (!inRaidGroup(event)) return Number(event && event.size) || 0;
    return groupEvents(event).reduce((n, e) => n + (Number(e.size) || 0), 0);
}

/** The event of a request (own, found), or a failure. */
function ownEvent(eventId) {
    const id = str(eventId);
    if (!eventStore.isOwnEventId(id)) return { failed: fail(409, "raidhelper", "Weitere Raids gibt es nur für eigene Events.") };
    const event = eventStore.getEvent(id);
    if (!event) return { failed: fail(404, "not_found", "Event nicht gefunden.") };
    return { event };
}

/** The title a new raid gets: the primary's with its number ("Zul'Aman 2"). */
function defaultTitle(primary, index) {
    return `${str(primary.title) || "Raid"} ${index}`.slice(0, MAX_TITLE);
}

/**
 * "Weiteren Raid hinzufügen": a further raid of the event's group (the event
 * becomes the primary of a new group when it has none). Everything the evening
 * shares is copied — start, duration, category, version, template, size,
 * composition, required buffs, channel, deadline, flags — the title is
 * `title` or "<Titel> <n>". No message, no Discord event and no signup of its
 * own: the raiders stay signed up at the primary.
 * @returns {{ event?: object, primary?: object, status?: number, code?: string, error?: string }}
 */
function addRaid(eventId, { title = "", user = null, now = Date.now() } = {}) {
    const checked = groupToGrow(eventId, now);
    if (checked.failed) return checked.failed;
    const { primary, raids } = checked;
    if (raids.length >= MAX_RAIDS) return fail(409, "too_many", `Höchstens ${MAX_RAIDS} Raids an einem Abend.`);
    const index = nextIndex(raids);
    const made = createSibling(primary, index, title, user);
    if (made.error) return made;
    const head = joinGroup(primary);
    const by = actor(user, now);
    eventStore.appendEventLog(primary.id, { ...by, action: "raidAdd", detail: `Weiterer Raid angelegt: ${made.title}` });
    eventStore.appendEventLog(made.event.id, { ...by, action: "raidAdd", detail: `Als Raid ${index} von „${primary.title}“ angelegt` });
    return { event: eventStore.getEvent(made.event.id) || made.event, primary: head || primary };
}

/**
 * "n Raids anlegen" (#1035): `count` further raids in one go — the same as
 * `count` times "Weiteren Raid hinzufügen", with one log entry on the primary
 * ("4 Raids angelegt: …"). `titles[i]` names the i-th new raid (else
 * "<Titel> <n>"). The group stays at most MAX_RAIDS raids: a count beyond it
 * is refused as a whole (nothing created). count 1 is plain addRaid.
 * @returns {{ events?: object[], primary?: object, status?: number, code?: string, error?: string }}
 */
function addRaids(eventId, { count = 1, titles = [], user = null, now = Date.now() } = {}) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return fail(400, "invalid", "Anzahl der Raids fehlt.");
    const names = Array.isArray(titles) ? titles : [];
    if (n === 1) {
        const one = addRaid(eventId, { title: str(names[0]), user, now });
        return one.error ? one : { events: [one.event], primary: one.primary };
    }
    const checked = groupToGrow(eventId, now);
    if (checked.failed) return checked.failed;
    const { primary, raids } = checked;
    if (raids.length + n > MAX_RAIDS) {
        return fail(400, "too_many", `Höchstens ${MAX_RAIDS} Raids an einem Abend – ${Math.max(0, MAX_RAIDS - raids.length)} lassen sich noch anlegen.`);
    }
    const by = actor(user, now);
    const events = [];
    let index = nextIndex(raids);
    for (let i = 0; i < n; i += 1, index += 1) {
        const made = createSibling(primary, index, names[i], user);
        if (made.error) {
            if (!events.length) return made;
            break; // the ones made stay — logged below
        }
        eventStore.appendEventLog(made.event.id, { ...by, action: "raidAdd", detail: `Als Raid ${index} von „${primary.title}“ angelegt` });
        events.push(eventStore.getEvent(made.event.id) || made.event);
    }
    const head = joinGroup(primary);
    eventStore.appendEventLog(primary.id, { ...by, action: "raidAdd", detail: `${events.length} Raids angelegt: ${events.map((e) => e.title).join(", ")}` });
    return { events, primary: head || primary };
}

/**
 * How many raids to add for the signups: enough raids for everybody who is
 * signed up (`active` = without a decline or absence — "Vielleicht" and the
 * bench count, as in the pool), at most MAX_RAIDS together, minus the raids
 * the group already has. 0 when nothing is missing.
 */
function suggestedRaidCount({ active = 0, size = 0, raids = 1 } = {}) {
    const people = Number(active) || 0;
    const seats = Number(size) || 0;
    if (people <= 0 || seats <= 0) return 0;
    return Math.max(0, Math.min(Math.ceil(people / seats), MAX_RAIDS) - (Number(raids) || 1));
}

/** The group an add request grows (its primary, raids), or why not. */
function groupToGrow(eventId, now) {
    const { event: asked, failed } = ownEvent(eventId);
    if (failed) return { failed };
    const primary = primaryOf(asked);
    if (primary.status === "cancelled") return { failed: fail(409, "cancelled", "Der Raid ist abgesagt.") };
    if ((Number(primary.startTime) || 0) * 1000 <= now) {
        return { failed: fail(409, "started", "Der Raid hat schon begonnen – ein weiterer Raid lässt sich nur vorher anlegen.") };
    }
    return { primary, raids: groupEvents(primary) };
}

const nextIndex = (raids) => raids.reduce((n, e) => Math.max(n, raidIndexOf(e)), 1) + 1;
const actor = (user, now) => ({ by: str(user && user.id), byName: str(user && (user.name || user.username)), at: now });

/** The primary as head of its group (becomes it on the first further raid). */
function joinGroup(primary) {
    return raidGroupIdOf(primary) ? eventStore.getEvent(primary.id) || primary : eventStore.setEventRaidGroup(primary.id, { raidGroupId: primary.id, raidGroupIndex: 1 });
}

/** Create one further raid of the primary's evening at `index` (no log). */
function createSibling(primary, index, title, user) {
    const name = str(title).slice(0, MAX_TITLE) || defaultTitle(primary, index);
    const created = eventStore.createEvent({
        guildId: primary.guildId,
        channelId: primary.channelId,
        channelName: primary.channelName,
        categoryId: primary.categoryId,
        categoryName: primary.categoryName,
        voiceChannelId: primary.voiceChannelId,
        title: name,
        description: primary.description,
        leaderId: primary.leaderId,
        startTime: primary.startTime,
        versionId: primary.versionId,
        instanceIds: primary.instanceIds,
        size: primary.size,
        composition: primary.composition,
        compositionMax: primary.compositionMax,
        requiredBuffs: primary.requiredBuffs,
        durationMinutes: primary.durationMinutes,
        color: primary.color,
        image: primary.image,
        signupDeadline: primary.signupDeadline,
        fairness: primary.fairness,
        wishes: primary.wishes,
        // the automatic proposal at the deadline never touches a group (reminders.autoSuggestDue)
        autoSuggest: false,
        overflow: primary.overflow,
        lockAtLimit: false,
        emojiStyle: primary.emojiStyle,
        raidTemplateId: primary.raidTemplateId,
        createdBy: str(user && user.id),
        raidGroupId: primary.id,
        raidGroupIndex: index,
    });
    if (created.error) return fail(400, "invalid", created.error);
    return { event: created.event, title: name };
}

/**
 * After a further raid is gone (dissolved, or deleted through Event verwalten):
 * the last one gone, the primary is a plain event again; else the others close
 * up their numbers (2, 3 …).
 */
function closeUp(primary, removedId = "") {
    if (!primary) return;
    const rest = groupEvents(primary).filter((e) => e.id !== removedId);
    if (rest.length < 2) {
        if (raidGroupIdOf(primary)) eventStore.setEventRaidGroup(primary.id, { raidGroupId: "" });
        return;
    }
    rest.forEach((e, i) => {
        if (raidIndexOf(e) !== i + 1) eventStore.setEventRaidGroup(e.id, { raidGroupId: primary.id, raidGroupIndex: i + 1 });
    });
}

/**
 * Move the further raids of a group along with its primary (Event verwalten ›
 * Verschieben): same start and signup deadline. Returns how many followed.
 */
function followPrimary(primary) {
    if (!primary || isRaidSibling(primary) || !inRaidGroup(primary)) return 0;
    let n = 0;
    for (const e of groupEvents(primary)) {
        if (e.id === primary.id) continue;
        const moved = eventStore.updateEvent(e.id, { startTime: primary.startTime, signupDeadline: primary.signupDeadline });
        if (!moved.error) n += 1;
    }
    return n;
}

/**
 * Dissolve a further raid again: only one without an approved setup (its lineup
 * was never out). It is deleted; everybody it held falls back into the shared
 * pool "Angemeldet" (the pool is the primary's signups minus who stands in a
 * raid). The last further raid gone, the primary is a plain event again; the
 * others close up their numbers.
 * @returns {{ primary?: object, removed?: object, status?: number, code?: string, error?: string }}
 */
function dissolveRaid(eventId, { user = null, now = Date.now() } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    if (!isRaidSibling(event)) return fail(409, "primary", "Der erste Raid trägt die Anmeldung und bleibt – auflösen lassen sich nur die weiteren.");
    if (approvedSetupOf(event) || (event.setupPost && event.setupPost.messageId)) {
        return fail(409, "approved", `${event.title} hat ein freigegebenes Setup – auflösen geht nur vorher (sonst Event verwalten › Löschen).`);
    }
    const primary = primaryOf(event);
    eventStore.deleteEvent(event.id);
    closeUp(primary, event.id);
    const placed = lineupMembers(event.setup).size;
    eventStore.appendEventLog(primary.id, {
        by: str(user && user.id), byName: str(user && (user.name || user.username)), at: now,
        action: "raidRemove", detail: `Raid aufgelöst: ${event.title}${placed ? ` (${placed} zurück in „Angemeldet“)` : ""}`,
    });
    return { primary: eventStore.getEvent(primary.id) || primary, removed: event, placed };
}

module.exports = {
    groupEvents, primaryOf, placedElsewhere, lineupMembers, groupSummary, groupPlaces, addRaid, addRaids, suggestedRaidCount,
    dissolveRaid, defaultTitle, closeUp, followPrimary, MAX_RAIDS,
};
