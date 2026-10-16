// The orga of a category creating and changing events (#728, epic #723, docs/permissions.md
// "Kategorie-Orga"): the limits a manager of a category's current roster works within, beside the
// `orgaScoped` gate (web/http/apiHandler.js). The global orga with `raids` write keeps every category
// and every value of the request, as before.
//
//   - a new event lands only in one of their categories - the category the server works out from the
//     request (eventCreate.requestedCategoryId for the gate, createEvent's `guard` for the real one),
//   - in the version that category plays now: a `versionId` of the request never counts (a different
//     one is refused, 409 "version_fixed"; the series and the dialog leave it to the server anyway),
//   - a channel of the request may not point into another category: the new channel's template
//     channel and the voice channel are the category's own (its preset, or a channel inside it),
//   - an edit (PATCH /api/raids) keeps the raid's version and takes only such a voice channel.
// The create dialog's choices (GET /api/raids/new) are cut down to the same, so nothing is offered
// that the server would refuse.
const { getConfig } = require("../../stores/settingsStore");
const { getChannelConfig } = require("../../stores/channelArchiveStore");
const { mainVersionFor, versionOfEvent } = require("../../services/events/mainVersion");
const { rulesFor } = require("../../config/gameVersions");
const eventCreate = require("../../services/events/eventCreate");
const categoryOrga = require("../../services/roster/categoryOrga");
const { activeGuildFor } = require("../http/activeGuild");
const { fail } = require("../http/apiResult");
const { NOT_CATEGORY_ORGA } = require("../http/apiHandler");
const { isGlobalRaidOrga } = require("./raidOrgaAccess");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** `orgaScoped` of POST /api/raids: the new event as a row of the category the request asks for. */
function newEventRow(body, query, req) {
    return { categoryId: eventCreate.requestedCategoryId(activeGuildFor(req), body || {}) };
}

/**
 * The categories `user` creates and edits events in: null for the global orga with `raids` write
 * (every category, no limit), else the categories whose current roster they manage (the category path).
 * @returns {Promise<Set<string>|null>}
 */
async function eventCategoryScope(user, req) {
    if (isGlobalRaidOrga(user)) return null;
    const ids = await categoryOrga.orgaCategoryIds(user, { cache: categoryOrga.requestCache(req), managerOnly: true });
    return new Set(ids);
}

/** The Discord category a channel sits in ("" when unknown or at the top). */
function parentOf(guildId, channelId) {
    if (!channelId) return "";
    return str((eventCreate.categoryMap(guildId)[channelId] || {}).categoryId);
}

/** Whether a voice channel belongs to `categoryId`: none, its preset, or a channel inside it. */
function voiceAllowed(guildId, categoryId, voiceChannelId, config = getConfig()) {
    const id = str(voiceChannelId);
    if (!id) return true;
    if (id === str((config.categoryVoiceChannel || {})[categoryId])) return true;
    return !!categoryId && parentOf(guildId, id) === categoryId;
}

/** The template channel a category's naming schema stores (Kanäle → Schnell anlegen), "" for none or unreadable. */
function schemaTemplateOf(guildId, categoryId) {
    try {
        return str(((getChannelConfig(guildId).schemas || {})[categoryId] || {}).templateChannelId);
    } catch {
        return "";
    }
}

/** Whether a template channel for a new channel belongs to `categoryId`: none, its schema's, or one inside it. */
function templateChannelAllowed(guildId, categoryId, templateChannelId) {
    const id = str(templateChannelId);
    if (!id) return true;
    if (id === schemaTemplateOf(guildId, categoryId)) return true;
    return !!categoryId && parentOf(guildId, id) === categoryId;
}

/** The label of a version for a refusal ("TBC"). */
function versionLabel(versionId) {
    const rules = rulesFor(versionId);
    return (rules && (rules.short || rules.label)) || versionId;
}

const versionFixed = (versionId) => fail(409, "version_fixed",
    `Diese Kategorie spielt ${versionLabel(versionId)} – Events legst du in dieser Version an.`);
const channelForeign = (what) => fail(400, "channel_not_allowed",
    `${what} gehört zu einer anderen Kategorie – du kannst nur Kanäle deiner Kategorie wählen.`);

/**
 * createEvent's `guard` for the category path: the category the server worked out must be one of
 * `user`'s, the plan in the version the category plays now, the channels of the request its own.
 * @returns {(input: { categoryId: string, plan: object|null, request: object, body: object }) => Promise<object|null>}
 */
function createGuard(user, req) {
    const guildId = activeGuildFor(req);
    const cache = categoryOrga.requestCache(req);
    return async ({ categoryId, plan, request, body }) => {
        const cat = str(categoryId);
        if (!cat || !(await categoryOrga.canOrgaEvent(user, { categoryId: cat }, { cache, managerOnly: true }))) {
            return fail(403, "not_category_orga", NOT_CATEGORY_ORGA);
        }
        const config = getConfig();
        const current = mainVersionFor({ categoryId: cat, config });
        if (plan && plan.versionId !== current) return versionFixed(current);
        if (!plan && str(body && body.versionId) && str(body.versionId) !== current) return versionFixed(current);
        if (request && request.newChannel && !templateChannelAllowed(guildId, cat, request.newChannel.templateChannelId)) {
            return channelForeign("Der Vorlage-Kanal");
        }
        const voice = plan ? plan.voiceChannelId : body && body.voiceChannelId;
        if (!voiceAllowed(guildId, cat, voice, config)) return channelForeign("Der Sprachkanal");
        return null;
    };
}

/**
 * What a category orga may not change on their raid (PATCH /api/raids): its version (the server's
 * record, versionOfEvent) and a voice channel outside its category. null = fine.
 * @param {object} event  the stored own event
 * @param {object} body   the request
 */
function updateRefusal(event, body, req) {
    const config = getConfig();
    if (str(body.versionId)) {
        const current = versionOfEvent(event, { config });
        if (str(body.versionId) !== current) return versionFixed(current);
    }
    if (body.voiceChannelId !== undefined && str(body.voiceChannelId) !== str(event.voiceChannelId)
        && !voiceAllowed(activeGuildFor(req), str(event.categoryId), body.voiceChannelId, config)) {
        return channelForeign("Der Sprachkanal");
    }
    return null;
}

module.exports = {
    newEventRow, eventCategoryScope, voiceAllowed, templateChannelAllowed, createGuard, updateRefusal,
};
