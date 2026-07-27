// API Configuration
const API_BASE_URL =
    process.env.API_BASE_URL || "https://pulse-gdkp.de:3001/api";

// Discord IDs
const legendaryID = "1144865420386517053";
const adminUserId = process.env.ADMIN_USER_ID || "233598324022837249";
// Bootstrap defaults only — the admin menu can override both in the settings
// store (kept out of .env on purpose, like the other editable config).
const guildId = process.env.GUILD_ID || "";
const raidhelperServerId = process.env.RAIDHELPER_SERVER_ID || "";
const raidhelperBotId = "579155972115660803";
const categoryIds = [
    "1115368280245420042",
    "1143858079289577502",
    "1157813724741128293",
];
const highestBidsChannelId = "1145659881362313248";
const highestBidsMessageId = "1147062559036416191";

// Visual identity: accent used for the colour bar on bot embeds, matching the
// admin web UI's --accent token (violet/cyan redesign, 2026-07).
const embedAccentColor = 0x8a7cff;

// Auction Settings
const maxBidAmount = 5000000;
const defaultTimeout = 60000;

// Application System
const applicationChannelId = process.env.APPLICATION_CHANNEL_ID || "";
const officerRoleId = process.env.OFFICER_ROLE_ID || "";
// URL templates with a {char} placeholder, used to auto-fill links when the
// applicant didn't provide one. Defaults target Thunderstrike (EU, fresh/anniversary).
const applyArmoryUrlTemplate =
    process.env.APPLY_ARMORY_URL || "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}";
const applyWclUrlTemplate =
    process.env.APPLY_WCL_URL || "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}";

// Battle.net API (optional live character gear / paperdoll on the char-history
// page). Empty by default → char pages just link to classic-armory.org. These
// are only bootstrap defaults; the admin menu can override them in the settings
// store (kept out of .env on purpose, like the other editable config).
const blizzardClientId = process.env.BLIZZARD_CLIENT_ID || "";
const blizzardClientSecret = process.env.BLIZZARD_CLIENT_SECRET || "";
const blizzardRegion = process.env.BLIZZARD_REGION || "eu";
const blizzardRealmSlug = process.env.BLIZZARD_REALM || "thunderstrike";
// Profile namespace override. Empty = auto (profile-classicann-<region>, the
// confirmed-correct namespace for the Anniversary realms like Thunderstrike).
// Overridable if needed (e.g. profile-classic-eu / profile-classic1x-eu).
const blizzardNamespace = process.env.BLIZZARD_NAMESPACE || "";

// Google Sheets (raid setup sheets). Used as the default "Tier 4/5" raidsheet
// seeded into the settings store; further raidsheets are added in the admin menu.
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
const googleSheetName = process.env.GOOGLE_SHEET_NAME || "Setup";
const googleSheetGid = Number(process.env.GOOGLE_SHEET_GID) || 34139428;

// Logcheck web server (serves the generated report pages)
const webPort = Number(process.env.WEB_PORT) || 3005;
const publicBaseUrl =
    process.env.PUBLIC_BASE_URL || `http://localhost:${webPort}`;

// Local development: auto-login as the first admin without OAuth, so the web
// menu works on any port without registering a Discord callback URL. Hard-gated
// to non-production so it can never bypass auth on the live bot.
const devAutoLogin =
    process.env.DEV_AUTO_LOGIN === "1" && process.env.NODE_ENV !== "production";

// Discord OAuth for the logcheck website (login + admin delete)
const discordClientId = process.env.CLIENT_ID || "";
const discordClientSecret =
    process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || "";
// admins that may delete reports: ADMIN_USER_ID plus optional comma list
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

module.exports = {
    API_BASE_URL,
    legendaryID,
    adminUserId,
    guildId,
    raidhelperServerId,
    raidhelperBotId,
    categoryIds,
    highestBidsChannelId,
    highestBidsMessageId,
    embedAccentColor,
    googleSpreadsheetId,
    googleSheetName,
    googleSheetGid,
    maxBidAmount,
    defaultTimeout,
    applicationChannelId,
    officerRoleId,
    applyArmoryUrlTemplate,
    applyWclUrlTemplate,
    blizzardClientId,
    blizzardClientSecret,
    blizzardRegion,
    blizzardRealmSlug,
    blizzardNamespace,
    webPort,
    publicBaseUrl,
    discordClientId,
    discordClientSecret,
    logcheckAdminIds,
    adminRoleIds,
    devAutoLogin,
};