// Can this person lead this raid? (#1034)
//
// `canLead` is pure: it gets the person's flags (leaderFlagsStore's
// `{ [versionId]: { instances } }`), the event's version and its instance ids.
// It is true when the flags of that version cover every instance of the event;
// an event without instance ids counts any flag of the version. Versions never
// mix: a Forever flag says nothing about TBC.
//
// Nobody leads without a flag — not an admin, not a roster manager. The setup
// (#1036) reads it through `userCanLeadEvent` / `userCanLead`, which live here
// and not in web/ so services/setup may require them.
//
// The flags hold per account (docs/permissions.md "Leader-Flags"): the person
// sets every one in "Mein Profil", the orga only those of its context - the
// raid's instances, or from a roster those of the category (eventLeadContext,
// rosterLeadContext) - and merges them into the rest (setLeadsInContext).

const leaderFlagsStore = require("../../stores/roster/leaderFlagsStore");
const { VERSIONS, LEGACY_VERSION, rulesFor } = require("../../config/gameVersions");
const { knownVersion, mainVersionFor, isVersionVisible, versionOfEvent } = require("../versions/mainVersion");
const { listEvents } = require("../../stores/events/eventStore");
const { getRaidTemplate } = require("../../stores/events/raidTemplateStore");
const { userCan, userIsOrga } = require("../../config/permissions");
const categoryOrga = require("./categoryOrga");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** How far back the raids of a category count for its instances (the roster context). */
const CONTEXT_LOOKBACK_DAYS = 90;

/** The instance ids `leads` holds for `versionId` (empty when none). */
function leadInstances(leads, versionId) {
    const entry = leads && versionId ? leads[versionId] : null;
    return entry && Array.isArray(entry.instances) ? entry.instances : [];
}

/** Whether `leads` covers an event of `versionId` with `instanceIds`. */
function canLead(leads, versionId, instanceIds) {
    const mine = leadInstances(leads, String(versionId || ""));
    if (!mine.length) return false;
    const wanted = (Array.isArray(instanceIds) ? instanceIds : []).map(String).filter(Boolean);
    if (!wanted.length) return true;
    const own = new Set(mine);
    return wanted.every((id) => own.has(id));
}

/** canLead for a stored account. */
function userCanLead(userId, versionId, instanceIds) {
    return canLead(leaderFlagsStore.leadsOf(userId), versionId, instanceIds);
}

/** canLead for a stored account and a raid: its version (versionOfEvent) and its instance ids. */
function userCanLeadEvent(userId, event, { config } = {}) {
    if (!event) return false;
    return userCanLead(userId, versionOfEvent(event, { config }), event.instanceIds);
}

/**
 * The instances of a category in `versionId` - where its orga may set leader
 * flags from a roster: those of its own raids of that version (the last
 * CONTEXT_LOOKBACK_DAYS and every coming one) and those of the category's raid
 * template (config.categoryRaidTemplate). Empty when neither names one.
 */
function categoryLeadInstances(categoryId, versionId, { config, guildId = "", now = Date.now() } = {}) {
    const cat = str(categoryId);
    const vid = str(versionId);
    if (!cat || !vid || !rulesFor(vid)) return [];
    const ids = [];
    const since = Math.floor(now / 1000) - CONTEXT_LOOKBACK_DAYS * 86400;
    for (const event of listEvents(guildId, { sinceSeconds: since, siblings: true })) {
        if (str(event.categoryId) !== cat || versionOfEvent(event, { config }) !== vid) continue;
        ids.push(...(Array.isArray(event.instanceIds) ? event.instanceIds : []));
    }
    const tplId = ((config && config.categoryRaidTemplate) || {})[cat];
    const tpl = tplId ? getRaidTemplate(tplId) : null;
    if (tpl && Array.isArray(tpl.instanceIds)) ids.push(...tpl.instanceIds);
    return leaderFlagsStore.validInstances(vid, ids);
}

/**
 * The orga's context in a raid: `{ versionId, instances }` - the raid's own
 * instances, or for a raid without any those of its category.
 */
function eventLeadContext(event, { config, now } = {}) {
    const versionId = versionOfEvent(event, { config });
    if (!rulesFor(versionId)) return { versionId, instances: [] };
    const own = leaderFlagsStore.validInstances(versionId, event && event.instanceIds);
    if (own.length) return { versionId, instances: own };
    const instances = categoryLeadInstances(event && event.categoryId, versionId, { config, guildId: str(event && event.guildId), now });
    return { versionId, instances };
}

