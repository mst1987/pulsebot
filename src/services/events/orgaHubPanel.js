// The Orga-Zentrale of a raid category as a Discord message (design "A · Liste
// je Raid", Okt 2026) — a pure builder; services/events/orgaHub.js gathers the
// data, posts and redraws it.
//
// One Components V2 container in the orga's turquoise:
//   heading       "Orga-Zentrale · <Kategorie>", "<n> Raids in den nächsten 4 Wochen"
//   summary       the counts by status with their icons ("1 Setup offen · 1 geändert …")
//   buttons       "Raid anlegen" (orga:new:<categoryId>, commands/event/orgaHubButton.js),
//                 the link "Alle Raids im Web" and "Links ..." (orga:links:<categoryId>:
//                 the orga manages the links in Discord, services/events/orgaHubLinks.js)
//   links         the category's orga links as link buttons in a row of their own
//                 (none = no row), stores/orgaHubStore.js
//   one section per raid, soonest first, at most MAX_RAIDS:
//                 **title** / date · countdown · channel / status icon, label, detail
//                 with a link button into the web on the right (none for a cancelled raid)
//   footer        a small note
//
// Orga texts stay German (CLAUDE.md, "Language"). Dates are Discord timestamps,
// so every reader sees their own time zone and "in 3 Tagen" counts down by
// itself. Discord allows 40 components per message: 6 for the head, 3 per raid
// (section, text, button) and 2 for the foot stay under it with ten raids; the
// links row (1 row + 1 per link) takes room away from the raids (raidCapacity),
// so the message always fits.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder,
} = require("discord.js");
const { emojiText, uiEmojiName } = require("../discord/appEmojis");
const { linkButton } = require("../../utils/discord/buttonEmoji");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");

/** The web's orga colour (--orga-teal). */
const COLOR_ORGA = 0x35d6c4;
/** Raids listed in the message; the rest is in the web. */
const MAX_RAIDS = 10;
/** Discord's limit of components in one message, nested ones and the container included. */
const COMPONENT_LIMIT = 40;
/** Container, heading text, buttons row with its three buttons, divider (head); divider, footer text (foot). */
const FIXED_COMPONENTS = 1 + 1 + 1 + 3 + 1 + 2;
/** Section + text + button of one raid. */
const COMPONENTS_PER_RAID = 3;
/** The customId prefix of "Raid anlegen" (commands/event/orgaHubButton.js). */
const NEW_RAID_PREFIX = "orga";

// The unicode stand-ins while the bot's own status icons are not uploaded yet.
const FALLBACK_ICONS = {
    signup: "⚪", open: "🟠", draft: "🔵", approved: "☑️", posted: "✅", changed: "❗", cancelled: "✖️",
};

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
const newRaidId = (categoryId) => `${NEW_RAID_PREFIX}:new:${categoryId}`;
const linksId = (categoryId) => `${NEW_RAID_PREFIX}:links:${categoryId}`;

/** Whether a part of the hub is on (orgaHubStore.getFeatures; a missing key = on). */
const isOn = (features, key) => !(features && typeof features === "object" && features[key] === false);

/**
 * How many raids fit next to `linkCount` link buttons (never more than MAX_RAIDS). `features`
 * switched off (#969) free room: no "Raid anlegen" button, no "Links …" button and no links row.
 * "Alle Raids im Web" is always counted, whether a public address is set or not.
 */
function raidCapacity(linkCount = 0, features = {}) {
    const linksOn = isOn(features, "links");
    const links = linksOn ? Math.max(0, Number(linkCount) || 0) : 0;
    const missingButtons = (isOn(features, "newRaid") ? 0 : 1) + (linksOn ? 0 : 1);
    const used = FIXED_COMPONENTS - missingButtons + (links ? 1 + links : 0);
    return Math.max(0, Math.min(MAX_RAIDS, Math.floor((COMPONENT_LIMIT - used) / COMPONENTS_PER_RAID)));
}

/** The status icon: the bot's application emoji, else its unicode stand-in. */
function statusIcon(emojis, status) {
    return emojiText(emojis, uiEmojiName(`orga${status}`), FALLBACK_ICONS[status] || "");
}

/** `<t:…:d> <t:…:t>` — the short date and time, like the raid hub. */
function shortWhen(seconds) {
    return `<t:${seconds}:d> <t:${seconds}:t>`;
}

