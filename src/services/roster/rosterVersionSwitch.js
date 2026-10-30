// What a category's switch to another game version does to its roster (#739,
// docs/roster-profile.md "Roster je Version"). One roster per category and
// version (rosterStore), so the switch starts a new section here too:
//
//   - the roster of the old version is CLOSED (rosterStore.closeRoster, reason
//     "version_switch"): it stays readable under its version, takes no new
//     members and no edits, and its Discord roles are never synced again —
//     nobody loses a role through the switch;
//   - a roster of the new version that was closed by an earlier switch (the
//     category goes back) is opened again;
//   - otherwise, when the dialog asked for it (`choice.create`), a roster for
//     the new version is created from the old one's settings (name, server,
//     managers, places, switches, Loot-Council profile and the Kader link -
//     closing released it -, no trial role) with the Discord roles picked in the dialog (none by
//     default). "Personen übernehmen" (`choice.copyMembers`) copies the old
//     members as status trial ("Probe"; a paused one stays paused) WITHOUT a
//     character: everybody picks their character of the new version himself.
//     No Discord role is given or taken - the Abgleich tab lists who lacks
//     the new role;
//   - config.categoryRoles then mirrors the roster of the new version (its
//     roles, none without one) - only when the old version had a roster, whose
//     roles the setting mirrored until now.
//
// It runs through categorySwitch.onCategoryVersionSwitch: the settings route
// (PATCH /api/settings) saves the switch, then calls the listeners with the
// dialog's choices (`ctx.fixes[categoryId].roster`) in the same request — no
// second request that could fail after the switch. registerRosterVersionSwitch()
// hooks it in once at start (src/bot.js). switchRosterPreview() tells the
// dialog what will happen.
const rosterStore = require("../../stores/roster/rosterStore");
const { onCategoryVersionSwitch } = require("../categories/categorySwitch");
const { mirrorCategoryRoles } = require("./categoryRoles");
const logger = require("../../logger").child("rosterSwitch");

const REASON = "version_switch";
const SNOWFLAKE = /^\d{5,25}$/;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The dialog's roster choice, cleaned: `{ create, copyMembers, roleIds }` (create and copy on unless said otherwise). */
function cleanChoice(raw) {
    const c = isMap(raw) ? raw : {};
    const roleIds = (Array.isArray(c.roleIds) ? c.roleIds : []).map(str).filter((id, i, all) => SNOWFLAKE.test(id) && all.indexOf(id) === i);
    return {
        create: c.create !== false,
        copyMembers: c.copyMembers !== false,
        roleIds: roleIds.slice(0, rosterStore.LIMITS.roleIds),
    };
}

/** The members of the old roster as they start in the new one: trial (pause stays pause), no character. */
function copiedMembers(old, { actor, now }) {
    const out = {};
    for (const [userId, m] of Object.entries(old.members || {})) {
        out[userId] = {
            status: m.status === "pause" ? "pause" : "trial",
            since: now,
            by: actor,
            chars: [],
            charNames: {},
            note: m.note || "",
            spec: "",
            trialUntil: null,
        };
    }
    return out;
}

/** A new roster for `toVersion` from the old one's settings; null when the store refuses. */
function createFrom(old, toVersion, choice, { actor, now, kaderId = "" }) {
    const members = choice.copyMembers ? copiedMembers(old, { actor, now }) : {};
    try {
        const created = rosterStore.createRoster({
            guildId: old.guildId,
            name: old.name,
            categoryId: old.categoryId,
            versionId: toVersion,
            roleIds: choice.roleIds,
            trialRoleId: null,
            managers: old.managers,
            slots: old.slots,
            allowMultipleChars: old.allowMultipleChars,
            signupOnly: old.signupOnly,
            publicRaids: old.publicRaids,
            lootProfileId: old.lootProfileId,
            source: { kind: "manual" },
            // the Kader link moves along (closing released it from the old roster)
            kaderId: kaderId || null,
            members,
        }, { actor, now });
        const count = Object.keys(created.members).length;
        if (count) rosterStore.appendHistory(created.id, { by: actor, what: "members-copied", detail: `${count} · ${old.name}` }, { now });
        return rosterStore.getRoster(created.id);
    } catch (e) {
        if (e && e.name === "RosterError") {
            logger.warn(`roster for ${old.categoryId} (${toVersion}) not created: ${e.code}`);
            return null;
        }
        throw e;
    }
}

