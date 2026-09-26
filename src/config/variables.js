// Facade over the three config modules, kept so the existing importers (and
// the tests that replace this module with a stub) go on working unchanged:
//
//   config/env.js        everything read from process.env (+ validateEnv())
//   config/defaults.js   bootstrap values for the settings store
//   config/constants.js  fixed facts, colours, timeouts
//
// New code imports the specific module instead of this one.

const env = require("./env");
const defaults = require("./defaults");
const constants = require("./constants");
// The server time zone (source: config/timezone.js).
const { TIMEZONE } = require("./timezone");

module.exports = {
    TIMEZONE,
    adminUserId: env.adminUserId,
    guildId: env.guildId,
    raidhelperServerId: env.raidhelperServerId,
    raidhelperBotId: constants.RAIDHELPER_BOT_ID,
    categoryIds: defaults.categoryIds,
    highestBidsChannelId: defaults.highestBidsChannelId,
    highestBidsMessageId: defaults.highestBidsMessageId,
    embedAccentColor: constants.EMBED_ACCENT_COLOR,
    googleSpreadsheetId: env.googleSpreadsheetId,
    googleSheetName: env.googleSheetName,
    googleSheetGid: env.googleSheetGid,
    defaultTimeout: constants.REPLY_DELETE_AFTER_MS,
    applicationChannelId: env.applicationChannelId,
    officerRoleId: env.officerRoleId,
    applyArmoryUrlTemplate: env.applyArmoryUrlTemplate,
    applyWclUrlTemplate: env.applyWclUrlTemplate,
    blizzardClientId: env.blizzardClientId,
    blizzardClientSecret: env.blizzardClientSecret,
    blizzardRegion: env.blizzardRegion,
    blizzardRealmSlug: env.blizzardRealmSlug,
    blizzardNamespace: env.blizzardNamespace,
    webPort: env.webPort,
    publicBaseUrl: env.publicBaseUrl,
    discordClientId: env.discordClientId,
    discordClientSecret: env.discordClientSecret,
    logcheckAdminIds: env.logcheckAdminIds,
    adminRoleIds: env.adminRoleIds,
    devAutoLogin: env.devAutoLogin,
};
