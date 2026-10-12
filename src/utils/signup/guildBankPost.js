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
//   guildbank:vouch:<id>           "Geprüft & bestätigen" instead, while the request is not linked but
//                                  names a character: the orga vouches for the name and confirms (#806)
//   guildbank:handout:<id>         "Ausgegeben" under a confirmed request
//   guildbank:release:<id>         "Vormerkung lösen": confirmed → open again
//   guildbank:rename:<id>          "Charakter ändern …" (open or confirmed, #809) → renameModal
//   guildbank:mrename:<id>         the submitted rename modal: the request goes to that name
//   guildbank:reject:<id>          "Ablehnen …" → rejectModal
//   guildbank:mreject:<id>         the submitted decline modal
//
// A request that moved up from the waiting list (#775) is a normal open card
// with "aus der Warteliste" in its note; one imported by character name alone
// shows the name instead of the raider ("ohne Discord-Konto, keine DM").
// A request from the stock without a linked character (services/guildbank/
// linking.js) shows "⚠ Kein verknüpfter Charakter – Post erst nach Verknüpfen
// im Web" — or, when its character is a profile character nobody has
// confirmed, "⚠ Charakter nicht bestätigt" — and offers "Geprüft & bestätigen"
// instead of "Bestätigen" (#806: the orga checked the name in game). Without
// any character name ("⚠ Kein Charakter") "Bestätigen" stays disabled until
// the orga links one in the web.
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
// Forever's "Vorname Nachname" (utils/signup/characterNames.js NAME_MAX).
const RENAME_NAME_MAX = 25;

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
 * The answer line of a request that went on the waiting list (#775), in the
 * raider's language: "On the waiting list: **2× Crimson Spinal** – you are
 * no. 4." plus when they hear from the bot.
 */
function waitingSummary(request, position, lang = "de") {
    const line = position > 0
        ? tr(lang, "On the waiting list: {item} – you are no. {position}.", { item: `**${amountItem(request)}**`, position })
        : tr(lang, "On the waiting list: {item}.", { item: `**${amountItem(request)}**` });
    return `${line}\n${tr(lang, "You get a DM as soon as it is your turn.")}`;
}

/**
 * The DM when a waiting-list entry moved up to a request (#775): "Your turn" —
 * the item is in the bank, the orga confirms it next. `rest` = what still
 * waits for the raider (a part moved up), they stay first in line.
 */
function movedUpCard(request, lang = "de", { rest = 0 } = {}) {
    const to = recipientName(request);
    return card({
        color: COLOR_OPEN,
        kicker: tr(lang, "Guild bank"),
        title: tr(lang, "Your turn on the waiting list"),
        text: [
            `**${amountItem(request)}**`,
            tr(lang, "It is in the guild bank now – the orga will confirm it shortly."),
            rest > 0 ? tr(lang, "{count} more stay on the waiting list for you – you are first in line.", { count: rest }) : "",
            to ? tr(lang, "To: {character}", { character: plain(to) }) : "",
        ].filter(Boolean).join("\n"),
    });
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

/** The orga card's warning for a request from the stock without a linked character. German (orga text). */
const NOT_LINKED_LINE = "⚠ **Kein verknüpfter Charakter** – Namen im Spiel prüfen, dann „Geprüft & bestätigen“ (oder im Web verknüpfen)";
/** The same for a profile character no log, loot, armory or orga has confirmed (linking.linkState "unverified"). */
const NOT_VERIFIED_LINE = "⚠ **Charakter nicht bestätigt** – im Spiel prüfen, dann „Geprüft & bestätigen“ (oder im Web: Arsenal)";
/** The same without any character name: nothing to mail to, only the web can link one. */
const NO_CHARACTER_LINE = "⚠ **Kein Charakter** – Post erst nach Verknüpfen im Web (Gildenbank)";

/**
 * The card's line when the stock does not cover an open request (#809) — its
 * own reason, apart from any character problem: "Bestätigen" checks against
 * Verfügbar. German (orga text).
 */
function shortLine(available, amount) {
    return `⚠ **Nicht genug verfügbar** – noch ${available}, angefragt ${amount}. Bestätigen geht wieder, sobald genug frei ist (nächster Scan, gelöste Vormerkung, kleinere Reserve) – oder ablehnen.`;
}

/** Whether the stock (stockView.stockItem) does not cover an open request: then "Bestätigen" would be refused. */
function isShort(request, stock) {
    return !!stock && request.status === "open" && (Number(stock.available) || 0) < (Number(request.amount) || 0);
}

/**
 * The warnings of a card from the stock, each its own reason: the character
 * (open or confirmed, not linked) and the stock (open, not covered, #809).
 */
function warningLines(request, { linked, linkProblem, to, stock, short }) {
    const lines = [];
    if (!linked && (request.status === "open" || request.status === "confirmed")) {
        lines.push(!to ? NO_CHARACTER_LINE : linkProblem === "unverified" ? NOT_VERIFIED_LINE : NOT_LINKED_LINE);
    }
    if (short) lines.push(shortLine(Number(stock.available) || 0, Number(request.amount) || 0));
    return lines;
}

/**
 * The card's buttons for the request's status. Not linked (#806): "Geprüft &
 * bestätigen" while the request names a character (the click vouches for it),
 * else "Bestätigen" disabled; either disabled while the stock does not cover
 * it (`short`, #809). A request from the stock always has "Charakter ändern …"
 * (#809) — the way out of a wrong name without the web — and, while open,
 * "Ablehnen …".
 */
function orgaButtons(request, { linked = true, short = false } = {}) {
    const id = request.id;
    const button = (action, label, style, emoji) => {
        const b = new ButtonBuilder().setCustomId(`${PREFIX}:${action}:${id}`).setLabel(label).setStyle(style);
        return emoji ? b.setEmoji(emoji) : b;
    };
    const reject = button("reject", "Ablehnen …", ButtonStyle.Secondary);
    if (!request.itemId) return request.status === "open" ? [button("done", "Erledigt", ButtonStyle.Success, "✅"), reject] : [];
    const rename = button("rename", "Charakter ändern …", ButtonStyle.Secondary);
    if (request.status === "open") {
        // not linked, but a name to mail to: the orga checks it in game and vouches for it with the click (#806)
        const confirm = !linked && str(request.characterName)
            ? button("vouch", "Geprüft & bestätigen", ButtonStyle.Success, "✅")
            : button("confirm", "Bestätigen", ButtonStyle.Success, "✅").setDisabled(!linked);
        if (short) confirm.setDisabled(true);
        return [confirm, rename, reject];
    }
    if (request.status === "confirmed") {
        return [button("handout", "Ausgegeben", ButtonStyle.Secondary), button("release", "Vormerkung lösen", ButtonStyle.Secondary), rename];
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
 * @param {{ categoryName?: string, stock?: object|null, linked?: boolean, linkProblem?: string }} [o] the organizer's category name; the item as
 *   stockView.stockItem reads it now (count, reserved, available, group, icon), null when unknown; `linked`
 *   false = the request's character is no confirmed profile character (linking.linkState): warning, "Bestätigen" disabled;
 *   `linkProblem` "unverified" names that reason (a profile character nobody confirmed)
 */
function orgaPayload(request, { categoryName = "", stock = null, linked = true, linkProblem = "" } = {}) {
    const created = seconds(request.createdAt);
    const fromStock = !!request.itemId;
    const group = fromStock ? str((stock && stock.group) || request.group) : "";
    // an entry the orga imported by character name has no Discord account (#775)
    const who = request.userId ? `<@${request.userId}>` : `**${plain(request.characterName) || "?"}** · ohne Discord-Konto, keine DM`;
    const text = [`${who}${created ? ` · <t:${created}:R>` : ""}`];
    if (str(request.purpose)) text.push(`Wofür: ${plain(request.purpose)}`);
    const to = recipientName(request);
    if (to) text.push(`An: ${plain(to)}`);
    const short = fromStock && isShort(request, stock);
    if (fromStock) text.push(...warningLines(request, { linked, linkProblem, to, stock, short }));
    const status = request.status === "open" ? "offen" : statusLine(request);
    const icon = fromStock ? iconUrl(str((stock && stock.icon) || request.icon)) : "";
    return card({
        color: STATUS_COLOR[request.status] || COLOR_OPEN,
        kicker: group ? `Gildenbank · ${group}` : "Gildenbank",
        title: amountItem(request),
        text: text.join("\n"),
        thumbnail: icon,
        facts: stockFacts(request, stock),
        buttons: orgaButtons(request, { linked: !fromStock || linked, short }),
        note: [plainCategoryName(categoryName), request.fromWaitlist ? "aus der Warteliste" : "", status].filter(Boolean).join(" · "),
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

/**
 * "Charakter ändern …" (#809): the orga names the character the request goes
 * to in game — the raider stays. Prefilled with the current name and realm;
 * the label says that the name must be checked in game, the submit vouches for
 * it. German (orga text).
 */
function renameModal(request) {
    const input = (id, label, value, max, required, placeholder) => {
        const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
            .setMaxLength(max).setRequired(required).setPlaceholder(placeholder);
        if (str(value)) field.setValue(str(value).slice(0, max));
        return new ActionRowBuilder().addComponents(field);
    };
    return new ModalBuilder()
        .setCustomId(`${PREFIX}:mrename:${request.id}`)
        .setTitle("Empfänger ändern")
        .addComponents(
            input("name", "Charakter (im Spiel geprüft, z. B. per /who)", request.characterName, RENAME_NAME_MAX, true, "z. B. Gentletwowl"),
            input("realm", "Realm (leer = der der Gildenbank)", request.realm, 60, false, "z. B. Thunderstrike"),
        );
}

/** `{ action, id }` of a `guildbank:<action>:<id>` customId. */
function parseOrgaId(customId) {
    const [, action = "", id = ""] = String(customId || "").split(":");
    return { action, id };
}

module.exports = {
    PREFIX, COLOR_OPEN, COLOR_CONFIRMED, COLOR_DONE, COLOR_REJECTED, NOT_LINKED_LINE, NOT_VERIFIED_LINE, NO_CHARACTER_LINE, guildBankChannelId, plain, amountItem, recipientName,
    requestModal, requestSummary, waitingSummary, movedUpCard, decisionCard, statusLine, stockFacts, orgaPayload, rejectModal, renameModal, shortLine, isShort, parseOrgaId,
};
