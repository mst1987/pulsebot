// The Discord side of guild bank requests (services/signups/guildBank.js): the
// raider's free-text modal, their answer and DM, the card in the orga channel
// and the orga's decline modal. Pure builders. The request form from the stock
// (the pick card and the item modal) is utils/signup/guildBankPick.js.
//
// customIds:
//   availability:b:<categoryId>    the organizer's "Make a request" → the pick card, or requestModal without stock
//   availability:mb:<categoryId>   the submitted free-text modal (commands/signup/availability.js)
//   guildbank:done:<id>            "Erledigt" under a free-text request (commands/signup/guildBank.js)
//   guildbank:confirm:<id>         "Bestätigen" under a request from the stock: sets the amount aside
//   guildbank:handout:<id>         "Ausgegeben" under a confirmed request
//   guildbank:release:<id>         "Vormerkung lösen": confirmed → open again
//   guildbank:reject:<id>          "Ablehnen …" → rejectModal
//   guildbank:mreject:<id>         the submitted decline modal
//
// What the raider reads is in their language (tr); the orga card and the orga's
// modal are orga texts and stay German.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { tr } = require("../i18n/botText");
const { card } = require("../discord/card");
const { plainCategoryName } = require("./availabilityDialog");
const { isSnowflake } = require("../ids");
const { iconUrl } = require("../loot/wowhead");

const PREFIX = "guildbank";
// The card's accent by status (the design's orange / blue / green / grey).
const COLOR_OPEN = 0xe8a33d;
const COLOR_CONFIRMED = 0x1ea1f1;
const COLOR_DONE = 0x22c55e;
const COLOR_REJECTED = 0x6b7280;
const STATUS_COLOR = { open: COLOR_OPEN, confirmed: COLOR_CONFIRMED, handedOut: COLOR_DONE, done: COLOR_DONE, rejected: COLOR_REJECTED };
// The longest texts the modals take (the store clips to the same).
const ITEM_MAX = 80;
const AMOUNT_MAX_LENGTH = 6;
const PURPOSE_MAX = 100;
const REASON_MAX = 200;

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

/** Who receives a request in game: "Name-Realm", the name alone without a realm, "" without a character. */
function recipientName(request) {
    const name = str(request && request.characterName);
    if (!name) return "";
    const realm = str(request.realm);
    return realm ? `${name}-${realm.replace(/\s+/g, "")}` : name;
}

/** The free-text modal a raider fills in from the organizer (no stock data), in their language. */
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

/** The raider's request in a few lines of their language: "**12× Item**", what it is for, who receives it. */
function requestSummary(request, lang = "de") {
    const lines = [`**${amountItem(request)}**`];
    if (str(request.purpose)) lines.push(tr(lang, "For: {purpose}", { purpose: plain(request.purpose) }));
    const to = recipientName(request);
    if (to) lines.push(tr(lang, "To: {character}", { character: plain(to) }));
    return lines.join("\n");
}

/**
 * The DM a raider gets when the orga moved the request on, in their language:
 * done / declined (free text and stock), confirmed (set aside) and handed out.
 */
function decisionCard(request, lang = "de") {
    const status = request.status;
    const head = `**${amountItem(request)}**`;
    const to = recipientName(request);
    if (status === "confirmed") {
        return card({
            color: COLOR_CONFIRMED,
            kicker: tr(lang, "Guild bank"),
            title: tr(lang, "Request confirmed"),
            text: [head, tr(lang, "Set aside for you – you will get it in game soon."), to ? tr(lang, "To: {character}", { character: plain(to) }) : ""].filter(Boolean).join("\n"),
        });
    }
    if (status === "handedOut") {
        const line = request.handoutVia === "mail"
            ? (to ? tr(lang, "Sent by mail to {character}.", { character: plain(to) }) : tr(lang, "Sent by mail."))
            : (to ? tr(lang, "Handed out to {character}.", { character: plain(to) }) : "");
        return card({
            kind: "ok",
            kicker: tr(lang, "Guild bank"),
            title: tr(lang, "Request handed out"),
            text: [head, line].filter(Boolean).join("\n"),
        });
    }
    const done = status === "done";
    return card({
        kind: done ? "ok" : "error",
        kicker: tr(lang, "Guild bank"),
        title: done ? tr(lang, "Request done") : tr(lang, "Request declined"),
        text: [head, !done && str(request.reason) ? tr(lang, "Reason: {reason}", { reason: plain(request.reason) }) : ""].filter(Boolean).join("\n"),
    });
}

