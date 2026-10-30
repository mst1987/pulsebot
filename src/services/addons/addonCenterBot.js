// What the buttons of the addon download centre answer (Board 2 of the design;
// commands/lookup/addonCenterButton.js routes `addonhub:*` here, the centre itself
// is addonCenter.js). Every answer is ephemeral — only the clicking member sees it.
//
//   addonhub:dl:<addonId>             "Herunterladen" (centre): the
//                                     file as an attachment; a release with several
//                                     matching files first offers one button per file
//   addonhub:file:<addonId>:<assetId> one of those files
//   addonhub:sub                      "Updates abonnieren" (only while an update role is
//                                     set): the update role on or off for the clicker
//   addonhub:unsub                    "Abo beenden" under the confirmation
//
// The button never touches a role with rights (bot rights or Discord permissions,
// services/discord/roles/selfRole.js), in neither direction. Otherwise the bot may hand out the role only
// with Manage Roles, when the role sits below its highest role and belongs to no
// integration; else (and when the role is gone) the member gets one clear line and
// the log a warning saying why.
//
// A download is checked like the web's (apiRoutes/system/addons.js): the areas "signup" or
// "history", an orga-only addon only for the orga (userAccess.resolveAccess, a failed
// lookup = the base access), the shared limit per Discord account (downloadLimit.js),
// then the size against what Discord lets the bot upload here. It is logged like
// the web's download, marked "via discord"; the token never reaches a log line.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, FileBuilder, MessageFlags, TextDisplayBuilder,
} = require("discord.js");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { getConfig } = require("../../stores/configStore");
const store = require("../../stores/addonCenterStore");
const { resolveAccess } = require("../discord/members/userAccess");
const { interactionGuildId } = require("../discord/servers/serverAccess");
const { langOfInteraction } = require("../discord/botLanguage");
const { userCanAny, userIsOrga } = require("../../config/permissions");
const { enabledAddons, releaseFor, resolveDownload } = require("./addonReleases");
const { assetMatches } = require("./addonConfig");
const { takeDownload } = require("./downloadLimit");
const { openAssetStream } = require("../../classes/githubReleases");
const { publicBaseUrl } = require("../../utils/publicUrl");
const { tr } = require("../../utils/i18n/botText");
const { parseCenterId, fileId, UNSUBSCRIBE_ID } = require("./addonCenterPanel");
const { changeSelfRole, roleProblem } = require("../discord/roles/selfRole");
const log = require("../../logger").child("addons");

/** The areas whose holders may download (the web's rule). */
const AREAS = ["signup", "history"];
/** What the bot may upload when Discord does not say: 10 MB, the limit without boosts. */
const DEFAULT_UPLOAD_LIMIT = 10 * 1000 * 1000;
/** The upload limit of a boosted server (premium tier 2 and 3). */
const TIER_LIMITS = { 2: 50 * 1000 * 1000, 3: 100 * 1000 * 1000 };

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** Who clicked, for the log: name and id, nothing else. */
function whoOf(interaction) {
    const u = (interaction && interaction.user) || {};
    const name = (interaction.member && interaction.member.displayName) || u.globalName || u.username || "?";
    return `${name} (${str(u.id) || "?"})`;
}

/** How many bytes the bot may upload in this interaction. */
function uploadLimitOf(interaction) {
    const given = Number(interaction && interaction.attachmentSizeLimit);
    if (Number.isFinite(given) && given > 0) return given;
    const tier = Number(interaction && interaction.guild && interaction.guild.premiumTier);
    return TIER_LIMITS[tier] || DEFAULT_UPLOAD_LIMIT;
}

/** A short ephemeral answer: an icon and a line, optionally buttons under it (Components V2, no card: Board 2). */
function notice(emoji, line, buttons = []) {
    const components = [new TextDisplayBuilder().setContent(`${emoji} ${line}`).toJSON()];
    if (buttons.length) components.push(new ActionRowBuilder().addComponents(buttons).toJSON());
    return { flags: MessageFlags.IsComponentsV2, components, content: "", embeds: [], allowedMentions: { parse: [] } };
}

const denied = (lang) => notice("🔒", tr(lang, "Downloads are for guild members. Ask the orga if that is wrong."));
const unavailable = (lang) => notice("❌", tr(lang, "Not available right now – try again in a few minutes."));