/** The orga's context in a roster: `{ versionId, instances }` of its category (categoryLeadInstances). */
function rosterLeadContext(roster, { config, now } = {}) {
    const versionId = str(roster && roster.versionId);
    const instances = categoryLeadInstances(roster && roster.categoryId, versionId, { config, guildId: str(roster && roster.guildId), now });
    return { versionId, instances };
}

/**
 * The orga sets `userId`'s flags inside its context only: the instances of
 * `context` become `instances`, every other flag of the version stays as it
 * was (a merge, never a replace). An id outside the context refuses the whole
 * write: `{ error: "outside_context", outside }`; else `{ entry }` (null after
 * the last flag went).
 */
function setLeadsInContext(userId, versionId, context, instances, { by = "" } = {}) {
    const vid = str(versionId);
    if (!vid || !rulesFor(vid)) return { error: "unknown_version" };
    const inside = new Set((context || []).map(String));
    const asked = [...new Set((Array.isArray(instances) ? instances : []).map(str).filter(Boolean))];
    const outside = asked.filter((id) => !inside.has(id));
    if (outside.length) return { error: "outside_context", outside };
    const kept = leadInstances(leaderFlagsStore.leadsOf(userId), vid).filter((id) => !inside.has(id));
    return { entry: leaderFlagsStore.setLeads(userId, vid, [...kept, ...asked], { by }) };
}

/**
 * Whether `user` may set others' flags from `roster` - the same as the gate
 * of PUT /api/leads: the global orga with the raids write right, or the orga of
 * the roster's category (categoryOrga.canOrgaEvent, a manager of its current
 * roster). Lets the roster page show the chips only where the write would pass.
 */
async function mayOrgaRosterLeads(user, roster, { config } = {}) {
    if (!user || !roster || roster.closedAt) return false;
    if (userCan(user, "raids", "write") && userIsOrga(user)) return true;
    if (!str(roster.categoryId)) return false;
    return categoryOrga.canOrgaEvent(user, { categoryId: roster.categoryId }, { config, managerOnly: true }).catch(() => false);
}

/**
 * The instances of `versionId` each of `userIds` leads, for a view that marks
 * many people at once: `{ [userId]: string[] }`, only people with a flag.
 */
function leadsForVersion(userIds, versionId) {
    const all = leaderFlagsStore.allLeads();
    const out = {};
    for (const id of new Set((userIds || []).map(String))) {
        const ids = leadInstances(all[id], versionId);
        if (ids.length) out[id] = [...ids];
    }
    return out;
}

/** A version's instances in the shape the chips need. */
function instanceChoices(versionId) {
    const rules = rulesFor(versionId);
    return rules ? rules.instances.map((i) => ({ id: i.id, name: i.name, short: i.short || i.name, icon: i.icon || "" })) : [];
}

/**
 * The versions "Mein Profil › Raids leiten" offers `userId`: those of their
 * characters, those a category plays (config.categoryVersion, the main
 * version), and those they already lead in - of the visible ones, plus any
 * they hold a flag in. Each with its instances and the own flag.
 */
function profileLeadVersions(userId, characters, { config } = {}) {
    const leads = leaderFlagsStore.leadsOf(userId);
    const cfg = config || {};
    const played = new Set((characters || []).map((c) => knownVersion(c && c.versionId) || LEGACY_VERSION));
    played.add(mainVersionFor({ config }));
    const byCategory = cfg.categoryVersion && typeof cfg.categoryVersion === "object" ? Object.values(cfg.categoryVersion) : [];
    for (const v of byCategory) if (knownVersion(v)) played.add(v);
    return VERSIONS.filter((v) => leads[v.id] || (played.has(v.id) && isVersionVisible(v.id, config)))
        .map((v) => ({
            id: v.id,
            label: v.label,
            short: v.short || v.label,
            instances: instanceChoices(v.id),
            leads: leadInstances(leads, v.id),
            by: leads[v.id] ? leads[v.id].by : "",
            at: leads[v.id] ? leads[v.id].at : 0,
        }));
}

module.exports = {
    canLead, userCanLead, userCanLeadEvent, leadInstances, leadsForVersion, instanceChoices, profileLeadVersions,
    categoryLeadInstances, eventLeadContext, rosterLeadContext, setLeadsInContext, mayOrgaRosterLeads, CONTEXT_LOOKBACK_DAYS,
};