/** The orga card's note: who handled it and how. German (orga text). */
function statusLine(request) {
    const name = plain(request.handledByName) || "?";
    if (request.status === "done") {
        const at = seconds(request.handledAt);
        return `✅ Erledigt von ${name}${at ? ` · <t:${at}:R>` : ""}`;
    }
    if (request.status === "rejected") return `⛔ Abgelehnt von ${name}${str(request.reason) ? `: ${plain(request.reason)}` : ""}`;
    if (request.status === "confirmed") return `Vorgemerkt von ${name} · wartet auf Ausgabe im Spiel`;
    if (request.status === "handedOut") {
        const by = plain(request.handedOutByName) || "?";
        if (request.handoutVia === "mail") return `per Post ausgegeben von ${by}`;
        if (request.handoutVia === "manual") return `ausgegeben von ${by} · im Spiel abgehakt`;
        return `ausgegeben von ${by}`;
    }
    return "";
}

/** "**Bestand** 14 · **Vorgemerkt** 4 · **Verfügbar** 10 (danach 8)" — "danach" only while the request is open. */
function stockFacts(request, stock) {
    if (!stock || !["open", "confirmed"].includes(request.status)) return [];
    const available = Number(stock.available) || 0;
    const after = request.status === "open" ? ` (danach ${Math.max(0, available - (Number(request.amount) || 0))})` : "";
    return [["Bestand", String(Number(stock.count) || 0)], ["Vorgemerkt", String(Number(stock.reserved) || 0)], ["Verfügbar", `${available}${after}`]];
}

/** The card's buttons for the request's status. */
function orgaButtons(request) {
    const id = request.id;
    const button = (action, label, style, emoji) => {
        const b = new ButtonBuilder().setCustomId(`${PREFIX}:${action}:${id}`).setLabel(label).setStyle(style);
        return emoji ? b.setEmoji(emoji) : b;
    };
    const reject = button("reject", "Ablehnen …", ButtonStyle.Secondary);
    if (!request.itemId) return request.status === "open" ? [button("done", "Erledigt", ButtonStyle.Success, "✅"), reject] : [];
    if (request.status === "open") return [button("confirm", "Bestätigen", ButtonStyle.Success, "✅"), reject];
    if (request.status === "confirmed") {
        return [button("handout", "Ausgegeben", ButtonStyle.Secondary), button("release", "Vormerkung lösen", ButtonStyle.Secondary)];
    }
    return [];
}

/**
 * The card in the orga channel: what, how many, for whom, what for — and the
 * buttons of its status. A request from the stock shows the item's icon and
 * the stock's numbers; a free-text one only what was typed. German (orga
 * text); `<@id>` shows the raider's name and pings nobody (discord.postPayload
 * allows no mentions).
 * @param {object} request a guildBankStore request
 * @param {{ categoryName?: string, stock?: object|null }} [o] the organizer's category name; the item as
 *   stockView.stockItem reads it now (count, reserved, available, group, icon), null when unknown
 */
function orgaPayload(request, { categoryName = "", stock = null } = {}) {
    const created = seconds(request.createdAt);
    const fromStock = !!request.itemId;
    const group = fromStock ? str((stock && stock.group) || request.group) : "";
    const text = [`<@${request.userId}>${created ? ` · <t:${created}:R>` : ""}`];
    if (str(request.purpose)) text.push(`Wofür: ${plain(request.purpose)}`);
    const to = recipientName(request);
    if (to) text.push(`An: ${plain(to)}`);
    const status = request.status === "open" ? "offen" : statusLine(request);
    const icon = fromStock ? iconUrl(str((stock && stock.icon) || request.icon)) : "";
    return card({
        color: STATUS_COLOR[request.status] || COLOR_OPEN,
        kicker: group ? `Gildenbank · ${group}` : "Gildenbank",
        title: amountItem(request),
        text: text.join("\n"),
        thumbnail: icon,
        facts: stockFacts(request, stock),
        buttons: orgaButtons(request),
        note: [plainCategoryName(categoryName), status].filter(Boolean).join(" · "),
    });
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
    PREFIX, COLOR_OPEN, COLOR_CONFIRMED, COLOR_DONE, COLOR_REJECTED, guildBankChannelId, plain, amountItem, recipientName,
    requestModal, requestSummary, decisionCard, statusLine, stockFacts, orgaPayload, rejectModal, parseOrgaId,
};