/** "Too big": the line and the way to the web page (only with a public address — Discord refuses a relative link). */
function tooBig(lang) {
    const base = publicBaseUrl();
    const buttons = base ? [new ButtonBuilder().setLabel(tr(lang, "To the download page")).setStyle(ButtonStyle.Link).setURL(`${base}/addon`)] : [];
    return notice("⚠️", tr(lang, "The file is too big for Discord. Download it on the web page."), buttons);
}

/** "Genug geladen …": the time the next download is possible, in the server's zone. */
function limited(lang, retryAfterSec, now = Date.now()) {
    const at = DateTime.fromMillis(now + Math.max(1, Number(retryAfterSec) || 1) * 1000, { zone: TIMEZONE }).toFormat("HH:mm");
    return notice("⏰", tr(lang, "Enough downloads for the moment – from **{time}** it works again.", { time: at }));
}

/** The file read into memory, at most `limit` bytes; null when it is bigger. */
function readLimited(stream, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let done = false;
        stream.on("data", (chunk) => {
            if (done) return;
            size += chunk.length;
            if (size > limit) {
                done = true;
                if (typeof stream.destroy === "function") stream.destroy();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        stream.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
        stream.on("error", (e) => { if (!done) { done = true; reject(e); } });
    });
}

/** The answer with the file (Board 2): the line, then the file as a file component of the attachment. */
function filePayload(lang, addon, release, fileName, buffer) {
    const zip = /\.zip$/i.test(fileName);
    const line = zip
        ? tr(lang, "**{name} {version}** – unpack it into `Interface\\AddOns`, then restart the game.", { name: addon.name, version: release.version })
        : `**${addon.name} ${release.version}**`;
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [
            new TextDisplayBuilder().setContent(line).toJSON(),
            new FileBuilder().setURL(`attachment://${fileName}`).toJSON(),
        ],
        files: [{ attachment: buffer, name: fileName }],
        content: "",
        embeds: [],
        allowedMentions: { parse: [] },
    };
}

/** Several matching files: one button each (only for this member). */
function filePicker(lang, addon, files) {
    const rows = [];
    for (let i = 0; i < files.length && rows.length < 5; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(files.slice(i, i + 5).map((f) => new ButtonBuilder()
            .setCustomId(fileId(addon.id, f.id)).setLabel(str(f.name).slice(0, 80)).setEmoji("📥").setStyle(ButtonStyle.Success))).toJSON());
    }
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [new TextDisplayBuilder().setContent(tr(lang, "**{name}** has several files. Which one?", { name: addon.name })).toJSON(), ...rows],
        content: "",
        embeds: [],
        allowedMentions: { parse: [] },
    };
}

/**
 * "Herunterladen": checks, then the file as an ephemeral attachment (see the head
 * comment). `assetId` picks one file of several.
 */
