// The addon download centre in Discord as messages (design "Addon-Downloadzentrale",
// Okt 2026) — pure builders; services/addons/addonCenter.js gathers the data, posts
// and redraws, services/addons/addonCenterBot.js answers the buttons.
//
// The centre (Board 1), ONE Components V2 message:
//   head container (accent #8a7cff)  "## Addon-Downloadzentrale", how it works, "-# Neue
//                                    Versionen werden hier gemeldet."; "Updates abonnieren"
//                                    as the section's button when an update role is set
//   one container per addon          in the addon's colour: "### <emoji> Name [NEU]", the
//                                    short description, "-# Version 0.3.0 · 12.10.2026" and
//                                    "Herunterladen" as the section's button — without a
//                                    release a short note instead of the button
// The update message (Board 3): the role ping as its first line (only that role may
// ping), then a container in the addon's colour: "### Name 0.3.0 ist da", "-# vorher
// 0.2.0 · 14.10.2026", the release notes as bullets, a divider, "Herunterladen" and
// the link "Zur Zentrale".
//
// Discord allows 40 components per message (nested ones included) and 4000
// characters of text: the head takes 2 or 4, an addon 4 (container, section, text,
// button) or 2 (container, text); addons that do not fit are left out with a line
// in the head (the caller logs it), descriptions are cut to share the text budget.
// Public texts go through tr() in the server's language (docs/bot-commands.md).
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder,
} = require("discord.js");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { tr } = require("../../utils/i18n/botText");
const { emojiText, addonEmojiName } = require("../discord/appEmojis");

/** The customId prefix of every button of the centre (commands/lookup/addonCenterButton.js). */
const CENTER_PREFIX = "addonhub";
const COMPONENT_LIMIT = 40;
const TEXT_LIMIT = 4000;
/** How long an addon carries "NEU" after a new version. */
const NEW_MS = 7 * 24 * 60 * 60 * 1000;
/** Release notes: at most this many bullets of at most this many characters. */
const MAX_BULLETS = 6;
const BULLET_MAX = 160;
const DESCRIPTION_MAX = 300;

/** The centre's own colour (the bot's accent) and the addons' colours of the design. */
const COLOR_CENTER = 0x8a7cff;
const ADDON_COLORS = Object.freeze({
    levelhelper: 0x60a5fa,
    professionkit: 0xfbbf24,
    aurakit: 0xc084fc,
    macrohelper: 0x2dd4bf,
    "eventhelper-sync": 0x8a7cff,
});
/** A further addon gets one of these, always the same for its id. */
const FALLBACK_COLORS = Object.freeze([0x60a5fa, 0xfbbf24, 0xc084fc, 0x2dd4bf, 0xf87171, 0x4ade80, 0xfb923c, 0xf472b6]);

const downloadId = (addonId) => `${CENTER_PREFIX}:dl:${addonId}`;
const fileId = (addonId, assetId) => `${CENTER_PREFIX}:file:${addonId}:${assetId}`;
const SUBSCRIBE_ID = `${CENTER_PREFIX}:sub`;
const UNSUBSCRIBE_ID = `${CENTER_PREFIX}:unsub`;

const str = (v) => String(v === undefined || v === null ? "" : v);
const text = (content) => new TextDisplayBuilder().setContent(content);

