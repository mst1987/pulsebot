// The permission model behind the admin menu's role settings.
//
// Access is granted per *area* (one admin-menu section) and per *level*:
//   read  — may open the area and load its data (GET /api/*)
//   write — may act in it (POST/PATCH /api/*); implies read
//
// Full admins (ADMIN_USER_ID / the admin roles from the "Zugang" tab) always
// hold every area at write level and are never restricted by this model.
//
// On top of the per-role grants sits the *base access* (config.baseAccess): what
// every logged-in Discord account gets without holding any configured role — the
// same `{ [area]: { read, write } }` shape, merged into the role grants as a
// union, so it can only ever widen access, never narrow it.

// The areas an admin can hand out, in the order they appear in the sidebar.
// `tab` is the sidebar tab id in src/web-client/src/components/Shell.tsx.
const AREAS = [
    { id: "dashboard", tab: "home", label: "Übersicht", description: "Startseite mit Kennzahlen, kommenden und vergangenen Events." },
    { id: "recruitment", tab: "recruitment", label: "Recruitment", description: "Bewerbungs-Vorlagen und gepostete Recruitment-Nachrichten." },
    { id: "cla", tab: "cla", label: "CLA / Logcheck", description: "Log-Auswertungen anstoßen, Reports verwalten und zuordnen." },
    { id: "raids", tab: "raids", label: "Raid-Events", description: "Raid-Events anlegen, Setups füllen, Aufrufe und Softres posten." },
    { id: "roster", tab: "roster", label: "Roster", description: "Charakter-Übersicht der Gilde." },
    { id: "history", tab: "history", label: "Historie & Loot", description: "Loot-Import, Event- und Charakter-Historie." },
    // A slice of the same tab: the loot views without the raid lists, the logs
    // and everything that gets data in. Meant as the base access for members who
    // should be able to look up what dropped without seeing the admin side.
    { id: "loot", tab: "history", label: "Loot-Ansichten", description: "Nur die Loot-Tabs der Historie: Importierter Loot, Latest Loot, Loot-Gründe und Items — ohne Import, Logs und Raid-Listen." },
    { id: "channels", tab: "channels", label: "Kanäle", description: "Discord-Kanäle anlegen und duplizieren." },
    { id: "settings", tab: "settings", label: "Einstellungen", description: "Bot-Konfiguration. Admin-Rollen und Berechtigungen bleiben Voll-Admins vorbehalten." },
];

const AREA_IDS = AREAS.map((a) => a.id);
const LEVELS = ["read", "write"];

/** An access map with nothing granted. */
function emptyAccess() {
    const out = {};
    for (const id of AREA_IDS) out[id] = { read: false, write: false };
    return out;
}

/** An access map with everything granted (full admins). */
function fullAccess() {
    const out = {};
    for (const id of AREA_IDS) out[id] = { read: true, write: true };
    return out;
}

/** Whether an access map grants `level` on `area`. Write implies read. */
function can(access, area, level = "read") {
    const entry = access && access[area];
    if (!entry) return false;
    return level === "write" ? !!entry.write : !!(entry.read || entry.write);
}

/** Whether an access map grants `level` on at least one of `areas`. */
function canAny(access, areas, level = "read") {
    return (areas || []).some((area) => can(access, area, level));
}

/** True when the map grants at least read on at least one area. */
function hasAnyAccess(access) {
    return AREA_IDS.some((id) => can(access, id, "read"));
}

/** The area ids readable with this access map, in sidebar order. */
function readableAreas(access) {
    return AREA_IDS.filter((id) => can(access, id, "read"));
}

/**
 * Normalise a stored/submitted `{ [roleId]: { [area]: { read, write } } }` map:
 * drop unknown areas and empty role ids, coerce the flags to booleans, let write
 * imply read, and drop roles that end up granting nothing. Always returns a
 * plain object.
 */
function normalizeRolePermissions(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [roleId, areas] of Object.entries(raw)) {
        const key = String(roleId).trim();
        if (!key || !areas || typeof areas !== "object" || Array.isArray(areas)) continue;
        const grants = {};
        for (const id of AREA_IDS) {
            const entry = areas[id];
            if (!entry || typeof entry !== "object") continue;
            const write = !!entry.write;
            const read = write || !!entry.read;
            if (read) grants[id] = { read, write };
        }
        if (Object.keys(grants).length) out[key] = grants;
    }
    return out;
}

/**
 * Normalise a stored/submitted `{ [area]: { read, write } }` map (the base
 * access): drop unknown areas, coerce the flags, let write imply read.
 */
function normalizeAreaAccess(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const id of AREA_IDS) {
        const entry = raw[id];
        if (!entry || typeof entry !== "object") continue;
        const write = !!entry.write;
        const read = write || !!entry.read;
        if (read) out[id] = { read, write };
    }
    return out;
}

/** Union of two access maps, as a fresh map — neither input is modified. */
function mergeAccess(a, b) {
    const out = emptyAccess();
    for (const id of AREA_IDS) {
        const write = can(a, id, "write") || can(b, id, "write");
        out[id] = { read: write || can(a, id, "read") || can(b, id, "read"), write };
    }
    return out;
}

/** The access map every logged-in account holds, before any role grants. */
function baseAccessMap(baseAccess) {
    return mergeAccess(emptyAccess(), normalizeAreaAccess(baseAccess));
}

/**
 * Merge the permissions of every role the member holds into one access map —
 * the union, so the most permissive role wins.
 */
function accessForRoles(rolePermissions, roleIds) {
    const access = emptyAccess();
    const perms = normalizeRolePermissions(rolePermissions);
    for (const roleId of roleIds || []) {
        const grants = perms[String(roleId)];
        if (!grants) continue;
        for (const [area, entry] of Object.entries(grants)) {
            if (!access[area]) continue;
            if (entry.read) access[area].read = true;
            if (entry.write) { access[area].write = true; access[area].read = true; }
        }
    }
    return access;
}

/**
 * Whether a session user (see web/auth.js) may read/write the given area.
 * Full admins always may.
 */
function userCan(user, area, level = "read") {
    if (!user) return false;
    if (user.isAdmin) return true;
    return can(user.access, area, level);
}

/** Whether a user may use the admin menu at all (full admin or any granted area). */
function userHasMenuAccess(user) {
    if (!user) return false;
    return !!user.isAdmin || hasAnyAccess(user.access);
}

/** Whether a session user may read/write at least one of the given areas. */
function userCanAny(user, areas, level = "read") {
    return (areas || []).some((area) => userCan(user, area, level));
}

module.exports = {
    AREAS, AREA_IDS, LEVELS,
    emptyAccess, fullAccess, can, canAny, hasAnyAccess, readableAreas,
    normalizeRolePermissions, normalizeAreaAccess, mergeAccess, baseAccessMap, accessForRoles,
    userCan, userCanAny, userHasMenuAccess,
};
