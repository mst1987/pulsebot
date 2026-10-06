// The guild bank's request form from the stock (#633), for the raider, in their
// language. Pure builders; the flow is commands/signup/availability.js, the
// data services/signups/guildBank.js (offerFor, charactersFor).
//
//   1. "Make a request" in the organizer → pickPayload: an ephemeral card,
//      "What do you need?", the bank's state, and per group a heading
//      ("**Edelsteine**", "-# 4 kinds") with its own select — every option an
//      item the orga offers with something left: its name, "Available: N"
//      (+ "max. N per request"), its application emoji (services/guildbank/
//      itemEmojis.js; none yet = no emoji).
//   2. Picking an item → itemModal "Guild bank request": the item as text
//      ("**Name** · Available: N · max. N"), "How many?", "What for?
//      (optional)" and — only with more than one character of the bank's game
//      version — "To which character?", the first one preselected (the
//      raider's own order decides, there is no main).
//
// customIds:
//   availability:bp:<categoryId>:<n>             the select of the n-th group (value = item id)
//   availability:mbi:<categoryId>:<itemId>       the submitted item modal
//
// Discord's limits: 25 options per select, 40 components per message (a group
// costs four: divider, heading, row, select) — groups beyond MAX_GROUPS and
// items beyond 25 are left out, the card says so.
const { StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { tr } = require("../i18n/botText");
const { card } = require("../discord/card");

const PREFIX = "availability";
/** Options per select (Discord). */
const MAX_OPTIONS = 25;
/** Components per message (Discord) and what the card needs besides the groups: container, head, divider + note. */
const MAX_COMPONENTS = 40;
const FIXED_COMPONENTS = 4;
const PER_GROUP = 4;
const MAX_GROUPS = Math.floor((MAX_COMPONENTS - FIXED_COMPONENTS) / PER_GROUP);
const AMOUNT_MAX_LENGTH = 6;
const PURPOSE_MAX = 100;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

const pickId = (categoryId, n) => `${PREFIX}:bp:${categoryId}:${n}`;
const modalId = (categoryId, itemId) => `${PREFIX}:mbi:${categoryId}:${Number(itemId) || 0}`;

/** The item id of an `availability:mbi:<categoryId>:<itemId>` customId, 0 when there is none. */
function itemIdOfModal(customId) {
    const parts = String(customId || "").split(":");
    return parts[1] === "mbi" ? Math.max(0, Math.floor(Number(parts[3]) || 0)) : 0;
}

/** "Available: 10 · max. 5 per request" in the reader's language. */
function availabilityText(item, lang = "de", { perRequest = true } = {}) {
    const parts = [tr(lang, "Available: {count}", { count: Number(item.available) || 0 })];
    const max = Number(item.maxPerRequest) || 0;
    if (max > 0) parts.push(perRequest ? tr(lang, "max. {count} per request", { count: max }) : tr(lang, "max. {count}", { count: max }));
    return parts.join(" · ");
}

/** The select option emoji of an item (`{ id, name }`, its `gb_<itemId>` application emoji), undefined without one. */
function itemEmojiOption(item) {
    const id = str(item && item.emojiId);
    return id ? { id, name: `gb_${Number(item.itemId) || 0}` } : undefined;
}

/** "4 kinds" / "1 kind". */
const kindsText = (count, lang) => (count === 1 ? tr(lang, "1 kind") : tr(lang, "{count} kinds", { count }));

/** The select of one group. */
function groupSelect(categoryId, n, items, lang) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(pickId(categoryId, n))
        .setPlaceholder(tr(lang, "Pick an item …"))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(items.slice(0, MAX_OPTIONS).map((item) => {
            const option = {
                label: (str(item.name) || `Item ${item.itemId}`).slice(0, 100),
                description: availabilityText(item, lang).slice(0, 100),
                value: String(item.itemId),
            };
            const emoji = itemEmojiOption(item);
            if (emoji) option.emoji = emoji;
            return option;
        }));
    return new ActionRowBuilder().addComponents(select);
}

/**
 * Step 1: the ephemeral card with one select per group.
 * @param {{ categoryId?: string, bank: { scannedAt: number }, groups: { name: string, items: object[] }[], lang?: string }} o
 */
function pickPayload({ categoryId = "", bank, groups = [], lang = "de" } = {}) {
    const shown = groups.slice(0, MAX_GROUPS);
    const parts = [];
    shown.forEach((group, n) => {
        const name = str(group.name) || tr(lang, "Other");
        const more = group.items.length > MAX_OPTIONS ? ` · ${tr(lang, "{count} shown", { count: MAX_OPTIONS })}` : "";
        parts.push("---", `**${name}**\n-# ${kindsText(group.items.length, lang)}${more}`, groupSelect(categoryId, n, group.items, lang));
    });
    const scanned = Math.floor((Number(bank && bank.scannedAt) || 0) / 1000);
    const notes = [tr(lang, "Next the bot asks for the amount and what it is for.")];
    if (groups.length > shown.length) notes.push(tr(lang, "{count} more categories are not shown.", { count: groups.length - shown.length }));
    return card({
        kind: "info",
        kicker: tr(lang, "Guild bank"),
        title: tr(lang, "What do you need?"),
        text: [
            scanned ? tr(lang, "Bank as of: {when}.", { when: `<t:${scanned}:R>` }) : "",
            tr(lang, "You only see what the orga has released."),
        ].filter(Boolean).join(" "),
        parts,
        note: notes.join(" "),
        ephemeral: true,
    });
}

/** A modal field: label + one component (Discord's Label component, type 18). */
const labelled = (label, component) => ({ type: 18, label: String(label).slice(0, 45), component });

/** "Name-Realm" of a profile character for the select. */
const characterLabel = (c) => `${str(c.name)}${str(c.realm) ? `-${str(c.realm).replace(/\s+/g, "")}` : ""}`;

/**
 * Step 2: the modal for one item (plain API JSON — text display and label
 * components). `characters` are the raider's characters of the bank's game
 * version in their own order; the select shows only with two or more.
 * @param {{ categoryId?: string, item: object, characters?: { key: string, name: string, realm?: string }[], lang?: string }} o
 */
function itemModal({ categoryId = "", item, characters = [], lang = "de" } = {}) {
    const components = [
        { type: 10, content: `**${str(item.name) || `Item ${item.itemId}`}** · ${availabilityText(item, lang, { perRequest: false })}` },
        labelled(tr(lang, "How many?"), {
            type: 4, custom_id: "amount", style: 1, min_length: 1, max_length: AMOUNT_MAX_LENGTH, required: true, placeholder: tr(lang, "e.g. 2"),
        }),
        labelled(tr(lang, "What for? (optional)"), {
            type: 4, custom_id: "purpose", style: 1, max_length: PURPOSE_MAX, required: false, placeholder: tr(lang, "e.g. Black Temple on Thursday"),
        }),
    ];
    if (characters.length > 1) {
        components.push(labelled(tr(lang, "To which character?"), {
            type: 3, custom_id: "character", min_values: 1, max_values: 1, required: true,
            options: characters.slice(0, MAX_OPTIONS).map((c, i) => ({ label: characterLabel(c).slice(0, 100), value: String(c.key).slice(0, 100), default: i === 0 })),
        }));
    }
    return { custom_id: modalId(categoryId, item.itemId), title: tr(lang, "Guild bank request").slice(0, 45), components };
}

module.exports = {
    MAX_OPTIONS, MAX_GROUPS, pickId, modalId, itemIdOfModal, availabilityText, itemEmojiOption, pickPayload, itemModal,
};
