// The role messages (services/discord/roleMessages.js): a message the bot posts with
// a title, a text, a big picture and one button plus one reaction per role; a click
// on the button or a reaction gives or takes the role (self-service roles,
// services/discord/selfRole.js).
//
// `data/settings/role-messages.json` =
//   {
//     messages: [{
//       id,                          our id (random, also in the buttons' customId)
//       guildId,                     the server the message, its roles and emojis belong to (#895)
//       guildSide: "event"|"talk",   only on entries saved before #895 (no guildId): read as
//                                    the talk server resp. the first server
//                                    (guildRoles.roleMessageGuild), dropped on the next save
//       channelId, messageId,        where it is posted ("" messageId = not posted)
//       title, body, imageUrl,       what it shows (imageUrl https or "")
//       color,                       the bar colour (0..0xFFFFFF) or null = the card's default
//       roles: [{ roleId, emoji, label }],  emoji: a Unicode emoji or "<:name:id>" / "<a:name:id>"
//       createdBy, createdAt, updatedAt
//     }]
//   }
//
// The store only keeps the shape; the limits and the role checks are the service's.
const crypto = require("crypto");
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const SNOWFLAKE = /^\d{5,25}$/;
const snowflake = (v) => (SNOWFLAKE.test(str(v)) ? str(v) : "");
const SIDES = ["event", "talk"];

/** A colour 0..0xFFFFFF, else null. */
function colorOf(v) {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "string" && v.startsWith("#") ? parseInt(v.slice(1), 16) : Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 0xFFFFFF ? n : null;
}

function normalizeRole(raw) {
    if (!raw || typeof raw !== "object") return null;
    const role = { roleId: snowflake(raw.roleId), emoji: str(raw.emoji), label: str(raw.label) };
    return role.roleId ? role : null;
}

function normalizeMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = str(raw.id);
    if (!id) return null;
    const imageUrl = str(raw.imageUrl);
    const guildId = snowflake(raw.guildId);
    return {
        id,
        guildId,
        // Legacy (before #895): kept only while there is no guildId yet.
        ...(guildId ? {} : { guildSide: SIDES.includes(str(raw.guildSide)) ? str(raw.guildSide) : "event" }),
        channelId: snowflake(raw.channelId),
        messageId: snowflake(raw.messageId),
        title: str(raw.title),
        body: String(raw.body === undefined || raw.body === null ? "" : raw.body).trim(),
        imageUrl: /^https:\/\/\S+$/i.test(imageUrl) ? imageUrl : "",
        color: colorOf(raw.color),
        roles: (Array.isArray(raw.roles) ? raw.roles : []).map(normalizeRole).filter(Boolean),
        createdBy: str(raw.createdBy),
        createdAt: num(raw.createdAt),
        updatedAt: num(raw.updatedAt),
    };
}

// Cached: every reaction on both servers asks `findByMessageId` (the server has one
// vCPU), so the file is read once and again only after it changed.
const store = createJsonStore({
    file: settingsPath("role-messages.json"),
    cache: true,
    defaults: () => ({ messages: [] }),
    normalize: (data) => {
        const list = data && Array.isArray(data.messages) ? data.messages : [];
        const seen = new Set();
        const messages = [];
        for (const m of list.map(normalizeMessage)) {
            if (!m || seen.has(m.id)) continue;
            seen.add(m.id);
            messages.push(m);
        }
        return { messages };
    },
});

// The Discord message ids of all role messages: almost every reaction is on some other
// message, and this set answers that without even a stat of the file. Built on the first
// lookup from the cache, dropped on every save, remove and useFile (the next lookup builds
// it again). A file swapped by hand while the bot runs is seen after the next save or start.
let knownIds = null;

function messageIds() {
    if (!knownIds) knownIds = new Set(store.peek().messages.map((m) => m.messageId).filter(Boolean));
    return knownIds;
}

/** Tests point the store at a file of their own; null = the default again. */
function useFile(file) {
    knownIds = null;
    store.useFile(file);
}

const copy = (m) => (m ? { ...m, roles: m.roles.map((r) => ({ ...r })) } : null);

/** Every role message, oldest first. */
function listMessages() {
    return store.peek().messages.map(copy);
}

/** One role message by our id, or null. */
function getMessage(id) {
    return copy(store.peek().messages.find((m) => m.id === str(id)));
}

/** The role message posted as this Discord message, or null — from memory, never the disk per reaction. */
function findByMessageId(messageId) {
    const mid = str(messageId);
    if (!mid || !messageIds().has(mid)) return null;
    return copy(store.peek().messages.find((m) => m.messageId === mid));
}

/** A new id: short, URL- and customId-safe. */
const newId = () => crypto.randomBytes(6).toString("hex");

/**
 * Insert (no or unknown id → a new id for a new entry) or replace one role message;
 * returns the stored entry.
 */
function saveMessage(entry = {}, { now = Date.now() } = {}) {
    const d = store.read();
    const id = str(entry.id) || newId();
    const at = d.messages.findIndex((m) => m.id === id);
    const before = at >= 0 ? d.messages[at] : null;
    const saved = normalizeMessage({
        ...entry,
        id,
        createdBy: str(entry.createdBy) || (before ? before.createdBy : ""),
        createdAt: (before && before.createdAt) || num(entry.createdAt) || now,
        updatedAt: now,
    });
    if (at >= 0) d.messages[at] = saved;
    else d.messages.push(saved);
    knownIds = null;
    store.write(d);
    return copy(saved);
}

/** Remove one role message; returns it, or null when there was none. */
function removeMessage(id) {
    const d = store.read();
    const at = d.messages.findIndex((m) => m.id === str(id));
    if (at < 0) return null;
    const [old] = d.messages.splice(at, 1);
    knownIds = null;
    store.write(d);
    return copy(old);
}

module.exports = { useFile, listMessages, getMessage, findByMessageId, saveMessage, removeMessage, colorOf, SIDES };
