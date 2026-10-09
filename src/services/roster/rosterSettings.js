// A roster's settings from the web (#657, docs/roster-profile.md "Roster
// anlegen und einstellen"): the checks of every field and who may change which.
//
// Permission split:
//   full admin           everything - name, category, game version, Discord
//                        roles (roleIds, trialRoleId), managers, slots,
//                        allowMultipleChars, signupOnly, the linked Kader
//                        (kaderId); creating and deleting
//   manager of a roster  name, slots, allowMultipleChars, signupOnly of that
//                        roster - not its managers, roles, category or version
//                        (an admin-only field sent with a *changed* value
//                        answers 403 "admin_only"; the unchanged value of a
//                        whole form passes)
//   everyone else        403 "not_manager"
//
// Changing roleIds never touches the Discord roles of the existing members:
// the old role stays with them, the new one is not handed out. The reconcile
// of rosterRoleSync.js then adds every holder of the new roles (and skips its
// removals once, as for any changed role list). A roster's roles are mirrored
// into config.categoryRoles of its category (categoryRoles.mirrorCategoryRoles).
//
// Every refusal is a code the web translates (DE/EN): "invalid_name",
// "name_too_long", "bad_request", "invalid_version", "invalid_roles",
// "unknown_role", "invalid_managers", "invalid_slots", "admin_only",
// "category_taken", "kader_taken", "kader_not_found", "not_found".
const rosterStore = require("../../stores/rosterStore");
const { knownVersion } = require("../events/mainVersion");
const { mirrorCategoryRoles } = require("./categoryRoles");

const ADMIN_FIELDS = ["name", "categoryId", "versionId", "roleIds", "trialRoleId", "managers", "slots", "allowMultipleChars", "signupOnly", "kaderId"];
const MANAGER_FIELDS = ["name", "slots", "allowMultipleChars", "signupOnly"];
const SLOT_KEYS = ["total", "tank", "healer", "bench"];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const SNOWFLAKE = /^\d{5,25}$/;

/** A list of Discord ids: `{ value }` or `{ code }` (not a list, a bad id, too many). */
function idList(raw, max, code) {
    if (!Array.isArray(raw)) return { code };
    const out = [];
    for (const v of raw) {
        const id = str(v);
        if (!SNOWFLAKE.test(id)) return { code };
        if (!out.includes(id)) out.push(id);
    }
    return out.length > max ? { code } : { value: out };
}

/** Roles must exist on the server when the server's roles are known (`known` a Set, null = unknown). */
const unknownRole = (ids, known) => !!known && known.size > 0 && ids.some((id) => !known.has(id));

function cleanName(raw) {
    if (typeof raw !== "string") return { code: "invalid_name" };
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length > rosterStore.LIMITS.name) return { code: "name_too_long" };
    return { value: name };
}

function cleanCategory(raw) {
    if (raw === null || raw === "") return { value: null };
    const id = str(raw);
    return SNOWFLAKE.test(id) ? { value: id } : { code: "bad_request" };
}

function cleanSlots(raw, current) {
    if (!isMap(raw)) return { code: "invalid_slots" };
    const out = { ...(current || { total: 0, tank: 0, healer: 0, bench: 0 }) };
    for (const key of SLOT_KEYS) {
        if (raw[key] === undefined) continue;
        const n = Number(raw[key]);
        if (!Number.isInteger(n) || n < 0 || n > rosterStore.LIMITS.slot) return { code: "invalid_slots" };
        out[key] = n;
    }
    if (out.total > 0 && out.tank + out.healer > out.total) return { code: "invalid_slots" };
    return { value: out };
}

function cleanManagers(raw, current) {
    if (!isMap(raw)) return { code: "invalid_managers" };
    const out = { ...(current || { roleIds: [], userIds: [] }) };
    for (const key of ["roleIds", "userIds"]) {
        if (raw[key] === undefined) continue;
        const list = idList(raw[key], rosterStore.LIMITS.managers, "invalid_managers");
        if (list.code) return list;
        out[key] = list.value;
    }
    return { value: out };
}

/** The linked Kader (admins): an id, or null to unlink. Whether it exists is the caller's `kaderKnown`. */
function cleanKader(raw) {
    if (raw === null || raw === "") return { value: null };
    const id = str(raw);
    return typeof raw === "string" && id && id.length <= 32 ? { value: id } : { code: "bad_request" };
}

function cleanBool(raw) {
    return typeof raw === "boolean" ? { value: raw } : { code: "bad_request" };
}