async function download(interaction, addonId, assetId = "") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = langOfInteraction(interaction);
    const userId = str(interaction.user && interaction.user.id);
    // the rights on the server of the click (#925)
    const user = { id: userId, ...(await resolveAccess(userId, { guildId: interactionGuildId(interaction) })) };
    if (!userCanAny(user, AREAS, "read")) {
        log.warn(`download refused (no access): ${addonId} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(denied(lang));
    }
    const config = getConfig();
    const orga = userIsOrga(user);
    const addon = enabledAddons(config, "", { orga: true }).find((a) => a.id === str(addonId));
    if (!addon) return interaction.editReply(unavailable(lang));
    if (addon.orgaOnly && !orga) {
        log.warn(`download refused (orga only): ${addon.id} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(denied(lang));
    }
    const result = await releaseFor(addon, { config });
    const files = result.release ? (result.release.assets || []).filter((a) => assetMatches(addon, a.name)) : [];
    if (!files.length) return interaction.editReply(unavailable(lang));
    let file = files[0];
    if (assetId) {
        file = files.find((f) => str(f.id) === str(assetId));
        if (!file) return interaction.editReply(unavailable(lang));
    } else if (files.length > 1) {
        return interaction.editReply(filePicker(lang, addon, files));
    }

    const target = await resolveDownload(config, addon.id, file.name, { orga });
    if (target.code === "orga_only") return interaction.editReply(denied(lang));
    if (target.status) {
        log.warn(`download refused (${target.code}): ${addon.id}/${file.name} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(unavailable(lang));
    }
    const limit = uploadLimitOf(interaction);
    if (Number(target.asset.size) > limit) {
        log.warn(`download refused (too large for Discord, ${target.asset.size} > ${limit}): ${addon.id}/${file.name} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(tooBig(lang));
    }
    const quota = takeDownload(userId);
    if (!quota.ok) {
        log.warn(`download refused (limit): ${addon.id}/${file.name} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(limited(lang, quota.retryAfterSec));
    }

    let buffer;
    try {
        const upstream = await openAssetStream({ repo: target.addon.repo, assetId: target.asset.id, token: target.token });
        buffer = await readLimited(upstream.stream, limit);
    } catch (err) {
        // the code and status only: an axios error would carry the request headers, the token among them
        log.warn(`download failed: ${addon.id}/${file.name} for ${whoOf(interaction)} via discord: ${str(err && err.code) || "error"} ${str(err && err.status)}`.trim());
        return interaction.editReply(unavailable(lang));
    }
    if (!buffer) {
        log.warn(`download refused (too large for Discord): ${addon.id}/${file.name} by ${whoOf(interaction)} via discord`);
        return interaction.editReply(tooBig(lang));
    }
    log.info(`download ${target.addon.id} ${target.release.version} ${target.asset.name} by ${whoOf(interaction)} via discord`);
    return interaction.editReply(filePayload(lang, target.addon, target.release, target.asset.name, buffer));
}

/** "Abonniert …" with "Abo beenden", or "Abo beendet …" (Board 2). */
function subscribedPayload(lang, roleId) {
    return notice("✅", tr(lang, "Subscribed: new versions ping you with {role}.", { role: `<@&${roleId}>` }), [
        new ButtonBuilder().setCustomId(UNSUBSCRIBE_ID).setLabel(tr(lang, "End subscription")).setStyle(ButtonStyle.Secondary),
    ]);
}

const unsubscribedPayload = (lang) => notice("🔕", tr(lang, "Subscription ended – no more update pings."));

/**
 * "Updates abonnieren" (`sub`, toggles) and "Abo beenden" (`unsub`, only off, replaces
 * the ephemeral confirmation it sits under).
 */
async function subscription(interaction, action) {
    const replace = action === "unsub";
    if (replace) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = langOfInteraction(interaction);
    const { roleId } = store.getSettings();
    const sorry = notice("❌", tr(lang, "Subscribing does not work right now. Please tell the orga."));
    if (!roleId || !interaction.guild) return interaction.editReply(notice("❌", tr(lang, "There is no update role to subscribe to.")));
    const guild = interaction.guild;
    const result = await changeSelfRole({
        guild,
        roleId,
        member: interaction.member,
        userId: str(interaction.user && interaction.user.id),
        mode: action === "sub" ? "toggle" : "remove",
        config: getConfig(),
        reasons: { add: "Addon-Updates abonniert", remove: "Addon-Updates abbestellt" },
    });
    if (!result.ok) {
        const name = result.role ? `@${result.role.name} (${roleId})` : roleId;
        if (result.code === "role_unreadable") log.warn(`subscription: the update role ${roleId} could not be read on ${guild.id}: ${result.detail}`);
        else if (result.code === "role_missing") log.warn(`subscription: the update role ${roleId} is missing on ${guild.id} (deleted, or on another server) - pick another one in the settings`);
        else if (result.code === "member_missing") log.warn(`subscription: member ${whoOf(interaction)} not found on ${guild.id}: ${result.detail}`);
        else if (result.code === "refused") log.warn(`subscription: cannot hand out ${name}: ${result.detail}`);
        else log.warn(`subscription: ${name} not ${result.on ? "given to" : "taken from"} ${whoOf(interaction)}: ${result.detail}`);
        return interaction.editReply(sorry);
    }
    const { on } = result;
    log.info(`subscription ${on ? "on" : "off"}: ${whoOf(interaction)}`);
    return interaction.editReply(on ? subscribedPayload(lang, roleId) : unsubscribedPayload(lang));
}

/** Every `addonhub:` customId. */
async function handleCenter(interaction) {
    const { action, addonId, assetId } = parseCenterId(interaction.customId);
    if (action === "dl") return download(interaction, addonId);
    if (action === "file") return download(interaction, addonId, assetId);
    if (action === "sub" || action === "unsub") return subscription(interaction, action);
    return interaction.reply({ ...unavailable(langOfInteraction(interaction)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

module.exports = {
    handleCenter, download, subscription, roleProblem, uploadLimitOf, readLimited, filePayload, AREAS, DEFAULT_UPLOAD_LIMIT,
};
