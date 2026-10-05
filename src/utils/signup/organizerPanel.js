// The raider organizer: the panel a raid category's channel carries (design B
// of the organizer canvas, Okt 2026) and what its personal buttons answer. Pure
// builders — services/signups/organizer.js gathers the data,
// services/signups/availabilityPanel.js posts and redraws the panel,
// commands/signup/availability.js answers the buttons.
//
// The panel is a Components V2 message: one container with a heading, then
// one area per topic, each with a line of text and its button beside or below
// it, the areas split by lines with Discord's large gap. Dates are Discord
// timestamps (`<t:…:d> <t:…:t>`, `<t:…:R>`): every reader sees their own time
// zone and language, and "in 3 days" counts down by itself.
//
// customIds (all `availability:…`, answered by the slash command's module):
//   availability:a|p|l:<categoryId>   absence, attendance, own entries (availabilityDialog.js)
//   availability:r:<categoryId>       "My raid"       → myRaidPayload
//   availability:o:<categoryId>       "Evaluation"    → myReportPayload
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder,
} = require("discord.js");
const { tr } = require("../i18n/botText");
const { buildEmbed } = require("../discord/reply");
const { panelButtons, plainCategoryName } = require("./availabilityDialog");
const { emojiText, specEmojiName, uiEmojiName, statusEmojiName } = require("../../services/discord/appEmojis");

// The bot's application emojis (services/discord/appEmojis.js) where it has
// them — the spec icon before a character, the flat date and status icons —
// else the unicode sign, so a bot without its emojis still reads fine.
const DATE_ICON = (emojis) => emojiText(emojis, uiEmojiName("date"), "📅");

const COLOR_PANEL = 0x1ea1f1;
const COLOR_PERSONAL = 0x5865f2;
/** Link buttons per category: one action row. */
const MAX_LINKS = 5;

const id = (action, categoryId = "") => `availability:${action}:${categoryId}`;
const text = (content) => new TextDisplayBuilder().setContent(content);
// a line with the large gap between two areas; a gap without a line between a text and its buttons
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
const gap = (size = SeparatorSpacingSize.Small) => new SeparatorBuilder().setDivider(false).setSpacing(size);
const linkButton = (label, url) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);

/** A section: text on the left, one button on the right. */
function section(content, button) {
    return new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(button);
}

/** `<t:…:d> <t:…:t>` — the short date and time, in the reader's zone. */
function shortWhen(seconds) {
    return `<t:${seconds}:d> <t:${seconds}:t>`;
}

/**
 * The organizer of a raid category, in the server language.
 * @param {object} o
 * @param {string} o.categoryId
 * @param {string} [o.categoryName] Discord's name, decoration and all
 * @param {string} [o.lang]
 * @param {{ startTime: number, attending: number } | null} [o.nextRaid] the next own raid of the category
 * @param {{ label: string, url: string }[]} [o.links] the category's links (Einstellungen → Kategorien)
 * @param {object} [o.emojis] the bot's application emojis by name (appEmojis.appEmojiMap())
 * @returns {{ flags: number, components: object[], embeds: [] }} API JSON; `embeds: []` clears an old embed panel on edit
 */
function organizerPayload({ categoryId = "", categoryName = "", lang = "de", nextRaid = null, links = [], emojis = {} } = {}) {
    const category = plainCategoryName(categoryName);
    const vars = { category };
    const c = new ContainerBuilder().setAccentColor(COLOR_PANEL);
    c.addTextDisplayComponents(text(`## ${category ? tr(lang, "Raid hub · {category}", vars) : tr(lang, "Raid hub")}\n-# ${category
        ? tr(lang, "Everything for your {category} raids in one place", vars)
        : tr(lang, "Everything for your raids in one place")}`));

    c.addSeparatorComponents(line());
    const start = nextRaid && Number(nextRaid.startTime) > 0 ? Math.floor(Number(nextRaid.startTime)) : 0;
    if (start) {
        const head = `${DATE_ICON(emojis)} **${tr(lang, "Next raid")}** · ${shortWhen(start)}`;
        const sub = `-# <t:${start}:R> · ${tr(lang, "{count} signed up", { count: Math.max(0, Number(nextRaid.attending) || 0) })}`;
        c.addSectionComponents(section(`${head}\n${sub}`, new ButtonBuilder().setCustomId(id("r", categoryId)).setLabel(tr(lang, "My raid")).setStyle(ButtonStyle.Primary)));
    } else {
        c.addTextDisplayComponents(text(`${DATE_ICON(emojis)} **${tr(lang, "Next raid")}**\n-# ${tr(lang, "No raid planned yet.")}`));
    }

    c.addSeparatorComponents(line());
    c.addTextDisplayComponents(text(`🏖️ **${tr(lang, "Absence & attendance")}**\n-# ${tr(lang, "Enter a period – the bot signs you off or up for every raid in it.")}`));
    c.addSeparatorComponents(gap());
    c.addActionRowComponents(panelButtons(categoryId, lang));

    c.addSeparatorComponents(line());
    c.addSectionComponents(section(
        `📊 **${tr(lang, "Your evaluation")}**\n-# ${tr(lang, "Your latest raid, your points, your characters")}`,
        new ButtonBuilder().setCustomId(id("o", categoryId)).setLabel(tr(lang, "Evaluation")).setStyle(ButtonStyle.Secondary),
    ));

    const usable = (links || []).filter((l) => l && l.label && l.url).slice(0, MAX_LINKS);
    if (usable.length) {
        c.addSeparatorComponents(line());
        c.addTextDisplayComponents(text(`🔗 **${tr(lang, "Links")}**`));
        c.addSeparatorComponents(gap());
        c.addActionRowComponents(new ActionRowBuilder().addComponents(usable.map((l) => linkButton(l.label, l.url))));
    }

    c.addSeparatorComponents(gap(SeparatorSpacingSize.Large));
    c.addTextDisplayComponents(text(`-# ${tr(lang, "Personal answers are only visible to you")}`));
    return { flags: MessageFlags.IsComponentsV2, components: [c.toJSON()], embeds: [] };
}