/** Discord's markdown characters escaped in a title. */
const escapeMd = (s) => String(s || "").replace(/([\\*_~`|>])/g, "\\$1");

/** The three lines of one raid. */
function raidLines(raid, emojis) {
    const start = Math.floor(Number(raid.startTime) || 0);
    const cancelled = raid.status === "cancelled";
    const strike = (s) => (cancelled ? `~~${s}~~` : s);
    const where = [start ? `${shortWhen(start)} · <t:${start}:R>` : "", raid.channelId ? `<#${raid.channelId}>` : ""].filter(Boolean).join(" · ");
    const status = [statusIcon(emojis, raid.status), `**${raid.label}**`, raid.detail ? `· ${raid.detail}` : ""].filter(Boolean).join(" ");
    return [strike(`**${escapeMd(raid.title) || "Raid"}**`), where ? strike(where) : "", status].filter(Boolean).join("\n");
}

/**
 * The hub of one raid category.
 * @param {object} o
 * @param {string} o.categoryId
 * @param {string} [o.categoryName] Discord's name, decoration and all
 * @param {{ title: string, startTime: number, channelId: string, status: string, label: string, detail: string, url: string }[]} [o.raids]
 *   the category's raids in the next weeks, soonest first (`url` = the button into the web, "" for none)
 * @param {{ status: string, label: string }[]} [o.counts] the summary (orgaStatus.statusCounts)
 * @param {number} [o.total] how many active raids the weeks hold (the heading counts these)
 * @param {{ label: string, url: string }[]} [o.links] the orga links (stores/orgaHubStore.js), at most five
 * @param {string} [o.webUrl] "Alle Raids im Web", "" when no public address is set
 * @param {number} [o.weeks] how far ahead it looks
 * @param {object} [o.emojis] the bot's application emojis by name (appEmojis.appEmojiMap())
 * @param {object} [o.features] the parts switched on/off (orgaHubStore.getFeatures, #969): `newRaid` = the
 *   "Raid anlegen" button, `links` = "Links …" plus the links row, `summary` = the status line.
 *   A missing key = on; the raid list always stays, an empty buttons row is left out.
 * @returns {{ flags: number, components: object[], embeds: [], content: "" }} API JSON
 */
function orgaHubPayload({ categoryId = "", categoryName = "", raids = [], counts = [], links = [], total = 0, webUrl = "", weeks = 4, emojis = {}, features = {} } = {}) {
    const category = plainCategoryName(categoryName);
    const c = new ContainerBuilder().setAccentColor(COLOR_ORGA);
    const n = Math.max(0, Number(total) || 0);
    const when = `in den nächsten ${weeks} Wochen`;
    const sub = n ? `${n} ${n === 1 ? "Raid" : "Raids"} ${when}` : `Keine Raids ${when}`;
    const summary = isOn(features, "summary") ? (counts || []).map((s) => `${statusIcon(emojis, s.status)} ${s.label}`).join(" · ") : "";
    c.addTextDisplayComponents(text([`## Orga-Zentrale${category ? ` · ${category}` : ""}`, `-# ${sub}`, summary].filter(Boolean).join("\n")));

    const newRaidOn = isOn(features, "newRaid");
    const linksOn = isOn(features, "links");
    const buttons = [];
    if (newRaidOn) buttons.push(new ButtonBuilder().setCustomId(newRaidId(categoryId)).setLabel("Raid anlegen").setStyle(ButtonStyle.Primary));
    if (webUrl) buttons.push(linkButton("Alle Raids im Web", webUrl));
    if (linksOn) buttons.push(new ButtonBuilder().setCustomId(linksId(categoryId)).setLabel("Links …").setStyle(ButtonStyle.Secondary));
    if (buttons.length) c.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
    const shownLinks = linksOn ? (links || []).filter((l) => l && l.label && l.url).slice(0, 5) : [];
    if (shownLinks.length) c.addActionRowComponents(new ActionRowBuilder().addComponents(shownLinks.map((l) => linkButton(l.label, l.url, l.emoji))));

    const cap = raidCapacity(shownLinks.length, features);
    const shown = (raids || []).slice(0, cap);
    c.addSeparatorComponents(line());
    if (!shown.length) c.addTextDisplayComponents(text(newRaidOn ? "Noch kein Raid geplant. „Raid anlegen“ legt den nächsten an." : "Noch kein Raid geplant."));
    for (const raid of shown) {
        const content = raidLines(raid, emojis);
        if (raid.url && raid.linkLabel) {
            c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(linkButton(raid.linkLabel, raid.url)));
        } else {
            c.addTextDisplayComponents(text(content));
        }
    }

    const more = (raids || []).length - shown.length;
    c.addSeparatorComponents(line());
    const foot = [
        more > 0 ? `${more} weitere ${more === 1 ? "Raid steht" : "Raids stehen"} im Web` : "",
        `Aktualisiert sich selbst · vergangene Raids fallen raus · höchstens ${cap} Raids, der Rest steht im Web`,
    ].filter(Boolean).join("\n-# ");
    c.addTextDisplayComponents(text(`-# ${foot}`));
    return { flags: MessageFlags.IsComponentsV2, components: [c.toJSON()], embeds: [], content: "" };
}

module.exports = { orgaHubPayload, statusIcon, newRaidId, linksId, raidCapacity, MAX_RAIDS, COMPONENT_LIMIT, NEW_RAID_PREFIX, COLOR_ORGA, FALLBACK_ICONS };
