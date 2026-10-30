// Can this person lead this raid? (#1034)
//
// `canLead` is pure: it gets the person's flags (leaderFlagsStore's
// `{ [versionId]: { instances } }`), the event's version and its instance ids.
// It is true when the flags of that version cover every instance of the event;
// an event without instance ids counts any flag of the version. Versions never
// mix: a Forever flag says nothing about TBC.
//
// Nobody leads without a flag — not an admin, not a roster manager. The setup
// (#1036) reads it through `userCanLead`, which lives here and not in web/ so
// services/setup may require it.

const leaderFlagsStore = require("../../stores/roster/leaderFlagsStore");
const { VERSIONS, LEGACY_VERSION, rulesFor } = require("../../config/gameVersions");
const { knownVersion, mainVersionFor, isVersionVisible } = require("../versions/mainVersion");

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

module.exports = { canLead, userCanLead, leadInstances, leadsForVersion, instanceChoices, profileLeadVersions };