/** `text` cut to `max` characters with "…". */
function cut(value, max) {
    const s = str(value);
    if (s.length <= max) return s;
    return max <= 1 ? "" : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Discord's markdown characters escaped, line breaks flattened (names and descriptions are one line). */
const escapeMd = (s) => str(s).replace(/\s*\n\s*/g, " ").replace(/([\\*_~`|>#[\]])/g, "\\$1").replace(/@/g, "@\u200b");

/** The accent colour of an addon. */
function addonColor(addonId) {
    const id = str(addonId);
    if (Object.prototype.hasOwnProperty.call(ADDON_COLORS, id)) return ADDON_COLORS[id];
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

/** "12.10.2026" of an ISO date in the server's zone; "" when unknown. */
function dateText(iso) {
    const ms = Date.parse(str(iso));
    if (!Number.isFinite(ms)) return "";
    return DateTime.fromMillis(ms, { zone: TIMEZONE }).toFormat("dd.MM.yyyy");
}

/** Whether a "NEU" mark set at `newSince` still shows at `now`. */
const isNew = (newSince, now = Date.now()) => Number(newSince) > 0 && now - Number(newSince) < NEW_MS;

/** "### <emoji> Name" plus the NEU mark. */
function headingOf(addon, { emojis, lang, fresh, suffix = "" }) {
    const emoji = emojiText(emojis, addonEmojiName(addon.id), "");
    const name = escapeMd(cut(addon.name, 60));
    return `### ${emoji ? `${emoji} ` : ""}${name}${suffix}${fresh ? ` \`${tr(lang, "NEW")}\`` : ""}`;
}

/** The release files of one addon its download offers (the caller filters by pattern). */
function hasFiles(entry) {
    return !!(entry && entry.release && Array.isArray(entry.files) && entry.files.length);
}

/** The note an addon shows instead of its button. */
function stateNote(entry, lang) {
    if (entry.release && !hasFiles(entry)) return tr(lang, "The newest release has no matching file.");
    if (entry.state === "no_release") return tr(lang, "No release yet.");
    return tr(lang, "Not available right now.");
}

function downloadButton(addonId, lang) {
    return new ButtonBuilder().setCustomId(downloadId(addonId)).setLabel(tr(lang, "Download")).setEmoji("📥").setStyle(ButtonStyle.Success);
}

/**
 * The centre message.
 * @param {object} o
 * @param {{ addon: object, state: string, release: object|null, files: object[], newSince: number }[]} o.entries
 *   the addons of the channel's version, in order (`files` = the release files the addon offers)
 * @param {boolean} [o.subscribe] show "Updates abonnieren" (an update role is set)
 * @param {string} [o.lang]
 * @param {object} [o.emojis] the bot's application emojis (appEmojis.appEmojiMap())
 * @param {number} [o.now]
 * @returns {{ payload: object, shown: number, dropped: number }}
 */
function centerPayload({ entries = [], subscribe = false, lang = "de", emojis = {}, now = Date.now() } = {}) {
    const headText = [
        `## ${tr(lang, "Addon download centre")}`,
        tr(lang, "Click **Download** – the file comes only for you. Unpack it into `Interface\\AddOns`."),
        `-# ${tr(lang, "New versions are announced here.")}`,
    ].join("\n");
    const headCost = subscribe ? 4 : 2;
    const costOf = (e) => (hasFiles(e) ? 4 : 2);

    // what fits: everything, else as many as fit next to the line that says some are missing
    let list = entries.filter((e) => e && e.addon);
    const total = headCost + list.reduce((n, e) => n + costOf(e), 0);
    if (total > COMPONENT_LIMIT) {
        let used = headCost + 1;
        const fit = [];
        for (const e of list) {
            if (used + costOf(e) > COMPONENT_LIMIT) break;
            used += costOf(e);
            fit.push(e);
        }
        list = fit;
    }
    const dropped = entries.filter((e) => e && e.addon).length - list.length;

    const lines = list.map((e) => {
        const fresh = isNew(e.newSince, now);
        const version = e.release ? [tr(lang, "Version {version}", { version: e.release.version }), dateText(e.release.publishedAt)].filter(Boolean).join(" · ") : "";
        return {
            e,
            head: headingOf(e.addon, { emojis, lang, fresh }),
            sub: `-# ${hasFiles(e) ? version : [version, stateNote(e, lang)].filter(Boolean).join(" · ")}`,
            desc: escapeMd(cut(e.addon.description, DESCRIPTION_MAX)),
        };
    });
    // the descriptions share what is left of the 4000 characters
    const more = dropped > 0 ? `-# ${tr(lang, "{count} more addons are on the download page.", { count: dropped })}` : "";
    const fixed = headText.length + more.length + 1 + lines.reduce((n, l) => n + l.head.length + l.sub.length + 2, 0);
    const share = lines.length ? Math.max(0, Math.floor((TEXT_LIMIT - fixed) / lines.length)) : 0;

    const head = new ContainerBuilder().setAccentColor(COLOR_CENTER);
    const headContent = more ? `${headText}\n${more}` : headText;
    if (subscribe) {
        head.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(headContent))
            .setButtonAccessory(new ButtonBuilder().setCustomId(SUBSCRIBE_ID).setLabel(tr(lang, "Subscribe to updates")).setEmoji("🔔").setStyle(ButtonStyle.Secondary)));
    } else {
        head.addTextDisplayComponents(text(headContent));
    }
    const components = [head.toJSON()];

    for (const l of lines) {
        const content = [l.head, cut(l.desc, share), l.sub].filter((s) => s.trim()).join("\n");
        const c = new ContainerBuilder().setAccentColor(addonColor(l.e.addon.id));
        if (hasFiles(l.e)) {
            c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(downloadButton(l.e.addon.id, lang)));
        } else {
            c.addTextDisplayComponents(text(content));
        }
        components.push(c.toJSON());
    }
    if (!lines.length) {
        components.push(new ContainerBuilder().setAccentColor(COLOR_CENTER)
            .addTextDisplayComponents(text(tr(lang, "There are no addons for this channel's game version."))).toJSON());
    }
    return {
        payload: { flags: MessageFlags.IsComponentsV2, components, content: "", embeds: [] },
        shown: lines.length,
        dropped,
    };
}

