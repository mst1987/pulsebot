// How a raider profile goes out over the API (#255) — and, above all, what it
// leaves out.
//
// The same stored profile is served twice: to its owner ("Mein Profil") and to
// the orga (roster, read-only). The difference is the wishes: "gerne zusammen
// raiden mit" is between the raider and the orga. A member sees whom *they*
// wished for, never whom anybody wished for them and never whether a wish is
// mutual — that would reveal the other raider's wishes. Only `forOrga` adds
// `mutual` and `wishedBy`. "Nicht mit X raiden" (`avoid`) is stricter still:
// there is no reverse list at all, not even for the orga — only the setup
// proposal reads it, and only when the orga asks for it.
//
// Part 2 (docs/roster-profile.md): the hours per weekday (`availabilityFrom`),
// the professions and the wish items of each character go to the owner and the
// orga only - every caller of profileView is one of them (the own profile, the
// orga's profile and character views).

const { getConfig } = require("../../stores/settingsStore");
const { armoryUrlFor } = require("./charLinks");
const { blizzardFor } = require("../../services/versions/versionSettings");
const { mainVersionFor } = require("../../services/versions/mainVersion");
const profiles = require("../../stores/raiderProfileStore");
const { specEvidence, logIndex } = require("./profileLogs");
const { characterEvidence, seenIndex } = require("../../services/characters/characterEvidence");
const { wishItemView } = require("../../services/characters/wishItems");

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

/** What the specs of all characters allow. */
function suggestedRoles(profile) {
    return profiles.specRoles(profile.characters);
}

/**
 * The switches across the whole profile — true when *any* character may step
 * in. The switches themselves live on the characters (characterRoles); this is
 * the one-line summary of the bot's /profil. Without characters only the old
 * profile-wide word counts.
 */
function effectiveRoles(profile) {
    const suggested = suggestedRoles(profile);
    const per = profile.characters.map((c) => profiles.characterRoles(profile, c));
    const any = (field) => (per.length ? per.some((r) => r[field]) : profile[field] === true);
    return { canOfftank: any("canOfftank"), canHeal: any("canHeal"), suggested };
}

/**
 * The API shape of a profile. `forOrga` adds who wished for this raider and
 * which wishes are mutual; without it no other profile's wishes are touched.
 * `guildId` is the server the page is shown for (#923): its own armory
 * template wins over the version's standard.
 */
function profileView(profile, { forOrga = false, index = logIndex(), all = profiles.listProfiles(), seen = seenIndex(), guildId = "" } = {}) {
    const byId = new Map(all.map((p) => [p.userId, p]));
    // another raider is named by their first character of the main game version
    const config = getConfig();
    const preferVersion = mainVersionFor({ config });
    const characters = profile.characters.map((c) => {
        const roles = profiles.characterRoles(profile, c);
        return {
            key: c.key,
            name: c.name,
            // #543: the page groups by it, the signup offers only the event's version.
            versionId: c.versionId,
            realm: c.realm,
            className: c.className,
            source: c.source,
            armory: c.armory,
            armoryUrl: armoryUrlFor(c.name, c.versionId, guildId),
            // does it exist in game (log, loot, armory, orga)? An unconfirmed one gets no guild bank mail
            evidence: characterEvidence(c, { index: seen }),
            specs: c.specs.map((s) => specView(c, s, index)),
            canOfftank: roles.canOfftank,
            canHeal: roles.canHeal,
            suggested: roles.suggested,
            possible: roles.possible,
            professions: c.professions || [],
            wishItems: (c.wishItems || []).map((w) => wishItemView(w, c.versionId, { config })),
            claimedBy: all
                .filter((p) => p.userId !== profile.userId && p.characters.some((o) => o.key === c.key))
                .map((p) => ({ userId: p.userId, name: p.name })),
        };
    });
    const refOf = (id) => {
        const other = byId.get(id);
        return other ? profiles.raiderRef(other, { preferVersion }) : { userId: id, name: "", character: "", className: "" };
    };
    const wishes = profile.wishes.map((id) => {
        const other = byId.get(id);
        const ref = refOf(id);
        return forOrga ? { ...ref, mutual: !!(other && other.wishes.includes(profile.userId)) } : ref;
    });
    const view = {
        userId: profile.userId,
        name: profile.name,
        characters,
        ...effectiveRoles(profile),
        availability: profile.availability,
        availabilityFrom: profile.availabilityFrom || {},
        preferredRaids: profile.preferredRaids,
        wishes,
        // Like the wishes: the owner sees whom *they* named, never who named them.
        avoidEnabled: profile.avoidEnabled,
        avoid: profile.avoid.map(refOf),
        note: profile.note,
        updatedAt: profile.updatedAt,
    };
    if (forOrga) {
        view.wishedBy = all
            .filter((p) => p.userId !== profile.userId && p.wishes.includes(profile.userId))
            .map((p) => profiles.raiderRef(p, { preferVersion }));
    }
    return view;
}

/** "Die Aldor" -> "die-aldor", the realm slug the profile API wants. */
function realmSlug(realm) {
    return String(realm || "").trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
}

/**
 * Link a character with the armory: the link always (from the template of the
 * character's version, Einstellungen → Spielversion, #542/#543), plus class,
 * level and guild when the Blizzard API is configured for that version and
 * answers. Any failure means link only — never an error.
 * `guildId` (#923): the server asking - its own realm and armory template win.
 * @returns {Promise<{ url, fetched, className, level, guild }>}
 */
async function lookupArmory(name, realm = "", versionId = undefined, { guildId = "" } = {}) {
    const out = { url: armoryUrlFor(name, versionId, guildId), fetched: false, className: "", level: null, guild: "" };
    try {
        const { client } = blizzardFor(versionId, { config: getConfig(), guildId });
        if (!client) return out;
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
