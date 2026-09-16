// Shared pieces of the bot's lookup commands (issue #265): short answers only the
// asking user sees, one "Im Web öffnen" button to the page that has the full
// view, and autocomplete choices within Discord's limits.
//
// Kept framework-free on purpose: embeds and buttons are plain API objects, so
// the tests can assert on them without discord.js builders.

const { publicBaseUrl, embedAccentColor } = require("../config/variables");

/** Discord's embed limits — a reply above any of them is refused as a whole. */
const EMBED_LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 };
/** Autocomplete: at most 25 choices, name and value at most 100 characters each. */
const MAX_CHOICES = 25;
const CHOICE_TEXT_MAX = 100;
/** Link buttons Discord accepts per row. */
const MAX_BUTTONS = 5;

/** A text cut to `max` characters, with an ellipsis when something was dropped. */
function clip(value, max) {
    const text = String(value === null || value === undefined ? "" : value);
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** An absolute link into the web menu, e.g. webUrl("/raids") → "https://…/raids". */
function webUrl(pathname = "/") {
    const base = String(publicBaseUrl || "").replace(/\/+$/, "");
    const path = String(pathname || "/");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * An embed cut down to Discord's limits: every text to its own limit, at most 25
 * fields, and fields dropped from the end until the whole embed fits 6000
 * characters. Empty fields are removed — Discord refuses them.
 */
function clampEmbed(embed = {}) {
    const out = { color: embed.color === undefined ? embedAccentColor : embed.color };
    if (embed.title) out.title = clip(embed.title, EMBED_LIMITS.title);
    if (embed.url) out.url = embed.url;
    if (embed.description) out.description = clip(embed.description, EMBED_LIMITS.description);
    if (embed.footer) out.footer = { text: clip(embed.footer.text || embed.footer, EMBED_LIMITS.footer) };
    const fields = (embed.fields || [])
        .filter((f) => f && String(f.name || "").trim() && String(f.value || "").trim())
        .slice(0, EMBED_LIMITS.fields)
        .map((f) => ({ name: clip(f.name, EMBED_LIMITS.fieldName), value: clip(f.value, EMBED_LIMITS.fieldValue), inline: !!f.inline }));
    const size = () => (out.title || "").length + (out.description || "").length + (out.footer ? out.footer.text.length : 0)
        + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    while (fields.length && size() > EMBED_LIMITS.total) fields.pop();
    if (size() > EMBED_LIMITS.total && out.description) {
        out.description = clip(out.description, Math.max(1, out.description.length - (size() - EMBED_LIMITS.total)));
    }
    if (fields.length) out.fields = fields;
    return out;
}

/** The size Discord counts for an embed (title, description, footer, fields). */
function embedSize(embed = {}) {
    return (embed.title || "").length + (embed.description || "").length
        + (embed.footer ? String(embed.footer.text || "").length : 0)
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

/** One row of link buttons: `[{ label, url }]`, the first one usually "Im Web öffnen". */
function linkRow(links = []) {
    const buttons = links
        .filter((l) => l && /^https?:\/\//.test(String(l.url || "")))
        .slice(0, MAX_BUTTONS)
        .map((l) => ({ type: 2, style: 5, label: clip(l.label || "Im Web öffnen", 80), url: l.url }));
    return buttons.length ? [{ type: 1, components: buttons }] : [];
}

/**
 * Answer a lookup: one compact embed, only for the asking user, with link
 * buttons. Works before and after deferReply.
 */
async function lookupReply(interaction, embed, links = []) {
    const payload = { embeds: [clampEmbed(embed)], components: linkRow(links), ephemeral: true };
    if (interaction.deferred || interaction.replied) {
        const { ephemeral, ...rest } = payload; // eslint-disable-line no-unused-vars
        return interaction.editReply(rest);
    }
    return interaction.reply(payload);
}

/** Defer a lookup that may take longer than Discord's three seconds (Raid-Helper, many files). */
async function deferLookup(interaction) {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferReply({ ephemeral: true });
    interaction.deferred = true;
}

/** The text currently typed into the focused autocomplete option, lower case. */
function focusedText(interaction) {
    const opts = interaction.options || {};
    if (typeof opts.getFocused !== "function") return "";
    const focused = opts.getFocused(true);
    const value = focused && typeof focused === "object" ? focused.value : focused;
    return String(value || "").trim().toLowerCase();
}

/** Which option is focused ("item", "name", …), "" when unknown. */
function focusedName(interaction) {
    const opts = interaction.options || {};
    if (typeof opts.getFocused !== "function") return "";
    const focused = opts.getFocused(true);
    return focused && typeof focused === "object" ? String(focused.name || "") : "";
}

/**
 * Filter `entries` ({ name, value }) by what was typed — names starting with it
 * first, then names containing it — and answer at most 25 choices.
 */
function rankChoices(entries, typed) {
    const q = String(typed || "").trim().toLowerCase();
    const seen = new Set();
    const starts = [];
    const contains = [];
    for (const e of entries || []) {
        if (!e || !String(e.name || "").trim()) continue;
        const value = clip(String(e.value === undefined ? e.name : e.value), CHOICE_TEXT_MAX);
        if (!value || seen.has(value)) continue;
        const name = String(e.name).toLowerCase();
        if (!q || name.startsWith(q)) starts.push(e);
        else if (name.includes(q)) contains.push(e);
        else continue;
        seen.add(value);
    }
    return [...starts, ...contains].slice(0, MAX_CHOICES).map((e) => ({
        name: clip(e.name, CHOICE_TEXT_MAX),
        value: clip(String(e.value === undefined ? e.name : e.value), CHOICE_TEXT_MAX),
    }));
}

/** Respond to an autocomplete with ranked, capped choices. */
async function respondChoices(interaction, entries) {
    return interaction.respond(rankChoices(entries, focusedText(interaction)));
}

/** A Discord timestamp tag: `<t:1700000000:d>`; "" for no time. Accepts seconds or milliseconds. */
function discordTime(time, style = "d") {
    const n = Number(time) || 0;
    if (!n) return "";
    const seconds = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    return `<t:${seconds}:${style}>`;
}

/** "3 Items" / "1 Item". */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

module.exports = {
    EMBED_LIMITS, MAX_CHOICES, CHOICE_TEXT_MAX,
    clip, webUrl, clampEmbed, embedSize, linkRow, lookupReply, deferLookup,
    focusedText, focusedName, rankChoices, respondChoices, discordTime, plural,
};
