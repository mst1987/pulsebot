// Everything the bot takes from the environment (.env / .env.dev, see
// .env.example), read once at require time. Where a variable is unset the
// bootstrap value of config/defaults.js steps in; secrets have no fallback.
//
// Values the admin menu can edit (guild, categories, raidsheets, Battle.net)
// only *start* here — the settings store (stores/settingsStore.js) seeds itself
// from them and wins from then on.
//
// validateEnv() is called once at startup (src/bot.js) and names what is
// missing or malformed instead of letting a feature fail later without a word.

const defaults = require("./defaults");

// Discord IDs
const adminUserId = process.env.ADMIN_USER_ID || defaults.adminUserId;
const guildId = process.env.GUILD_ID || defaults.guildId;
const raidhelperServerId = process.env.RAIDHELPER_SERVER_ID || "";

// Application system
const applicationChannelId = process.env.APPLICATION_CHANNEL_ID || "";
const officerRoleId = process.env.OFFICER_ROLE_ID || "";
const applyArmoryUrlTemplate = process.env.APPLY_ARMORY_URL || defaults.applyArmoryUrlTemplate;
const applyWclUrlTemplate = process.env.APPLY_WCL_URL || defaults.applyWclUrlTemplate;

// Battle.net API (optional live character gear / paperdoll on the char-history
// page). Empty by default → char pages just link to classic-armory.org.
const blizzardClientId = process.env.BLIZZARD_CLIENT_ID || "";
const blizzardClientSecret = process.env.BLIZZARD_CLIENT_SECRET || "";
const blizzardRegion = process.env.BLIZZARD_REGION || defaults.blizzardRegion;
const blizzardRealmSlug = process.env.BLIZZARD_REALM || defaults.blizzardRealmSlug;
// Profile namespace override. Empty = auto (profile-classicann-<region>, the
// confirmed-correct namespace for the Anniversary realms like Thunderstrike).
// Overridable if needed (e.g. profile-classic-eu / profile-classic1x-eu).
const blizzardNamespace = process.env.BLIZZARD_NAMESPACE || "";

// Google Sheets (raid setup sheets): the default "Tier 4/5" raidsheet seeded
// into the settings store.
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
const googleSheetName = process.env.GOOGLE_SHEET_NAME || defaults.googleSheetName;
const googleSheetGid = Number(process.env.GOOGLE_SHEET_GID) || defaults.googleSheetGid;

// Web server (admin menu, API, report pages)
const webPort = Number(process.env.WEB_PORT) || defaults.webPort;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${webPort}`;

// Local development: auto-login as the first admin without OAuth, so the web
// menu works on any port without registering a Discord callback URL. Hard-gated
// to non-production so it can never bypass auth on the live bot.
const devAutoLogin = process.env.DEV_AUTO_LOGIN === "1" && process.env.NODE_ENV !== "production";

// Discord OAuth for the website (login + admin delete)
const discordClientId = process.env.CLIENT_ID || "";
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || "";
// Admins that may delete reports: ADMIN_USER_ID plus an optional comma list.
const logcheckAdminIds = [
    ...String(adminUserId).split(","),
    ...(process.env.LOGCHECK_ADMIN_IDS || "").split(","),
]
    .map((s) => s.trim())
    .filter(Boolean);
// Discord role IDs that grant access to the web admin menu (comma list).
// Members with any of these roles get admin access without being in the ID list.
const adminRoleIds = (process.env.ADMIN_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// What has to be set for the bot to do its job, and what goes without it. The
// web server boots without any of them (src/bot.js start()), so a missing value
// is reported, never fatal.
const REQUIRED = [
    { name: "DISCORDJS_BOT_TOKEN", without: "no Discord login — the web UI runs alone, every Discord feature is off" },
    { name: "CLIENT_ID", without: "no slash-command registration and no \"Login with Discord\" on the website" },
];

// Variables that must be a whole number when they are set at all.
const NUMERIC = [
    { name: "WEB_PORT", min: 1, max: 65535 },
    { name: "GOOGLE_SHEET_GID", min: 0, max: Number.MAX_SAFE_INTEGER },
];

/**
 * Check the environment and report each problem on its own line: a required
 * variable that is empty, a number that is none. Returns the problems so a
 * caller (or a test) can act on them; logs nothing when all is well.
 * @param {object} [env] the environment to check (default: process.env)
 * @param {(msg: string) => void} [warn] where to report (default: console.warn)
 * @returns {{ missing: string[], invalid: string[] }}
 */
function validateEnv(env = process.env, warn = (msg) => console.warn(msg)) {
    const missing = [];
    const invalid = [];
    for (const { name, without } of REQUIRED) {
        if (String(env[name] || "").trim()) continue;
        missing.push(name);
        warn(`[env] ${name} is not set: ${without}.`);
    }
    for (const { name, min, max } of NUMERIC) {
        const raw = env[name];
        if (raw === undefined || String(raw).trim() === "") continue;
        const n = Number(raw);
        if (Number.isInteger(n) && n >= min && n <= max) continue;
        invalid.push(name);
        warn(`[env] ${name}="${raw}" is not a whole number between ${min} and ${max} — the default is used instead.`);
    }
    if (env.DEV_AUTO_LOGIN === "1" && env.NODE_ENV === "production") {
        invalid.push("DEV_AUTO_LOGIN");
        warn("[env] DEV_AUTO_LOGIN=1 is ignored because NODE_ENV=production.");
    }
    return { missing, invalid };
}

module.exports = {
    adminUserId,
    guildId,
    raidhelperServerId,
    applicationChannelId,
    officerRoleId,
    applyArmoryUrlTemplate,
    applyWclUrlTemplate,
    blizzardClientId,
    blizzardClientSecret,
    blizzardRegion,
    blizzardRealmSlug,
    blizzardNamespace,
    googleSpreadsheetId,
    googleSheetName,
    googleSheetGid,
    webPort,
    publicBaseUrl,
    devAutoLogin,
    discordClientId,
    discordClientSecret,
    logcheckAdminIds,
    adminRoleIds,
    REQUIRED,
    validateEnv,
};