// What a raider's own signup says, by status (utils/attendance.js' statuses).
const SIGNUP_LINE = {
    signed: "You are signed up as **{character}** · {spec}.",
    late: "You are signed up as **{character}** · {spec}, but coming late.",
    tentative: "You are tentatively signed up as **{character}** · {spec}.",
    bench: "You are on the bench with **{character}** · {spec}.",
};

/**
 * "My raid": the category's next raid, the reader's own signup and the way to
 * it — the signup message and, once published, the raid plan.
 * @param {object} o
 * @param {{ title?: string, startTime: number } | null} o.event
 * @param {{ status: string, character?: string } | null} [o.signup]
 * @param {string} [o.specText] the signup's spec in the reader's language
 * @param {string} [o.specKey] the signup's spec key ("Mage-Arcane"), for its icon
 * @param {string} [o.signupUrl] the signup message, "" when it is gone
 * @param {string} [o.planUrl] the published raid plan, "" without one
 * @param {string} [o.categoryName]
 * @param {string} [o.lang]
 * @param {object} [o.emojis] the bot's application emojis by name
 */
function myRaidPayload({ event, signup = null, specText = "", specKey = "", signupUrl = "", planUrl = "", categoryName = "", lang = "de", emojis = {} } = {}) {
    const category = plainCategoryName(categoryName);
    if (!event) {
        return { embeds: [buildEmbed({ title: tr(lang, "Next raid"), description: tr(lang, "No raid planned yet."), color: COLOR_PERSONAL })], components: [] };
    }
    const start = Math.floor(Number(event.startTime) || 0);
    let status;
    if (!signup) status = tr(lang, "You are not signed up yet.");
    else if (signup.status === "absence") status = tr(lang, "You signed off from this raid.");
    else {
        // the spec icon before the name, like the signup message draws it
        const character = [emojiText(emojis, specEmojiName(specKey)), signup.character || "?"].filter(Boolean).join(" ");
        status = tr(lang, SIGNUP_LINE[signup.status] || SIGNUP_LINE.signed, { character, spec: specText || "?" });
    }
    const statusIcon = signup ? emojiText(emojis, statusEmojiName(signup.status)) : "";
    if (statusIcon) status = `${statusIcon} ${status}`;
    const title = [event.title, category].filter(Boolean).join(" · ") || tr(lang, "Next raid");
    const buttons = [
        signupUrl ? linkButton(signup ? tr(lang, "To the signup") : tr(lang, "Sign up"), signupUrl) : null,
        planUrl ? linkButton(tr(lang, "Raid plan"), planUrl) : null,
    ].filter(Boolean);
    return {
        embeds: [buildEmbed({ title, description: `${DATE_ICON(emojis)} ${shortWhen(start)} · <t:${start}:R>\n\n${status}`, color: COLOR_PERSONAL })],
        components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
    };
}

/**
 * "Evaluation": the newest evaluation one of the reader's characters is in,
 * with the way to their own page of it, and to their profile.
 * @param {object} o
 * @param {{ title: string, generatedAt: number, character: string } | null} o.report
 * @param {string} [o.reportUrl] the raider's page of that evaluation
 * @param {string} [o.profileUrl] "Mein Profil" in the web
 * @param {string} [o.lang]
 */
function myReportPayload({ report = null, reportUrl = "", profileUrl = "", lang = "de" } = {}) {
    const description = report
        ? tr(lang, "**{title}** · {date}\nYour character: **{character}**", {
            title: report.title || tr(lang, "Raid"),
            date: report.generatedAt ? `<t:${Math.floor(Number(report.generatedAt) / 1000)}:D>` : "",
            character: report.character,
        })
        : tr(lang, "No evaluation with one of your characters yet. Add your characters to your profile so the bot finds you in the logs.");
    const buttons = [
        report && reportUrl ? linkButton(tr(lang, "Open evaluation"), reportUrl) : null,
        profileUrl ? linkButton(tr(lang, "My profile"), profileUrl) : null,
    ].filter(Boolean);
    return {
        embeds: [buildEmbed({ title: tr(lang, "Your evaluation"), description, color: COLOR_PERSONAL })],
        components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
    };
}

module.exports = { organizerPayload, myRaidPayload, myReportPayload, MAX_LINKS };