/**
 * Apply a switch to the rosters (head comment). Never throws for a refusal.
 * @param {{ categoryId: string, fromVersion: string, toVersion: string, at?: number }} sw
 * @param {{ choice?: object, actor?: string, now?: string }} [opts]
 * @returns {{ closed: { id, name } | null, reopened: { id, name } | null, created: { id, name, members } | null, mirrored: boolean }}
 */
function applyRosterSwitch(sw, { choice, actor = "", now = new Date().toISOString() } = {}) {
    const out = { closed: null, reopened: null, created: null, mirrored: false };
    const categoryId = str(sw && sw.categoryId);
    if (!categoryId || !sw.toVersion || sw.toVersion === sw.fromVersion) return out;
    const wanted = cleanChoice(choice);
    const old = sw.fromVersion ? rosterStore.rosterForCategory(categoryId, sw.fromVersion) : null;
    const kaderId = (old && old.kaderId) || "";
    if (old && !old.closedAt) {
        const closed = rosterStore.closeRoster(old.id, { reason: REASON, actor, now });
        out.closed = { id: closed.id, name: closed.name };
    }
    let next = rosterStore.rosterForCategory(categoryId, sw.toVersion);
    if (next && next.closedAt && next.closedReason === REASON) {
        next = rosterStore.reopenRoster(next.id, { actor, now });
        out.reopened = { id: next.id, name: next.name };
    } else if (!next && old && wanted.create) {
        next = createFrom(old, sw.toVersion, wanted, { actor, now, kaderId });
        if (next) out.created = { id: next.id, name: next.name, members: Object.keys(next.members).length };
    }
    // the settings value follows the roster of the new version - only where it mirrored a roster until now
    if (old || (next && !next.closedAt)) {
        out.mirrored = mirrorCategoryRoles(next && !next.closedAt ? next : { categoryId, roleIds: [] });
    }
    return out;
}

/**
 * What the switch dialog says about the roster (GET /api/settings/category-switch):
 * the roster that will be closed, the one of the new version that already
 * exists (and is opened again when a switch closed it), and whether a new one
 * can be created.
 * @returns {{ closing: { id, name, members } | null, existing: { id, name, closed, reopens } | null, canCreate: boolean }}
 */
function switchRosterPreview(categoryId, { fromVersion, toVersion } = {}) {
    const cat = str(categoryId);
    if (!cat || !toVersion || toVersion === fromVersion) return { closing: null, existing: null, canCreate: false };
    const old = fromVersion ? rosterStore.rosterForCategory(cat, fromVersion) : null;
    const next = rosterStore.rosterForCategory(cat, toVersion);
    return {
        closing: old && !old.closedAt ? { id: old.id, name: old.name, members: Object.keys(old.members).length } : null,
        existing: next ? { id: next.id, name: next.name, closed: !!next.closedAt, reopens: !!next.closedAt && next.closedReason === REASON } : null,
        canCreate: !!old && !next,
    };
}

// The old roster's managers as the simulation counts them in the new one: from an open old
// roster their roles are no new right (the guard knows them under the old id), so they are left out.
function carriedManagers(old) {
    const managers = isMap(old.managers) ? old.managers : {};
    return old.closedAt ? managers : { ...managers, roleIds: [] };
}

