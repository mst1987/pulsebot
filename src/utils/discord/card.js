// One designed card for every message of the bot (direction C of the "Bot-Nachrichten" canvas, Oct 2026): a Components V2
// container with an accent bar by kind, a small line above the heading (the raid, the area), the heading, the text, a line of
// facts ("**Gruppe** 3 · **Rolle** Heiler"), an optional picture on the right, the buttons INSIDE the card and a small grey note
// at its foot. One card replaces the old "text plus embed" pair, which Discord showed as two blocks.
//
//   card({ kind, color, kicker, title, text, facts, fields, parts, thumbnail, buttons, note, mentions, allowedMentions, ephemeral })
//
// - parts: a body of its own between the facts and the buttons, in order — a string is a text display, "---" a thin
//   divider, an action row (builder or JSON, a select menu say) stays a row. For cards that interleave headings and
//   controls (the guild bank's request form: a heading and a select per group).
// - kind: "info" (accent), "ok", "warn", "error", "raid" (pass the event's `color`); `color` overrides any kind.
// - mentions: "<@1> <@2>" — the card's first line. A mention pings from a container as from a text message (tried on the
//   dev server); without `mentions` nothing in the card pings (`allowedMentions: { parse: [] }`) unless the caller says so.
// - buttons: ButtonBuilders (five to a row) and/or ready action rows (ActionRowBuilder or its JSON, select menus too).
// - fields: an embed's fields — the inline ones become the facts line, the others a bold name over their value.
//
// The payload carries `content: ""` and `embeds: []`, so the same card sends a new message and turns an old text or embed
// message into the card on edit (both tried on the dev server). Text is cut to Discord's limit of 4000 characters per message.
const {
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
    TextDisplayBuilder, ThumbnailBuilder,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");

const KIND_COLORS = Object.freeze({ info: embedAccentColor, ok: 0x57a55a, warn: 0xe0a33a, error: 0xe5534b, raid: embedAccentColor });
/** Discord: at most 4000 characters of text in all text displays of one message, five buttons to a row. */
const CARD_TEXT_LIMIT = 4000;
const ROW_SIZE = 5;

const str = (v) => (v === null || v === undefined ? "" : String(v));

/** `text` cut to `max` characters, ending in "…" when it had to be cut. */
function cut(text, max) {
    const s = str(text);
    if (s.length <= max) return s;
    return max <= 0 ? "" : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Facts as one line: `[{ name, value }]` or `[[name, value]]` → "**Gruppe** 3 · **Rolle** Heiler". */
function factsLine(facts) {
    return (Array.isArray(facts) ? facts : [])
        .map((f) => (Array.isArray(f) ? { name: f[0], value: f[1] } : f || {}))
        .filter((f) => str(f.value).trim())
        .map((f) => (str(f.name).trim() ? `**${str(f.name).trim()}** ${str(f.value).trim()}` : str(f.value).trim()))
        .join(" · ");
}

/** The buttons as action rows: ButtonBuilders five to a row, ready rows (builder or JSON) as they are. */
function buttonRows(buttons) {
    const rows = [];
    let loose = [];
    const flush = () => { if (loose.length) { rows.push(new ActionRowBuilder().addComponents(loose)); loose = []; } };
    for (const b of Array.isArray(buttons) ? buttons : []) {
        if (!b) continue;
        const json = typeof b.toJSON === "function" ? b.toJSON() : b;
        if (json && json.type === 1) { flush(); rows.push(b instanceof ActionRowBuilder ? b : new ActionRowBuilder(json)); continue; }
        loose.push(b instanceof ButtonBuilder ? b : new ButtonBuilder(json));
        if (loose.length === ROW_SIZE) flush();
    }
    flush();
    return rows;
}

/**
 * The card as a message payload (see the head comment).
 * @returns {{ flags: number, components: object[], content: "", embeds: [], allowedMentions: object }}
 */
function card({
    kind = "info", color, kicker, title, text, facts, fields, parts, thumbnail, buttons, note, mentions, allowedMentions, ephemeral = false,
} = {}) {
    let budget = CARD_TEXT_LIMIT;
    const take = (s) => { const out = cut(s, budget); budget -= out.length; return out; };
    const accent = Number.isInteger(color) ? color : (KIND_COLORS[kind] !== undefined ? KIND_COLORS[kind] : KIND_COLORS.info);
    const c = new ContainerBuilder().setAccentColor(accent);
    const add = (content) => { const t = take(content); if (t.trim()) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t)); };

    if (str(mentions).trim()) add(str(mentions).trim());

    const list = Array.isArray(fields) ? fields.filter((f) => f && (str(f.name).trim() || str(f.value).trim())) : [];
    const inline = list.filter((f) => f.inline);
    const blocks = list.filter((f) => !f.inline);

    const head = [
        str(kicker).trim() ? `-# ${str(kicker).trim()}` : "",
        str(title).trim() ? `## ${str(title).trim()}` : "",
        str(Array.isArray(text) ? text.join("\n") : text).trim(),
    ].filter(Boolean).join("\n");
    const pic = str(thumbnail).trim();
    if (head && pic) {
        const t = take(head);
        c.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(t || "​"))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(pic)));
    } else if (head) add(head);

    const line = factsLine([...(Array.isArray(facts) ? facts : []), ...inline]);
    if (line) add(line);
    for (const f of blocks) add(`**${str(f.name).trim()}**\n${str(f.value).trim()}`);
    for (const part of Array.isArray(parts) ? parts : []) {
        if (!part) continue;
        if (part === "---") c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        else if (typeof part === "string") add(part);
        else c.addActionRowComponents(buttonRows([part]));
    }

    const rows = buttonRows(buttons);
    const foot = str(note).trim();
    if (rows.length || foot) c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    if (rows.length) c.addActionRowComponents(rows);
    if (foot) add(`-# ${foot}`);

    return {
        flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        components: [c.toJSON()],
        content: "",
        embeds: [],
        allowedMentions: allowedMentions || (str(mentions).trim() ? { parse: ["users", "roles"] } : { parse: [] }),
    };
}

/**
 * An embed spec (reply.js' buildEmbed input: title, description, fields, color, footer, author) as a card — what the reply
 * helpers send now. `footer` (a text or `{ text }`) becomes the note, `author` the line above the heading.
 */
function cardFromEmbed(embed = {}, opts = {}) {
    const e = embed || {};
    const footer = e.footer && typeof e.footer === "object" ? e.footer.text : e.footer;
    return card({
        kind: opts.kind || "info",
        color: Number.isInteger(e.color) ? e.color : undefined,
        kicker: e.author,
        title: e.title,
        text: e.description,
        fields: e.fields,
        note: footer,
        ...opts,
    });
}

/**
 * `payload` as an ephemeral reply, KEEPING its own flags. Never `{ ...payload, flags: MessageFlags.Ephemeral }`: that drops a
 * card's Components V2 flag, and Discord refuses a container without it.
 */
const asEphemeral = (payload) => ({ ...(payload || {}), flags: (Number(payload && payload.flags) || 0) | MessageFlags.Ephemeral });

module.exports = { card, cardFromEmbed, asEphemeral, factsLine, KIND_COLORS, CARD_TEXT_LIMIT };