/**
 * The release notes as at most MAX_BULLETS short lines: the list items when there
 * are any, else the plain lines. Headings, links and emphasis are flattened and
 * the rest escaped, so nothing in a note can format or ping.
 */
function noteBullets(notes) {
    const rows = str(notes).replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    const items = rows.filter((l) => /^([-*+]|\d+[.)])\s+/.test(l));
    const picked = (items.length ? items : rows.filter((l) => !/^#/.test(l) && !/^[-=]{3,}$/.test(l)))
        .map((l) => l.replace(/^([-*+]|\d+[.)])\s+/, "")
            .replace(/^#+\s*/, "")
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/(\*\*|__|~~|`)/g, "")
            .replace(/<[^>]*>/g, "")
            .trim())
        .filter(Boolean);
    return picked.slice(0, MAX_BULLETS).map((l) => cut(escapeMd(l), BULLET_MAX));
}

/**
 * The update message of one addon's new version (Board 3).
 * @param {object} o
 * @param {object} o.addon
 * @param {{ version: string, publishedAt: string, notes: string }} o.release
 * @param {string} [o.previous] the version before ("" = unknown)
 * @param {string} [o.roleId] the update role pinged in the first line ("" = no ping)
 * @param {string} [o.centerUrl] "Zur Zentrale" ("" = no link)
 * @param {boolean} [o.download] offer "Herunterladen" (the release has a matching file)
 * @returns {object} the message payload, with allowedMentions for the role only
 */
function updatePayload({ addon, release, previous = "", roleId = "", centerUrl = "", download = true, lang = "de", emojis = {} } = {}) {
    const components = [];
    if (roleId) components.push(text(`<@&${roleId}>`).toJSON());
    const c = new ContainerBuilder().setAccentColor(addonColor(addon.id));
    const sub = [previous ? tr(lang, "before {version}", { version: previous }) : "", dateText(release.publishedAt)].filter(Boolean).join(" · ");
    const head = headingOf(addon, { emojis, lang, fresh: false, suffix: ` ${escapeMd(cut(release.version, 40))} ${tr(lang, "is here")}` });
    c.addTextDisplayComponents(text(sub ? `${head}\n-# ${sub}` : head));
    const bullets = noteBullets(release.notes);
    if (bullets.length) c.addTextDisplayComponents(text(bullets.map((b) => `- ${b}`).join("\n")));
    const buttons = [];
    if (download) buttons.push(downloadButton(addon.id, lang));
    if (centerUrl) buttons.push(new ButtonBuilder().setLabel(tr(lang, "To the centre")).setStyle(ButtonStyle.Link).setURL(centerUrl));
    if (buttons.length) {
        c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
    }
    components.push(c.toJSON());
    return {
        flags: MessageFlags.IsComponentsV2,
        components,
        content: "",
        embeds: [],
        allowedMentions: roleId ? { parse: [], roles: [roleId] } : { parse: [] },
    };
}

/** `{ action, addonId, assetId }` of a customId of the centre. */
function parseCenterId(customId) {
    const [, action = "", addonId = "", assetId = ""] = str(customId).split(":");
    return { action, addonId, assetId };
}

module.exports = {
    CENTER_PREFIX, COMPONENT_LIMIT, TEXT_LIMIT, NEW_MS, COLOR_CENTER, ADDON_COLORS, SUBSCRIBE_ID, UNSUBSCRIBE_ID,
    centerPayload, updatePayload, noteBullets, addonColor, dateText, isNew, downloadId, fileId, parseCenterId, escapeMd,
};
