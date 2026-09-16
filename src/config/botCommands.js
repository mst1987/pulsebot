// Who may use which bot command (slash command, button, select, modal).
//
// Every file under src/commands/ declares one of two things:
//   * `group` + `defaultAccess` — a command of its own, listed in
//     Einstellungen → Berechtigungen → Bot-Befehle. `defaultAccess` is what the
//     code proposes: "everyone" | "admins" | { roles: [roleId, …] }.
//   * `accessOf: "<command name>"` — a button, select or modal that belongs to
//     that command and inherits its access. There is no separate setting per
//     button: the "Weiter" of a flow needs the same roles as its start.
//
// What an admin sets in the menu is stored as
//   config.botCommandAccess = { [commandName]: { mode, roleIds } }
// and wins over `defaultAccess`. Admins (ADMIN_USER_ID and the admin roles from
// Zugang) may always use everything. A command with neither a stored setting
// nor a default is admin-only — fail-closed, see web/botAccess.js.

/** The groups of the Bot-Befehle view, in display order. */
const BOT_COMMAND_GROUPS = [
    { id: "raids", label: "Raids & Events", icon: "inv_misc_note_02" },
    { id: "signup", label: "Anmeldung", icon: "inv_misc_book_09" },
    { id: "channels", label: "Kanäle", icon: "inv_letter_15" },
    { id: "logs", label: "Logs & Auswertung", icon: "inv_misc_pocketwatch_01" },
    { id: "loot", label: "Loot", icon: "inv_misc_bag_10" },
    { id: "auctions", label: "Auktionen & GDKP", icon: "inv_misc_coin_02" },
    { id: "recruitment", label: "Recruitment", icon: "inv_misc_grouplooking" },
];

const GROUP_IDS = BOT_COMMAND_GROUPS.map((g) => g.id);
const MODES = ["everyone", "roles", "admins"];

const SNOWFLAKE = /^\d{17,20}$/;
const COMMAND_NAME = /^[a-z0-9_-]{1,64}$/;

/** Role ids as clean, deduplicated Discord snowflakes; anything else is dropped. */
function cleanRoleIds(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((id) => String(id).trim()).filter((id) => SNOWFLAKE.test(id)))];
}

/**
 * One access rule as `{ mode, roleIds }`, or null when the input is no rule at
 * all. Accepts the stored shape and the `defaultAccess` shorthand ("everyone",
 * "admins", { roles: [] }). A role rule left without a valid role is "admins":
 * nobody but the admins could use it anyway, and saying so is clearer.
 */
function normalizeRule(raw) {
    if (raw === "everyone" || raw === "admins") return { mode: raw, roleIds: [] };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const mode = raw.mode !== undefined ? raw.mode : (raw.roles !== undefined ? "roles" : undefined);
    if (!MODES.includes(mode)) return null;
    if (mode !== "roles") return { mode, roleIds: [] };
    const roleIds = cleanRoleIds(raw.roleIds !== undefined ? raw.roleIds : raw.roles);
    return roleIds.length ? { mode: "roles", roleIds } : { mode: "admins", roleIds: [] };
}

/**
 * The stored/submitted `{ [commandName]: { mode, roleIds } }` map: unknown modes,
 * malformed command names and invalid role ids are dropped.
 */
function normalizeBotCommandAccess(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [name, rule] of Object.entries(raw)) {
        const key = String(name).trim();
        if (!COMMAND_NAME.test(key)) continue;
        const clean = normalizeRule(rule);
        if (clean) out[key] = clean;
    }
    return out;
}

module.exports = {
    BOT_COMMAND_GROUPS, GROUP_IDS, MODES,
    normalizeRule, normalizeBotCommandAccess, cleanRoleIds,
};