/** The roles: roleIds and trialRoleId, checked together (the trial role is no main role). */
function cleanRoles(p, current, known) {
    const out = {};
    if (p.roleIds !== undefined) {
        const list = idList(p.roleIds, rosterStore.LIMITS.roleIds, "invalid_roles");
        if (list.code) return list;
        out.roleIds = list.value;
    }
    if (p.trialRoleId !== undefined) {
        const id = str(p.trialRoleId);
        if (id && !SNOWFLAKE.test(id)) return { code: "invalid_roles" };
        out.trialRoleId = id || null;
    }
    const roleIds = out.roleIds || (current ? current.roleIds : []);
    const trial = out.trialRoleId !== undefined ? out.trialRoleId : (current ? current.trialRoleId : null);
    if (trial && roleIds.includes(trial)) return { code: "invalid_roles" };
    const touched = [...(out.roleIds || []), ...(out.trialRoleId ? [out.trialRoleId] : [])];
    if (unknownRole(touched, known)) return { code: "unknown_role" };
    return { value: out };
}

/**
 * The settings fields sent, checked: `{ fields }` (only the fields present,
 * slots and managers merged onto `current`) or `{ code }`. Unknown fields are
 * ignored.
 * @param {object} raw
 * @param {{ current?: object|null, knownRoleIds?: Set<string>|null }} [opts]
 */
function cleanSettings(raw, { current = null, knownRoleIds = null } = {}) {
    const p = isMap(raw) ? raw : {};
    const fields = {};
    const steps = [
        ["name", () => cleanName(p.name)],
        ["categoryId", () => cleanCategory(p.categoryId)],
        ["versionId", () => (knownVersion(p.versionId) ? { value: knownVersion(p.versionId) } : { code: "invalid_version" })],
        ["slots", () => cleanSlots(p.slots, current && current.slots)],
        ["managers", () => cleanManagers(p.managers, current && current.managers)],
        ["allowMultipleChars", () => cleanBool(p.allowMultipleChars)],
        ["signupOnly", () => cleanBool(p.signupOnly)],
        ["kaderId", () => cleanKader(p.kaderId)],
    ];
    for (const [key, check] of steps) {
        if (p[key] === undefined) continue;
        const result = check();
        if (result.code) return { code: result.code };
        fields[key] = result.value;
    }
    const roles = cleanRoles(p, current, knownRoleIds);
    if (roles.code) return { code: roles.code };
    Object.assign(fields, roles.value);
    if (current && fields.name === "") return { code: "invalid_name" };
    return { fields };
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/** The admin-only fields among `fields` whose value differs from `current`. */
function adminOnlyChanges(fields, current) {
    return Object.keys(fields).filter((k) => !MANAGER_FIELDS.includes(k) && !same(fields[k], current[k]));
}

/**
 * Change a roster's settings (POST /api/rosters/update). `isAdmin`: a full
 * admin; anyone else must already be known as a manager of this roster (the
 * route asks rosterAccess.canManageRosterLive before).
 * @returns {{ ok: true, roster: object, trimmedChars: number } | { ok: false, code: string }}
 */
function updateRosterSettings(rosterId, raw, { isAdmin = false, actor = "", knownRoleIds = null, kaderKnown = null } = {}) {
    const current = rosterStore.getRoster(rosterId);
    if (!current) return { ok: false, code: "not_found" };
    const clean = cleanSettings(raw, { current, knownRoleIds });
    if (clean.code) return { ok: false, code: clean.code };
    if (!isAdmin && adminOnlyChanges(clean.fields, current).length) return { ok: false, code: "admin_only" };
    const kaderId = clean.fields.kaderId;
    if (kaderId && kaderId !== current.kaderId && typeof kaderKnown === "function" && !kaderKnown(kaderId)) return { ok: false, code: "kader_not_found" };
    // switching "mehrere Charaktere" off keeps each member's first character only (the store cuts the rest)
    const trimmedChars = clean.fields.allowMultipleChars === false && current.allowMultipleChars
        ? Object.values(current.members).filter((m) => m.chars.length > 1).length
        : 0;
    let roster;
    try {
        roster = rosterStore.updateRoster(current.id, clean.fields, { actor });
    } catch (e) {
        if (e && e.name === "RosterError") return { ok: false, code: e.code };
        throw e;
    }
    if (clean.fields.roleIds !== undefined || clean.fields.categoryId !== undefined) mirrorCategoryRoles(roster);
    return { ok: true, roster, trimmedChars };
}

module.exports = { cleanSettings, adminOnlyChanges, updateRosterSettings, ADMIN_FIELDS, MANAGER_FIELDS, SNOWFLAKE };
