// PuG onboarding roles must not unlock anything (#930, follow-up of #906): every member
// takes the version and class roles of the onboarding (config.pugRoles[guildId].versions /
// .classes) themselves, so such a role in a field that grants rights would hand that right
// to anyone who clicks. The fields are the ones selfRole.roleUses reads (full admin, orga,
// officer, area rights, bot commands, raider roles of a category, role sync, the roles of a
// roster) — no second list here.
//
// `newGrants` compares the config and the rosters before and after a save: only a right
// the save adds is refused (apiRoutes/settings.js, roster/rosterSettings.js,
// roster/rosterCreate.js with the code "pug_onboarding_role"), an old one stays and is
// what `leftovers` reports to the Bot-Check (services/discord/botCheck.js). Without
// config.pugRoles nothing changes. A roster of another server does not count: the role
// does not exist there.
const { roleUses } = require("./selfRole");
const { VERSIONS } = require("../../config/gameVersions");
const { CLASSES } = require("../../config/gameVersions/classes");
const rosterStore = require("../../stores/rosterStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

const KIND_TEXT = { version: "PuG-Versionsrolle", class: "PuG-Klassenrolle" };
const ROSTER_KIND_TEXT = { member: "Mitglied", trial: "Probe", manager: "Manager" };

function labelOf(kind, id) {
    if (kind === "version") {
        const v = VERSIONS.find((x) => x.id === id);
        return v ? v.label : id;
    }
    const c = CLASSES.find((x) => x.id === id);
    return c ? c.label : id;
}

/**
 * Every role the PuG onboarding hands out, over all servers:
 * Map roleId -> { guildId, kind: "version"|"class", id, label }.
 * @param {object} config the bot config
 * @returns {Map<string, object>}
 */
function onboardingRoles(config) {
    const out = new Map();
    const all = config && config.pugRoles && typeof config.pugRoles === "object" ? config.pugRoles : {};
    for (const [guildId, entry] of Object.entries(all)) {
        for (const [kind, field] of [["version", "versions"], ["class", "classes"]]) {
            const map = entry && entry[field] && typeof entry[field] === "object" ? entry[field] : {};
            for (const [id, roleId] of Object.entries(map)) {
                const rid = str(roleId);
                if (rid && !out.has(rid)) out.set(rid, { guildId: str(guildId), kind, id, label: labelOf(kind, id) });
            }
        }
    }
    return out;
}

/**
 * The rights the role carries (selfRole.roleUses) without its own onboarding purpose. For
 * an `item` of the onboarding (pugOnboarding.privilegeOf) the PuG version role of that very
 * version is no right, a class role being a version role is one. With no `item` the PuG
 * version use is dropped entirely: config.pugRoles is no field to guard.
 * @param {object} config
 * @param {string} roleId
 * @param {{ item?: { kind: string, id: string }|null, rosters?: object[] }} [opts]
 * @returns {object[]}
 */
function grantsOf(config, roleId, { item = null, rosters } = {}) {
    const own = (u) => !!item && item.kind === "version" && (u.versionIds || []).every((v) => v === item.id);
    return roleUses(config, roleId, { rosters }).filter((u) => u.code !== "pugVersion" || (item ? !own(u) : false));
}

// One key per single right, so a save that adds one more is told apart from an old one.
function keysOf(use) {
    switch (use.code) {
        // write implies read: read -> read+write adds the key ":write"
        case "rolePermissions": return use.areas.flatMap((a) => (((use.levels || {})[a] === "write") ? ["read", "write"] : ["read"])
            .map((level) => ({ key: `rolePermissions:${a}:${level}`, code: use.code, detail: a, level })));
        case "botCommand": return use.commands.map((c) => ({ key: `botCommand:${c}`, code: use.code, detail: c }));
        case "categoryRaider": return use.categoryIds.map((c) => ({ key: `categoryRaider:${c}`, code: use.code, detail: c }));
        // one key per pair: a second partner role is a new right
        case "roleSync": return (use.pairs || []).map((p) => ({ key: `roleSync:${p.guildId}:${p.roleId}`, code: use.code, detail: p.guildId, partnerRoleId: p.roleId }));
        case "roster": return use.kinds.map((k) => ({ key: `roster:${use.rosterId}:${k}`, code: use.code, detail: use.name || use.rosterId, kind: k }));
        default: return [{ key: use.code, code: use.code, detail: "" }];
    }
}

function storedRosters() {
    try {
        return rosterStore.listRosters();
    } catch {
        return [];
    }
}

// The rights of an onboarding role of `guildId`; a roster of another server does not count,
// nor does a closed one (it unlocks nothing; reopening it then counts as a new right).
// `rosters` undefined = the stored ones.
function usesOn(config, roleId, guildId, rosters) {
    const own = (rosters === undefined ? storedRosters() : rosters || [])
        .filter((r) => r && !r.closedAt && (!str(r.guildId) || !guildId || str(r.guildId) === guildId));
    return grantsOf(config, roleId, { rosters: own });
}

const grantKeys = (config, roleId, guildId, rosters) => usesOn(config, roleId, guildId, rosters).flatMap(keysOf);

const GRANT_TEXT = {
    admin: () => "Voll-Admin-Rolle",
    orga: () => "Orga-Rolle",
    officer: () => "Offiziers-Rolle (Bewerbungen)",
    rolePermissions: (g) => `Bereichsrecht ${g.detail}${g.level ? ` (${g.level === "write" ? "schreiben" : "lesen"})` : ""}`,
    botCommand: (g) => `Bot-Befehl /${g.detail}`,
    categoryRaider: () => "Raider-Rolle einer Kategorie",
    roleSync: (g) => `Rollen-Abgleich zwischen den Servern${g.partnerRoleId ? ` (mit Rolle ${g.partnerRoleId})` : ""}`,
    roster: (g) => `Roster ${g.detail} (${ROSTER_KIND_TEXT[g.kind] || g.kind})`,
};

/** The German text of one right, e.g. "Orga-Rolle" or "Roster Kara (Manager)". */
const grantText = (g) => (GRANT_TEXT[g.code] ? GRANT_TEXT[g.code](g) : g.code);

/**
 * The rights a save adds to an onboarding role (empty when it adds none or there are no
 * onboarding roles). The onboarding roles are those of `after` and of `before`; rosters
 * left out are the stored ones.
 * @param {{ before: object, after: object, rostersBefore?: object[], rostersAfter?: object[] }} opts
 * @returns {{ roleId: string, guildId: string, kind: string, id: string, label: string, grants: object[] }[]}
 */
function newGrants({ before = {}, after = {}, rostersBefore, rostersAfter } = {}) {
    const roles = onboardingRoles(before);
    for (const [rid, info] of onboardingRoles(after)) roles.set(rid, info);
    const out = [];
    for (const [roleId, info] of roles) {
        const had = new Set(grantKeys(before, roleId, info.guildId, rostersBefore).map((g) => g.key));
        const added = grantKeys(after, roleId, info.guildId, rostersAfter).filter((g) => !had.has(g.key));
        if (added.length) out.push({ roleId, ...info, grants: added });
    }
    return out;
}

/** The refusal text of `newGrants`' findings (German, like every settings error). */
function refusalMessage(found) {
    const parts = (found || []).map((f) => `„${f.label}“ (${KIND_TEXT[f.kind] || f.kind}): ${f.grants.map(grantText).join(", ")}`);
    return `Rollen aus dem PuG-Onboarding holt sich jeder selbst – sie dürfen nichts freischalten. Betroffen: ${parts.join("; ")}.`;
}

/**
 * Onboarding roles of one server (all servers without `guildId`) that carry a right
 * anyway (saved before the guard or written by hand). For the Bot-Check: `uses` in the shape
 * of selfRole.roleUses (the web words them like the roles page), `grants` in German.
 * @returns {{ id: string, guildId: string, kind: string, itemId: string, label: string, uses: object[], grants: string[] }[]}
 */
function leftovers(config, guildId = "", rosters = undefined) {
    const gid = str(guildId);
    const out = [];
    for (const [roleId, info] of onboardingRoles(config)) {
        if (gid && info.guildId !== gid) continue;
        const uses = usesOn(config, roleId, info.guildId, rosters);
        if (!uses.length) continue;
        const keys = uses.flatMap(keysOf);
        // an area with write shows once, as write
        const shown = keys.filter((g) => g.level !== "read" || !keys.some((o) => o.code === g.code && o.detail === g.detail && o.level === "write"));
        out.push({ id: roleId, guildId: info.guildId, kind: info.kind, itemId: info.id, label: info.label, uses, grants: shown.map(grantText) });
    }
    return out;
}

module.exports = { onboardingRoles, grantsOf, newGrants, refusalMessage, leftovers, grantText };
