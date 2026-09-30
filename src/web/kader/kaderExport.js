// The read-only snapshot the local Kaderbau app (roster builder) pulls through
// GET /api/kader/export — see docs/kaderbau.md for the contract, the value
// vocabularies and the privacy rules.
//
// Everything here is derived on read from what the bot already keeps: the game
// version's rule set, the members of the event server, the raider profiles and
// the attendance of the version's raid nights. Nothing is stored for it.
//
// Privacy: a profile leaves this module as a whitelist of fields — characters,
// their specs and gear, the tank/heal switches, the main flag and the raid days.
// Never `avoid`/`avoidEnabled`, wishes, the note, preferred raids, calendar
// tokens or who else claims a character (test/web/kader/kaderExport.test.js
// scans the payload for them).
const { rulesFor } = require("../../config/gameVersions");
const { buildClasses } = require("../../config/gameVersions/classes");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { buildAttendanceContext, attendanceForAccounts } = require("../../services/characters/rosterAttendance");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const profiles = require("../../stores/raiderProfileStore");
const { logIndex } = require("../characters/profileLogs");
const { serverDateTime } = require("../../utils/time");

const FORMAT = "eventhelper-kader";
const FORMAT_VERSION = 1;
// Forever is what the Kaderbau is built for (launch Nov 2026); an install
// without that rule set falls back to its main version.
const PREFERRED_VERSION = "forever";

/** The version an export is for: the asked one (null when unknown), else forever, else the main version. */
function exportVersion(raw) {
    const asked = String(raw || "").trim();
    if (asked) return rulesFor(asked) ? asked : null;
    return rulesFor(PREFERRED_VERSION) ? PREFERRED_VERSION : mainVersionFor();
}

/** Classes and specs of a rule set, keys as the profiles store them ("Warrior", "Warrior-Protection"). */
function exportClasses(rules) {
    return buildClasses(rules.classes).map((c) => ({
        key: c.id,
        name: c.label,
        nameEn: c.labelEn,
        color: c.color,
        icon: c.icon || "",
        specs: c.specs.map((s) => ({
            key: s.key,
            name: s.label,
            nameEn: s.labelEn,
            role: s.role,
            canTank: s.canTank,
            canHeal: s.canHeal,
            icon: s.icon || "",
        })),
    }));
}

function exportInstances(rules) {
    return rules.instances.map((i) => ({
        id: i.id,
        name: i.name,
        short: i.short || i.name,
        sizes: Array.isArray(i.sizes) ? [...i.sizes] : [],
        defaultSize: i.defaultSize || (Array.isArray(i.sizes) ? i.sizes[0] : 0) || 0,
        status: i.status || "complete",
    }));
}

/** The name part of a character key ("forever~aldric sturmwind" -> "aldric sturmwind"): logs know no version. */
function logSpecsOf(character, index) {
    const entry = index.get(profiles.nameKey(character.key)) || index.get(profiles.nameKey(character.name));
    return entry && entry.specKey && entry.className === character.className ? [entry.specKey] : [];
}

/** One profile, whitelisted, with only the characters of the version — null when it has none. */
function exportProfile(profile, versionId, index) {
    const chars = profiles.charactersOfVersion(profile, versionId);
    if (!chars.length) return null;
    // The stored main is one per account across all versions; inside this
    // version the first character stands in when the main plays another one.
    const mainKey = (chars.find((c) => c.main) || chars[0]).key;
    return {
        userId: profile.userId,
        characters: chars.map((c) => {
            const roles = profiles.characterRoles(profile, c);
            return {
                key: c.key,
                name: c.name,
                className: c.className,
                realm: c.realm || "",
                specs: (c.specs || []).map((s) => ({ spec: s.key, gear: s.gear })),
                main: c.key === mainKey,
                canTank: !!roles.canOfftank,
                canHeal: !!roles.canHeal,
                logSpecs: logSpecsOf(c, index),
            };
        }),
        availability: [...(profile.availability || [])],
    };
}

/**
 * Attendance per Discord account over the version's raid nights, every raid
 * category of the guild summed up. Each category counts its last RAID_WINDOW
 * nights with evidence (rosterAttendance.js), so the list stays bounded.
 */
function exportAttendance(guildId, versionId, accounts, nowSec) {
    const ctx = buildAttendanceContext(guildId, { versionId, now: nowSec });
    const byUser = new Map(accounts.map((a) => [a.userId, []]));
    for (const categoryId of ctx.raidsByCategory.keys()) {
        for (const [userId, result] of attendanceForAccounts(ctx, categoryId, accounts, { nights: true })) {
            byUser.get(userId).push(...(result.raids || []));
        }
    }
    return accounts.map(({ userId }) => {
        const nights = byUser.get(userId)
            .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
            .map((r) => {
                const dt = serverDateTime(r.startTime);
                return {
                    date: dt ? dt.toISODate() : "",
                    eventId: r.eventId,
                    title: r.title || "",
                    attended: !!r.attended,
                    reason: r.attended ? null : (r.reason || null),
                };
            });
        const attended = nights.filter((n) => n.attended).length;
        return {
            userId,
            attended,
            counted: nights.length,
            rate: nights.length ? Math.round((attended / nights.length) * 100) / 100 : null,
            nights,
        };
    });
}

/**
 * The whole export for one version.
 * @param {{ versionId: string, guildId?: string, now?: number }} opts  `now` in ms
 */
async function buildKaderExport({ versionId, guildId = guildRoles.eventGuildId(), now = Date.now() } = {}) {
    const rules = rulesFor(versionId);
    if (!rules) throw new Error(`unknown version ${versionId}`);
    const warnings = [];

    let members = [];
    if (!guildId) {
        warnings.push("Kein Event-Server konfiguriert - Mitgliederliste leer.");
    } else {
        const listed = await discord.listHumanMembers(guildId);
        if (listed.error) warnings.push(`Mitgliederliste nicht verfügbar (GuildMembers-Intent aktiv? Bot verbunden?): ${listed.error}`);
        members = listed.members.map((m) => ({ userId: m.id, displayName: m.displayName, avatarUrl: m.avatarUrl || null }));
    }

    const index = logIndex();
    const exported = profiles.listProfiles()
        .map((p) => exportProfile(p, versionId, index))
        .filter(Boolean)
        .sort((a, b) => a.userId.localeCompare(b.userId));

    const accounts = exported.map((p) => ({
        userId: p.userId,
        chars: p.characters.map((c) => ({ name: c.name, className: c.className, manual: true })),
    }));
    let attendance = [];
    try {
        attendance = exportAttendance(guildId, versionId, accounts, Math.floor(now / 1000));
    } catch (e) {
        warnings.push(`Anwesenheit nicht verfügbar: ${(e && e.message) || e}`);
    }

    return {
        format: FORMAT,
        v: FORMAT_VERSION,
        generatedAt: new Date(now).toISOString(),
        guildId: guildId || "",
        versionId,
        classes: exportClasses(rules),
        instances: exportInstances(rules),
        members,
        profiles: exported,
        attendance,
        warnings,
    };
}

module.exports = { buildKaderExport, exportVersion, FORMAT, FORMAT_VERSION, PREFERRED_VERSION };
