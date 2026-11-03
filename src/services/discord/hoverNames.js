// WoW Forever only: a character is "Vorname Nachname", too long for the lists of a Discord message. There the messages
// name a raider by the Discord name and keep the full character behind it, as the hover text of a masked link:
//     **[Marc](<https://…/e/abc> "Aldric Sturmwind")**
// Discord shows that title on hover, in bold and in embed fields as well (tried on the dev server, Nov 2026). A mention
// is no option: it reads "@unknown-user" in an embed and has no hover.
//
// Display only. Signups and setups keep the character; invites (`/w <name> inv`), DMs and every comparison use it.
//
// Discord counts the link against its limits (1024 per field, 6000 per embed), and it is about 80 characters per name.
// So the links are the first thing to go (LINK_CAPS, fitLinks): every raider stays listed, at worst with the plain
// Discord name, before a list ever shortens to "+N more".
const discord = require("./discord");
const linkCheck = require("./linkCheck");
const { eventHasLastNames } = require("../versions/mainVersion");
const { plainName } = require("../../utils/discord/mentionName");
const logger = require("../../logger").child("hoverNames");

// A redraw waits this long for names Discord has not delivered yet; the fetch carries on and fills the cache for the
// next redraw (discord.resolveUserNames). Mostly a background job; an interaction that redraws (Confirm click, ping
// modal) defers first, as this wait alone can eat most of Discord's three seconds. When every name is known from an
// earlier redraw there is no wait at all.
const NAME_WAIT_MS = 1500;

/** Links per block, tried in order until a message fits: all, then fewer, then none. */
const LINK_CAPS = [Infinity, 6, 5, 4, 3, 2, 1, 0];

// Control and format characters (zero-width, direction overrides). Only the joiner of emoji sequences may stay.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const EMOJI_JOINER = String.fromCharCode(0x200d);
// What Discord draws as nothing, on top of those: the fillers of an "empty" name (Hangul filler, Braille blank,
// variation selectors). Only for the question whether anything is visible; inside a name they stay.
const BLANK = new RegExp(`[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\s${String.fromCharCode(0x2800)}]`, "gu");
// Discord refuses or warns about a masked link whose text looks like an address.
const LOOKS_LIKE_URL = /:\/\/|www\.|[\p{L}\p{N}-]\.[\p{L}]{2,}/iu;
// Discord's own syntax in a name: custom emoji, user, role and channel mentions, timestamps, slash commands. Removed
// whole, so that no bare id stays behind.
const DISCORD_SYNTAX = /<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|<t:\d+(?::\w)?>|<\/[^>]*:\d+>/g;

