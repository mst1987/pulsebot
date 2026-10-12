// The Orga-Zentrale of a raid category as a Discord message (design "A · Liste
// je Raid", Okt 2026) — a pure builder; services/events/orgaHub.js gathers the
// data, posts and redraws it.
//
// One Components V2 container in the orga's turquoise:
//   heading       "Orga-Zentrale · <Kategorie>", "<n> Raids in den nächsten 4 Wochen"
//   summary       the counts by status with their icons ("1 Setup offen · 1 geändert …")
//   buttons       "Raid anlegen" (orga:new:<categoryId>, commands/event/orgaHubButton.js)
//                 and the link "Alle Raids im Web"
//   one section per raid, soonest first, at most MAX_RAIDS:
//                 **title** / date · countdown · channel / status icon, label, detail
//                 with a link button into the web on the right (none for a cancelled raid)
//   footer        a small note
//
// Orga texts stay German (CLAUDE.md, "Language"). Dates are Discord timestamps,
// so every reader sees their own time zone and "in 3 Tagen" counts down by
// itself. Discord allows 40 components per message: 6 for the head, 3 per raid
// (section, text, button) and 2 for the foot stay under it with ten raids.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder,
} = require("discord.js");
const { emojiText, uiEmojiName } = require("../discord/appEmojis");
const { plainCategoryName } = require("../../utils/signup/availabilityDialog");

/** The web's orga colour (--orga-teal). */
const COLOR_ORGA = 0x35d6c4;
/** Raids listed in the message; the rest is in the web. */
const MAX_RAIDS = 10;
/** The customId prefix of "Raid anlegen" (commands/event/orgaHubButton.js). */
const NEW_RAID_PREFIX = "orga";

// The unicode stand-ins while the bot's own status icons are not uploaded yet.
const FALLBACK_ICONS = {
    signup: "⚪", open: "🟠", draft: "🔵", approved: "☑️", posted: "✅", changed: "❗", cancelled: "✖️",
};

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
const linkButton = (label, url) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
const newRaidId = (categoryId) => `${NEW_RAID_PREFIX}:new:${categoryId}`;

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
 * @param {string} [o.webUrl] "Alle Raids im Web", "" when no public address is set
 * @param {number} [o.weeks] how far ahead it looks
 * @param {object} [o.emojis] the bot's application emojis by name (appEmojis.appEmojiMap())
 * @returns {{ flags: number, components: object[], embeds: [], content: "" }} API JSON
 */
function orgaHubPayload({ categoryId = "", categoryName = "", raids = [], counts = [], total = 0, webUrl = "", weeks = 4, emojis = {} } = {}) {
    const category = plainCategoryName(categoryName);
    const c = new ContainerBuilder().setAccentColor(COLOR_ORGA);
    const n = Math.max(0, Number(total) || 0);
    const when = `in den nächsten ${weeks} Wochen`;
    const sub = n ? `${n} ${n === 1 ? "Raid" : "Raids"} ${when}` : `Keine Raids ${when}`;
    const summary = (counts || []).map((s) => `${statusIcon(emojis, s.status)} ${s.label}`).join(" · ");
    c.addTextDisplayComponents(text([`## Orga-Zentrale${category ? ` · ${category}` : ""}`, `-# ${sub}`, summary].filter(Boolean).join("\n")));

    const buttons = [new ButtonBuilder().setCustomId(newRaidId(categoryId)).setLabel("Raid anlegen").setStyle(ButtonStyle.Primary)];
    if (webUrl) buttons.push(linkButton("Alle Raids im Web", webUrl));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));

    const shown = (raids || []).slice(0, MAX_RAIDS);
    c.addSeparatorComponents(line());
    if (!shown.length) c.addTextDisplayComponents(text("Noch kein Raid geplant. „Raid anlegen“ legt den nächsten an."));
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
        `Aktualisiert sich selbst · vergangene Raids fallen raus · höchstens ${MAX_RAIDS} Raids, der Rest steht im Web`,
    ].filter(Boolean).join("\n-# ");
    c.addTextDisplayComponents(text(`-# ${foot}`));
    return { flags: MessageFlags.IsComponentsV2, components: [c.toJSON()], embeds: [], content: "" };
}

module.exports = { orgaHubPayload, statusIcon, newRaidId, MAX_RAIDS, NEW_RAID_PREFIX, COLOR_ORGA, FALLBACK_ICONS };
