// The addon download centre in Discord as messages (design "Addon-Downloadzentrale",
// Okt 2026) — pure builders; services/addons/addonCenter.js gathers the data, posts
// and redraws, services/addons/addonCenterBot.js answers the buttons.
//
// The centre (Board 1), ONE Components V2 message:
//   head container (accent #8a7cff)  "## Addon-Downloadzentrale" and how it works
//   one container per addon          in the addon's colour: "### <emoji> Name [NEU]", the
//                                    short description, "-# Version 0.3.0 · 12.10.2026 ·
//                                    Patchnotes" (the link opens the addon's card on the web
//                                    page "Addons", where its release notes are) and
//                                    "Herunterladen" as the section's button — without a
//                                    release a short note instead of the button
// Nothing is announced when a new version appears (no update message, no ping): the
// centre only shows "NEU" and the newest version.
//
// Discord allows 40 components per message (nested ones included) and 4000
// characters of text: the head takes 2, an addon 4 (container, section, text,
// button) or 2 (container, text); addons that do not fit are left out with a line
// in the head (the caller logs it), descriptions are cut to share the text budget.
// Public texts go through tr() in the server's language (docs/bot-commands.md).
const {
    ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder,
} = require("discord.js");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { tr } = require("../../utils/i18n/botText");
const { emojiText, addonEmojiName } = require("../discord/appEmojis");
const { webUrl } = require("../../utils/discord/botLookup");

/** The customId prefix of every button of the centre (commands/lookup/addonCenterButton.js). */
const CENTER_PREFIX = "addonhub";
const COMPONENT_LIMIT = 40;
const TEXT_LIMIT = 4000;
/** How long an addon carries "NEU" after a new version. */
const NEW_MS = 7 * 24 * 60 * 60 * 1000;
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

/** The detail page of an addon on the web (/addon/<id>), where its release notes are, whatever version the menu shows. */
const patchNotesUrl = (addonId) => webUrl(`/addon/${encodeURIComponent(str(addonId))}`);

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
 * @param {string} [o.lang]
 * @param {string} [o.versionLabel] the game version shown (named in the empty state)
 * @param {object} [o.emojis] the bot's application emojis (appEmojis.appEmojiMap())
 * @param {number} [o.now]
 * @returns {{ payload: object, shown: number, dropped: number }}
 */
function centerPayload({ entries = [], lang = "de", emojis = {}, now = Date.now(), versionLabel = "" } = {}) {
    const headText = [
        `## ${tr(lang, "Addon download centre")}`,
        tr(lang, "Click **Download** – the file comes only for you. Unpack it into `Interface\\AddOns`."),
    ].join("\n");
    const headCost = 2;
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
            sub: `-# ${[version, hasFiles(e) ? "" : stateNote(e, lang), e.release ? `[${tr(lang, "Patch notes")}](${patchNotesUrl(e.addon.id)})` : ""].filter(Boolean).join(" · ")}`,
            desc: escapeMd(cut(e.addon.description, DESCRIPTION_MAX)),
        };
    });
    // the descriptions share what is left of the 4000 characters
    const more = dropped > 0 ? `-# ${tr(lang, "{count} more addons are on the download page.", { count: dropped })}` : "";
    const fixed = headText.length + more.length + 1 + lines.reduce((n, l) => n + l.head.length + l.sub.length + 2, 0);
    const share = lines.length ? Math.max(0, Math.floor((TEXT_LIMIT - fixed) / lines.length)) : 0;

    const head = new ContainerBuilder().setAccentColor(COLOR_CENTER);
    const headContent = more ? `${headText}\n${more}` : headText;
    head.addTextDisplayComponents(text(headContent));
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
            .addTextDisplayComponents(text(versionLabel
                ? tr(lang, "There are no addons for {version} here.", { version: versionLabel })
                : tr(lang, "There are no addons for this channel's game version."))).toJSON());
    }
    return {
        payload: { flags: MessageFlags.IsComponentsV2, components, content: "", embeds: [] },
        shown: lines.length,
        dropped,
    };
}

/** `{ action, addonId, assetId }` of a customId of the centre. */
function parseCenterId(customId) {
    const [, action = "", addonId = "", assetId = ""] = str(customId).split(":");
    return { action, addonId, assetId };
}

module.exports = {
    CENTER_PREFIX, COMPONENT_LIMIT, TEXT_LIMIT, NEW_MS, COLOR_CENTER, ADDON_COLORS, patchNotesUrl,
    centerPayload, addonColor, dateText, isNew, downloadId, fileId, parseCenterId, escapeMd,
};
