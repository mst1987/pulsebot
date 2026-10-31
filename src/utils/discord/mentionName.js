// A raider shown by `<@id>` in a message that pings nobody (`allowedMentions: { parse: [] }`): Discord then leaves the
// message's `mentions` empty, and the client can only show the name from its own member cache — a member it has not
// loaded reads "@unknown-user". So such a message names the person in plain text first and puts the mention behind it:
// "**Name** · <@id>" (nameAndMention). A second mention of the same person in the same card shows just the name
// (nameOrMention), so the card does not read double.
//
// The silent mention edit (tried on the dev server, 31.10.2026): Discord fills `mentions` only from the text of a create
// or of an edit that CHANGES the text — an edit that sends the same text again leaves them as they were, and an edit
// with changed text and `parse: []` empties them. So a card goes out without the mentions first and an edit puts them in
// with `allowedMentions: { users }`; every later edit of the card sends the same users. An edit with
// `allowedMentions.users` resolves the name and does not ping (no push, no badge, no entry under "Mentions") — checked
// on the dev server on 31.10.2026 with a person. postPayload/editPayload use it for `silentMentions: true`.
const { isSnowflake } = require("../ids");

// Discord takes at most 100 ids in allowedMentions.users; mentions past that stay in the text, unresolved, unpinged.
const MAX_USERS = 100;
const SEPARATOR = " · ";
const ZWSP = String.fromCharCode(0x200b);

const str = (v) => (v === null || v === undefined ? "" : String(v));

/** A stored name as plain text: markdown escaped, no mentions, one line. */
function plainName(name) {
    return str(name)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[\\*_~`|>[\]()#]/g, (c) => `\\${c}`)
        .replace(/@/g, `@${ZWSP}`);
}

/**
 * "**Name** · <@id>" — the name always readable, the mention behind it; just the mention without a name, just the name
 * without a (valid) id, "" without both.
 */
function nameAndMention(name, userId) {
    const n = plainName(name);
    const mention = isSnowflake(userId) ? `<@${str(userId)}>` : "";
    if (n && mention) return `**${n}**${SEPARATOR}${mention}`;
    if (n) return `**${n}**`;
    return mention;
}

/** The person once more in the same card: the plain name, the mention only when there is no name. */
function nameOrMention(name, userId) {
    const n = plainName(name);
    if (n) return n;
    return isSnowflake(userId) ? `<@${str(userId)}>` : "";
}

/** The name a person signed up with in `signups` (own events: `character`, Raid-Helper rows: `name`), "" when not there. */
function nameFromSignups(signups, userId) {
    const uid = str(userId);
    if (!uid) return "";
    // the newest row WITH a name: a later row without one (a status change) must not hide the name
    const row = [...(Array.isArray(signups) ? signups : [])].reverse()
        .find((s) => s && str(s.userId) === uid && str(s.character || s.name).trim());
    return row ? str(row.character || row.name).trim() : "";
}

/** Every text of a payload a mention can sit in: `content` and the contents of text displays (Components V2), deep. */
function textsOf(payload) {
    const out = [];
    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== "object") return;
        const json = typeof node.toJSON === "function" ? node.toJSON() : node;
        if (json.type === 10 && typeof json.content === "string") out.push(json.content);
        if (Array.isArray(json.components)) walk(json.components);
    };
    if (payload && typeof payload.content === "string") out.push(payload.content);
    walk(payload && payload.components);
    return out;
}

/** The user ids mentioned (`<@id>`, `<@!id>`) in a payload's texts, each once, at most MAX_USERS. */
function mentionedUserIds(payload) {
    const ids = new Set();
    for (const text of textsOf(payload)) for (const m of text.matchAll(/<@!?(\d{5,25})>/g)) ids.add(m[1]);
    return [...ids].slice(0, MAX_USERS);
}

/**
 * `text` without the mentions of `ids` and the " · " that joined them in. A line that held a mention and is left
 * empty or with just a label ("An:", "**An:**") goes away, so the first post shows no dangling label.
 */
function stripText(text, ids) {
    const pattern = ids.length ? new RegExp(`( · )?<@!?(?:${ids.join("|")})>( · )?`, "g") : null;
    if (!pattern) return text;
    const lines = [];
    for (const line of text.split("\n")) {
        if (!line.match(pattern)) { lines.push(line); continue; }
        const out = line.replace(pattern, (_, before, after) => (before && after ? SEPARATOR : "")).replace(/[ \t]+$/, "");
        const bare = out.replace(/[*_~>\-\s]/g, "");
        if (!bare || /^[^:]{0,40}:$/.test(bare)) continue;
        lines.push(out);
    }
    return lines.join("\n");
}

/** A copy of `payload` whose texts no longer carry the mentions of `ids` (the first step of the silent edit). */
function withoutMentions(payload, ids) {
    const strip = (node) => {
        if (Array.isArray(node)) return node.map(strip);
        if (!node || typeof node !== "object") return node;
        const json = typeof node.toJSON === "function" ? node.toJSON() : node;
        const copy = { ...json };
        if (copy.type === 10 && typeof copy.content === "string") copy.content = stripText(copy.content, ids) || ZWSP;
        if (Array.isArray(copy.components)) copy.components = copy.components.map(strip);
        return copy;
    };
    const out = { ...payload };
    if (typeof out.content === "string") out.content = stripText(out.content, ids);
    if (Array.isArray(out.components)) out.components = out.components.map(strip);
    return out;
}

/**
 * An edit of a card that shows people without pinging them: the users it mentions in `allowedMentions.users` (resolves
 * the names, an edit does not ping), `parse: []` when it mentions nobody.
 */
function mentionEdit(payload) {
    const users = mentionedUserIds(payload);
    return { ...payload, allowedMentions: users.length ? { parse: [], users } : { parse: [] } };
}

/**
 * How to post a card that shows people without pinging them: `first` goes out without the mentions (`parse: []`),
 * `then` is the edit that puts them in — null when nobody is mentioned. `then` leaves out `files` and
 * `attachments`: the post already carries them, sending them again would upload them twice (or drop them).
 * @returns {{ first: object, then: object|null }}
 */
function silentMentionSteps(payload) {
    const users = mentionedUserIds(payload);
    if (!users.length) return { first: { ...payload, allowedMentions: { parse: [] } }, then: null };
    const { files, attachments, ...rest } = payload; // eslint-disable-line no-unused-vars
    return {
        first: { ...withoutMentions(payload, users), allowedMentions: { parse: [] } },
        then: { ...rest, allowedMentions: { parse: [], users } },
    };
}

module.exports = {
    MAX_USERS, nameAndMention, nameOrMention, nameFromSignups, plainName, mentionedUserIds, withoutMentions, mentionEdit, silentMentionSteps,
};
