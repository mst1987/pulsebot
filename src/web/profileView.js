// How a raider profile goes out over the API (#255) — and, above all, what it
// leaves out.
//
// The same stored profile is served twice: to its owner ("Mein Profil") and to
// the orga (roster, read-only). The difference is the wishes: "gerne zusammen
// raiden mit" is between the raider and the orga. A member sees whom *they*
// wished for, never whom anybody wished for them and never whether a wish is
// mutual — that would reveal the other raider's wishes. Only `forOrga` adds
// `mutual` and `wishedBy`.

const Blizzard = require("../classes/blizzard");
const { getConfig } = require("./settingsStore");
const { armoryUrlFor } = require("./charLinks");
const profiles = require("./raiderProfileStore");
const { specEvidence, logIndex } = require("./profileLogs");

/** A spec entry with what the rule set says about it and what the logs say. */
function specView(character, spec, index) {
    const info = profiles.specInfo(spec.key) || {};
    return {
        key: spec.key,
        gear: spec.gear,
        label: info.label || spec.key,
        specId: info.id || "",
        role: info.role || "",
        icon: info.icon || "",
        canTank: !!info.canTank,
        canHeal: !!info.canHeal,
        logs: specEvidence(character.name, spec.key, index),
    };
}

/** What the specs of all characters allow, as the default for the two switches. */
function suggestedRoles(profile) {
    const specs = profile.characters.flatMap((c) => c.specs.map((s) => profiles.specInfo(s.key) || {}));
    return {
        canOfftank: specs.some((s) => s.canTank),
        canHeal: specs.some((s) => s.canHeal),
    };
}

/** The effective switches: the raider's own word, else what the specs suggest. */
function effectiveRoles(profile) {
    const suggested = suggestedRoles(profile);
    return {
        canOfftank: profile.canOfftank === null ? suggested.canOfftank : profile.canOfftank,
        canHeal: profile.canHeal === null ? suggested.canHeal : profile.canHeal,
        suggested,
    };
}

/**
 * The API shape of a profile. `forOrga` adds who wished for this raider and
 * which wishes are mutual; without it no other profile's wishes are touched.
 */
function profileView(profile, { forOrga = false, index = logIndex(), all = profiles.listProfiles() } = {}) {
    const byId = new Map(all.map((p) => [p.userId, p]));
    const characters = profile.characters.map((c) => ({
        key: c.key,
        name: c.name,
        realm: c.realm,
        className: c.className,
        main: c.main,
        source: c.source,
        armory: c.armory,
        armoryUrl: armoryUrlFor(c.name),
        specs: c.specs.map((s) => specView(c, s, index)),
        claimedBy: all
            .filter((p) => p.userId !== profile.userId && p.characters.some((o) => o.key === c.key))
            .map((p) => ({ userId: p.userId, name: p.name })),
    }));
    const wishes = profile.wishes.map((id) => {
        const other = byId.get(id);
        const ref = other ? profiles.raiderRef(other) : { userId: id, name: "", main: "", className: "" };
        return forOrga ? { ...ref, mutual: !!(other && other.wishes.includes(profile.userId)) } : ref;
    });
    const view = {
        userId: profile.userId,
        name: profile.name,
        characters,
        ...effectiveRoles(profile),
        availability: profile.availability,
        preferredRaids: profile.preferredRaids,
        wishes,
        note: profile.note,
        updatedAt: profile.updatedAt,
    };
    if (forOrga) {
        view.wishedBy = all
            .filter((p) => p.userId !== profile.userId && p.wishes.includes(profile.userId))
            .map((p) => profiles.raiderRef(p));
    }
    return view;
}

/** "Die Aldor" -> "die-aldor", the realm slug the profile API wants. */
function realmSlug(realm) {
    return String(realm || "").trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
}

/**
 * Link a character with the armory: the link always (from the template in
 * config/variables.js), plus class, level and guild when the Blizzard API is
 * configured and answers. Any failure means link only — never an error.
 * @returns {Promise<{ url, fetched, className, level, guild }>}
 */
async function lookupArmory(name, realm = "") {
    const out = { url: armoryUrlFor(name), fetched: false, className: "", level: null, guild: "" };
    try {
        const client = new Blizzard(getConfig().blizzard || {});
        if (!client.isConfigured()) return out;
        const opts = realm ? { realmSlug: realmSlug(realm) } : {};
        const summary = await client.getCharacterSummary(name, opts);
        if (!summary) return out;
        return {
            ...out,
            fetched: true,
            className: profiles.normalizeClass(summary.className),
            level: summary.level || null,
            guild: summary.guild || "",
        };
    } catch {
        return out;
    }
}

module.exports = { profileView, suggestedRoles, effectiveRoles, lookupArmory, realmSlug };
