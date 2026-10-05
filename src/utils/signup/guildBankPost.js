// The Discord side of guild bank requests (services/signups/guildBank.js): the
// raider's modal, their answer and DM, the post in the orga channel and the
// orga's decline modal. Pure builders.
//
// customIds:
//   availability:b:<categoryId>    the organizer's "Make a request" → requestModal
//   availability:mb:<categoryId>   the submitted request modal (commands/signup/availability.js)
//   guildbank:done:<id>            "Erledigt" under the orga post (commands/signup/guildBank.js)
//   guildbank:reject:<id>          "Ablehnen …" → rejectModal
//   guildbank:mreject:<id>         the submitted decline modal
//
// What the raider reads is in their language (tr); the orga post and the orga's
// modal are orga texts and stay German.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { tr } = require("../i18n/botText");
const { card } = require("../discord/card");
const { buildEmbed } = require("../discord/reply");
const { plainCategoryName } = require("./availabilityDialog");
const { isSnowflake } = require("../ids");

const PREFIX = "guildbank";
const COLOR_OPEN = 0xe8a33d;
const COLOR_DONE = 0x22c55e;
const COLOR_REJECTED = 0x6b7280;
// The longest texts the modals take (the store clips to the same).
const ITEM_MAX = 80;
const AMOUNT_MAX_LENGTH = 6;
const PURPOSE_MAX = 100;
const REASON_MAX = 200;
const STATUS_WORD = { open: "offen", done: "erledigt", rejected: "abgelehnt" };

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/**
 * The guild bank's orga channel of a config (`discordServers.guildBankChannelId`),
 * "" when none is set — then the organizers show no guild bank. Here, below
 * both, because the organizer (availabilityPanel.js) and the service ask it.
 */
function guildBankChannelId(config) {
    const id = str(((config && config.discordServers) || {}).guildBankChannelId);
    return isSnowflake(id) ? id : "";
}
const seconds = (ms) => Math.floor((Number(ms) || 0) / 1000);

/** Markdown, mentions and links out of a typed text — it is shown as typed, nothing more. */
function plain(text) {
    return str(text)
        .replace(/[\\*_~`|>[\]()#]/g, (c) => `\\${c}`)
        .replace(/@/g, "@​")
        .replace(/\s+/g, " ");
}

/** "12× Super Mana Potion", markdown-safe. */
function amountItem(request) {
    return `${Number(request.amount) || 0}× ${plain(request.item)}`;
}

/** The modal a raider fills in from the organizer, in their language. */
function requestModal(categoryId = "", lang = "de") {
    const input = (id, label, placeholder, max, required, style = TextInputStyle.Short) => new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
            .setStyle(style).setMaxLength(max).setRequired(required),
    );
    return new ModalBuilder()
        .setCustomId(`availability:mb:${categoryId}`)
        .setTitle(tr(lang, "Guild bank request"))
        .addComponents(
            input("item", tr(lang, "What do you need?"), tr(lang, "e.g. Super Mana Potion"), ITEM_MAX, true),
            input("amount", tr(lang, "How many?"), tr(lang, "e.g. 10"), AMOUNT_MAX_LENGTH, true),
            input("purpose", tr(lang, "What for? (optional)"), tr(lang, "e.g. Black Temple on Thursday"), PURPOSE_MAX, false),
        );
}

/** The raider's request in a line or two of their language: "**12× Item**" plus what it is for. */
function requestSummary(request, lang = "de") {
    const lines = [`**${amountItem(request)}**`];
    if (str(request.purpose)) lines.push(tr(lang, "For: {purpose}", { purpose: plain(request.purpose) }));
    return lines.join("\n");
}

/** The DM a raider gets once the orga handled the request, in their language: an ok / error card. */
function decisionCard(request, lang = "de") {
    const done = request.status === "done";
    return card({
        kind: done ? "ok" : "error",
        kicker: tr(lang, "Guild bank"),
        title: done ? tr(lang, "Request done") : tr(lang, "Request declined"),
        text: [`**${amountItem(request)}**`, !done && str(request.reason) ? tr(lang, "Reason: {reason}", { reason: plain(request.reason) }) : ""].filter(Boolean).join("\n"),
    });
}

/** The orga post's status line once a request was handled ("" while it is open). German (orga text). */
function statusLine(request) {
    const name = plain(request.handledByName) || "?";
    if (request.status === "done") {
        const at = seconds(request.handledAt);
        return `✅ Erledigt von ${name}${at ? ` · <t:${at}:R>` : ""}`;
    }
    if (request.status === "rejected") return `⛔ Abgelehnt von ${name}${str(request.reason) ? `: ${plain(request.reason)}` : ""}`;
    return "";
}

/**
 * The post in the orga channel: who asks for what, how many, what for, and —
 * while it is open — "Erledigt" and "Ablehnen …". Once handled, the status line
 * replaces the buttons. German (orga text); `<@id>` shows the raider's name and
 * pings nobody (discord.postPayload allows no mentions).
 * @param {object} request a guildBankStore request
 * @param {{ categoryName?: string }} [o] the Discord name of the organizer's category
 */
function orgaPayload(request, { categoryName = "" } = {}) {
    const open = request.status === "open";
    const created = seconds(request.createdAt);
    const description = [`<@${request.userId}>${created ? ` · <t:${created}:R>` : ""}`];
    if (!open) description.push("", statusLine(request));
    const embed = buildEmbed({
        title: `🏦 Anfrage von ${plain(request.userName) || "?"}`,
        description: description.join("\n"),
        color: open ? COLOR_OPEN : request.status === "done" ? COLOR_DONE : COLOR_REJECTED,
        fields: [
            { name: "Gegenstand", value: plain(request.item) || "—", inline: true },
            { name: "Menge", value: String(Number(request.amount) || 0), inline: true },
            { name: "Wofür", value: plain(request.purpose) || "—", inline: true },
        ],
        footer: [plainCategoryName(categoryName), STATUS_WORD[request.status] || STATUS_WORD.open].filter(Boolean).join(" · "),
    });
    const components = open
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:done:${request.id}`).setLabel("Erledigt").setEmoji("✅").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${PREFIX}:reject:${request.id}`).setLabel("Ablehnen …").setStyle(ButtonStyle.Secondary),
        ).toJSON()]
        : [];
    return { content: "", embeds: [embed], components };
}

/** The orga's decline modal: an optional reason the raider sees. German (orga text). */
function rejectModal(requestId) {
    return new ModalBuilder()
        .setCustomId(`${PREFIX}:mreject:${requestId}`)
        .setTitle("Anfrage ablehnen")
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("reason").setLabel("Grund (optional, der Raider sieht ihn)")
                .setPlaceholder("z. B. gerade nicht auf Lager").setStyle(TextInputStyle.Paragraph)
                .setMaxLength(REASON_MAX).setRequired(false),
        ));
}

/** `{ action, id }` of a `guildbank:<action>:<id>` customId. */
function parseOrgaId(customId) {
    const [, action = "", id = ""] = String(customId || "").split(":");
    return { action, id };
}

module.exports = {
    PREFIX, COLOR_OPEN, guildBankChannelId, plain, requestModal, requestSummary, decisionCard, statusLine, orgaPayload, rejectModal, parseOrgaId,
};
