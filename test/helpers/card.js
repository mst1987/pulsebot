// Reading a card (src/utils/discord/card.js) in a test the way the old embeds were read: `asEmbed(payload)` gives
// `{ title, description, color, author, fields, footer, text }` — the "## " line is the title, the "-# " line above it the
// author (kicker), the rest of that first block the description, the facts line and the bold-name blocks the fields, the
// last "-# " line the footer (the note). `text` is every text of the card joined, for a `toContain`.
// Also takes an old embed payload (`{ embeds: [...] }`), so a test reads both while a module is moved over.
const { ComponentType, MessageFlags } = require("discord.js");

const json = (c) => (c && typeof c.toJSON === "function" ? c.toJSON() : c);

/** Every text of a card in order: text displays and the texts of sections. */
function cardTexts(payload) {
    const box = json((payload && payload.components || [])[0]);
    if (!box || box.type !== ComponentType.Container) return [];
    return (box.components || []).map(json).flatMap((c) => {
        if (c.type === ComponentType.TextDisplay) return [c.content];
        if (c.type === ComponentType.Section) return (c.components || []).map((t) => json(t).content);
        return [];
    });
}

/**
 * The buttons (and other row items: selects, a modal's inputs) of a payload, as JSON, in order: inside the card when it is
 * one, else the items of its top-level rows (an older message, a picker, a modal).
 */
function cardButtons(payload) {
    const top = ((payload && payload.components) || []).map(json);
    const box = top[0];
    const rows = box && box.type === ComponentType.Container ? (box.components || []).map(json) : top;
    return rows.filter((c) => c && c.type === ComponentType.ActionRow).flatMap((r) => (r.components || []).map(json));
}

const isCardPayload = (p) => !!p && (Number(p.flags) & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2;

function asEmbed(payload) {
    if (!payload) return undefined;
    if (!isCardPayload(payload)) {
        const e = json((payload.embeds || [])[0]);
        return e ? { ...e, text: [e.title, e.description].filter(Boolean).join("\n") } : undefined;
    }
    const box = json(payload.components[0]);
    const texts = cardTexts(payload);
    const out = { color: box.accent_color, fields: [], text: texts.join("\n") };
    let rest = [...texts];
    if (rest.length && /^<[@#]/.test(rest[0]) && !/\n/.test(rest[0])) rest = rest.slice(1); // the mentions line
    // the first block is the head unless it is a facts / field line ("**…") or the lone note of a card without a head
    const loneNote = rest.length === 1 && /^-# /.test(rest[0]) && !rest[0].includes("\n");
    const head = rest.length && !/^\*\*/.test(rest[0]) && !loneNote ? rest.shift() : "";
    const lines = head ? head.split("\n") : [];
    if (lines[0] && lines[0].startsWith("-# ")) out.author = { name: lines.shift().slice(3) };
    if (lines[0] && lines[0].startsWith("## ")) out.title = lines.shift().slice(3);
    const desc = lines.join("\n").trim();
    if (desc) out.description = desc;
    if (rest.length && /^-# /.test(rest[rest.length - 1])) out.footer = { text: rest.pop().slice(3) };
    for (const t of rest) {
        const m = /^\*\*(.+?)\*\*\n([\s\S]*)$/.exec(t);
        if (m) { out.fields.push({ name: m[1], value: m[2] }); continue; }
        for (const part of t.split(" · ")) {
            const f = /^\*\*(.+?)\*\* ([\s\S]*)$/.exec(part);
            if (f) out.fields.push({ name: f[1], value: f[2], inline: true });
            else out.fields.push({ name: "", value: part, inline: true });
        }
    }
    return out;
}

module.exports = { asEmbed, cardTexts, cardButtons, isCardPayload };
