// The editable bot settings under data/settings/ - a facade (#420).
//
// This file used to hold five collections at once. Each now has a store of its
// own; this module only re-exports them, so the ~50 modules (and the tests that
// jest.mock this path) that import from here keep working unchanged.
// New code imports the store it needs:
//
//   recruitmentStore.js     recruitment templates + posted recruitment messages
//   raidTemplateStore.js    raid templates (#266)
//   notifyTemplateStore.js  "Anmelde-Aufruf" templates
//   raidsheetStore.js       Google-Sheets targets (inside config.json)
//   configStore.js          the admin config (getConfig/saveConfig), cached
//   configSchema.js         its defaults and normalisers
//   settingsMigration.js    one-off upgrades of old files, run once at start
const recruitment = require("./recruitmentStore");
const raidTemplates = require("./raidTemplateStore");
const notify = require("./notifyTemplateStore");
const raidsheets = require("./raidsheetStore");
const config = require("./configStore");
const schema = require("./configSchema");
const { legacyEventGuilds } = require("./settingsMigration");

/**
 * The event-server list; as before #420 an old single-server block (`raw`
 * with `eventGuildId`, no list) still counts here. getConfig() no longer
 * relies on that: the start-up migration wrote the list down.
 */
function normalizeEventGuilds(list, raw) {
    return schema.normalizeEventGuilds(Array.isArray(list) ? list : legacyEventGuilds(raw));
}

/** The servers block (configSchema), an old single-server block included. */
function normalizeDiscordServers(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (Array.isArray(src.eventGuilds)) return schema.normalizeDiscordServers(src);
    return schema.normalizeDiscordServers({ ...src, eventGuilds: legacyEventGuilds(src) });
}

module.exports = {
    listRecruitment: recruitment.listRecruitment,
    getRecruitment: recruitment.getRecruitment,
    saveRecruitment: recruitment.saveRecruitment,
    deleteRecruitment: recruitment.deleteRecruitment,
    listRecruitmentPosts: recruitment.listRecruitmentPosts,
    getRecruitmentPost: recruitment.getRecruitmentPost,
    saveRecruitmentPost: recruitment.saveRecruitmentPost,
    deleteRecruitmentPost: recruitment.deleteRecruitmentPost,
    listRaidTemplates: raidTemplates.listRaidTemplates,
    getRaidTemplate: raidTemplates.getRaidTemplate,
    saveRaidTemplate: raidTemplates.saveRaidTemplate,
    saveRaidTemplates: raidTemplates.saveRaidTemplates,
    deleteRaidTemplate: raidTemplates.deleteRaidTemplate,
    listNotify: notify.listNotify,
    getNotify: notify.getNotify,
    saveNotify: notify.saveNotify,
    deleteNotify: notify.deleteNotify,
    listRaidsheets: raidsheets.listRaidsheets,
    getRaidsheet: raidsheets.getRaidsheet,
    saveRaidsheet: raidsheets.saveRaidsheet,
    deleteRaidsheet: raidsheets.deleteRaidsheet,
    getConfig: config.getConfig,
    saveConfig: config.saveConfig,
    resolveEventSheetLink: config.resolveEventSheetLink,
    normalizeDiscordServers,
    normalizeEventGuilds,
    normalizeRoleSync: schema.normalizeRoleSync,
    normalizeCategoryReminders: schema.normalizeCategoryReminders,
    ROLE_SYNC_DIRECTIONS: schema.ROLE_SYNC_DIRECTIONS,
    REMINDER_TARGETS: schema.REMINDER_TARGETS,
    normalizeCategorySignupSource: schema.normalizeCategorySignupSource,
    signupSourcesOf: schema.signupSourcesOf,
    normalizeRaidhelperRetirement: schema.normalizeRaidhelperRetirement,
    normalizeCategoryFlags: schema.normalizeCategoryFlags,
    normalizeCategoryVoiceChannel: schema.normalizeCategoryVoiceChannel,
};
