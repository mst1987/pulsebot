// API Configuration
const API_BASE_URL =
    process.env.API_BASE_URL || "https://pulse-gdkp.de:3001/api";

// Discord IDs
const legendaryID = "1144865420386517053";
const adminUserId = process.env.ADMIN_USER_ID || "233598324022837249";
const raidhelperBotId = "579155972115660803";
const categoryIds = [
    "1115368280245420042",
    "1143858079289577502",
    "1157813724741128293",
];
const highestBidsChannelId = "1145659881362313248";
const highestBidsMessageId = "1147062559036416191";

// Auction Settings
const maxBidAmount = 5000000;
const defaultTimeout = 60000;

// Application System
const applicationChannelId = process.env.APPLICATION_CHANNEL_ID || "";
const officerRoleId = process.env.OFFICER_ROLE_ID || "";

// Logcheck web server (serves the generated report pages)
const webPort = Number(process.env.WEB_PORT) || 3005;
const publicBaseUrl =
    process.env.PUBLIC_BASE_URL || `http://localhost:${webPort}`;

// Discord OAuth for the logcheck website (login + admin delete)
const discordClientId = process.env.CLIENT_ID || "";
const discordClientSecret =
    process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || "";
// admins that may delete reports: ADMIN_USER_ID plus optional comma list
const logcheckAdminIds = [adminUserId, ...(process.env.LOGCHECK_ADMIN_IDS || "").split(",")]
    .map((s) => s.trim())
    .filter(Boolean);

module.exports = {
    API_BASE_URL,
    legendaryID,
    adminUserId,
    raidhelperBotId,
    categoryIds,
    highestBidsChannelId,
    highestBidsMessageId,
    maxBidAmount,
    defaultTimeout,
    applicationChannelId,
    officerRoleId,
    webPort,
    publicBaseUrl,
    discordClientId,
    discordClientSecret,
    logcheckAdminIds,
};