/** One line, nothing invisible, none of Discord's own syntax. */
function cleanName(name) {
    return String(name === null || name === undefined ? "" : name)
        .replace(/\s+/g, " ")
        .replace(INVISIBLE, (c) => (c === EMOJI_JOINER ? c : ""))
        .replace(DISCORD_SYNTAX, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Worth showing: something visible, no address. */
const usable = (text) => !!text.replace(BLANK, "") && !LOOKS_LIKE_URL.test(text);

/**
 * A freely chosen Discord name as plain text: markdown escaped, nothing that mentions. Square brackets become round
 * ones. "" for a name with nothing visible in it or one that looks like an address: the character is shown instead.
 * Not for the text of a masked link: Discord shows a backslash there literally (discordLinkText).
 */
function discordNameText(name) {
    const text = cleanName(name);
    if (!usable(text)) return "";
    return plainName(text.replace(/\[/g, "(").replace(/\]/g, ")")).replace(/</g, "\\<");
}

/**
 * A freely chosen Discord name as the text of a masked link. Discord shows a backslash there literally, so nothing is
 * escaped: what would format the text or break the link goes (tried on Discord, Nov 2026), the rest reads as it is -
 * "(Tank)", "Lena | Heal", "xX_Shadow_Xx". A square bracket becomes a round one, it could end the text. An underscore
 * only formats at a word's edge or doubled, a pipe only doubled. "" when nothing is left: the character is shown.
 */
function discordLinkText(name) {
    const text = cleanName(name)
        .replace(/\[/g, "(").replace(/\]/g, ")")
        .replace(/[*~`<>@\\]/g, "")
        .replace(/_{2,}/g, "_")
        .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "")
        .replace(/\|{2,}/g, "|")
        .replace(/\s+/g, " ")
        .trim();
    return usable(text) ? text : "";
}

/** The character as hover text: nothing that could end the quoted title. */
function hoverTitle(character) {
    return String(character || "").replace(/[^\p{L}\p{M}\p{N} '-]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * How one message names its raiders, null when it stays with the characters (no names, no address to link to).
 * `linked` and `plain` take a `{ userId, character }`:
 * - `linked`: "[Marc](<url> "Aldric Sturmwind")"
 * - `plain`: the Discord name as text
 * Both fall back to `fallback` (the message's own way: the character, else the mention), and for the same names: one
 * with nothing left as link text (only "***") is not shown in plain text either.
 * A row without a character is the `fallback`'s as well: there is nothing to put behind a link.
 */
function hoverNames({ discordNames, url, fallback }) {
    if (!discordNames || !url) return null;
    const rawOf = (p) => (p.character ? discordNames[String(p.userId)] : "");
    const plain = (p) => {
        const raw = rawOf(p);
        return (discordLinkText(raw) && discordNameText(raw)) || fallback(p);
    };
    const linked = (p) => {
        const name = discordLinkText(rawOf(p));
        const title = hoverTitle(p.character);
        return name && title ? `[${name}](<${url}> "${title}")` : fallback(p);
    };
    return { plain, linked };
}

/**
 * The items rendered so that they fit `max` characters joined by `sep`: an item keeps its link while there is room and
 * the block has not used up `cap`, in order; the others are plain. `render(item, linked)` gives the text. Items without
 * a link (same text either way) cost nothing. When even the plain texts do not fit, nobody gets a link - the caller's
 * "+N more" or clip then cuts plain text, never a link in two.
 */
function fitLinks(items, render, { max, sep = "\n", cap = Infinity }) {
    const plain = items.map((item) => render(item, false));
    let room = max - plain.reduce((n, text) => n + text.length, 0) - sep.length * Math.max(items.length - 1, 0);
    let links = 0;
    return items.map((item, i) => {
        const linked = render(item, true);
        const extra = linked.length - plain[i].length;
        if (!extra || links >= cap || extra > room) return plain[i];
        links += 1;
        room -= extra;
        return linked;
    });
}

// The last name known per `guild:user`. A name that does not arrive in time (or a raider who just left) keeps the
// last one, so the payload of a Forever message - and the hash its redraw compares - does not flip between link and
// plain text. Empty after a restart: a name not delivered in time then shows the character until it is, one edit.
const lastKnown = new Map();

/**
 * The Discord names of `userIds` for a message of `event`: userId -> name. null for an event without last names or when
 * there is no web address to link to, which asks Discord for nothing. Waits at most NAME_WAIT_MS, never throws.
 */
async function resolveHoverNames(event, userIds) {
    if (!event || !event.guildId || !linkCheck.webBase() || !eventHasLastNames(event)) return null;
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    // All known: no wait. The fetch still runs in the background and brings a changed name for the next redraw.
    const waitMs = ids.every((id) => lastKnown.has(`${event.guildId}:${id}`)) ? 0 : NAME_WAIT_MS;
    let found = {};
    try {
        found = (await discord.resolveUserNames(event.guildId, ids, { waitMs })) || {};
    } catch (e) {
        logger.warn(`names of ${event.id} not resolved: ${(e && e.message) || e}`);
    }
    const out = {};
    for (const id of ids) {
        const key = `${event.guildId}:${id}`;
        const name = found[id] || lastKnown.get(key);
        if (!name) continue;
        lastKnown.set(key, name);
        out[id] = name;
    }
    return out;
}

const _resetForTests = () => lastKnown.clear();

module.exports = { LINK_CAPS, NAME_WAIT_MS, eventHasLastNames, discordNameText, discordLinkText, hoverTitle, hoverNames, fitLinks, resolveHoverNames, _resetForTests };