/**
 * The rosters and raider roles as `switches` would leave them, without writing anything -
 * the same steps as applyRosterSwitch, for a check before the save (#930: pugRoleGuard).
 * A roster to be created has the id "" and only what grants a right: server, roles and
 * the old roster's manager roles (createFrom takes them along) - only from a closed old roster,
 * from an open one they are no new right (carriedManagers). `reopened` names the rosters a switch back
 * would open again, for the refusal's way out.
 * @param {{ categoryId: string, fromVersion: string, toVersion: string }[]} switches
 * @param {object} [fixes] the dialog's choices (`fixes[categoryId].roster`)
 * @returns {{ rosters: object[], categoryRoles: { [categoryId: string]: string[] }, reopened: { id, name, categoryId }[] }}
 */
function rostersAfterSwitches(switches, fixes = {}) {
    const byId = new Map(rosterStore.listRosters().map((r) => [r.id, r]));
    const created = [];
    const reopened = [];
    const categoryRoles = {};
    for (const sw of Array.isArray(switches) ? switches : []) {
        const categoryId = str(sw && sw.categoryId);
        if (!categoryId || !sw.toVersion || sw.toVersion === sw.fromVersion) continue;
        const fix = isMap(fixes) && isMap(fixes[categoryId]) ? fixes[categoryId] : {};
        const wanted = cleanChoice(fix.roster);
        const old = sw.fromVersion ? rosterStore.rosterForCategory(categoryId, sw.fromVersion) : null;
        if (old && !old.closedAt) byId.set(old.id, { ...old, closedAt: "pending", closedReason: REASON });
        let next = rosterStore.rosterForCategory(categoryId, sw.toVersion);
        if (next && next.closedAt && next.closedReason === REASON) {
            next = { ...next, closedAt: null, closedReason: null };
            byId.set(next.id, next);
            reopened.push({ id: next.id, name: next.name, categoryId });
        } else if (!next && old && wanted.create) {
            next = { id: "", guildId: old.guildId, name: old.name, categoryId, versionId: sw.toVersion, roleIds: wanted.roleIds, trialRoleId: null, managers: carriedManagers(old), members: {} };
            created.push(next);
        }
        if (old || (next && !next.closedAt)) categoryRoles[categoryId] = next && !next.closedAt ? (next.roleIds || []).map(String) : [];
    }
    return { rosters: [...byId.values(), ...created], categoryRoles, reopened };
}

/** The listener (categorySwitch hook): the dialog's choice from `ctx.fixes`, the result merged into the switch. */
function onSwitch(sw, ctx = {}) {
    const fixes = isMap(ctx.fixes) ? ctx.fixes : {};
    const fix = isMap(fixes[sw.categoryId]) ? fixes[sw.categoryId] : {};
    const actor = str(ctx.user && ctx.user.id);
    const roster = applyRosterSwitch(sw, { choice: fix.roster, actor, now: new Date(Number(sw.at) || Date.now()).toISOString() });
    const parts = [
        roster.closed ? `Roster ${roster.closed.name} abgeschlossen` : "",
        roster.reopened ? `Roster ${roster.reopened.name} wieder offen` : "",
        roster.created ? `Roster ${roster.created.name} (${sw.toVersion}) angelegt, ${roster.created.members} Person(en) übernommen` : "",
    ].filter(Boolean);
    if (parts.length) logger.info(`Kategorie ${sw.name || sw.categoryId}: ${parts.join(", ")} (#739)`);
    return { roster };
}

let unregister = null;

/** Hook the roster into category switches - once (idempotent). Returns the unregister function. */
function registerRosterVersionSwitch() {
    if (!unregister) {
        const off = onCategoryVersionSwitch(onSwitch);
        unregister = () => {
            off();
            unregister = null;
        };
    }
    return unregister;
}

module.exports = { applyRosterSwitch, switchRosterPreview, rostersAfterSwitches, registerRosterVersionSwitch, onSwitch, cleanChoice, REASON };
