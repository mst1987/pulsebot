// The note under "Gespeichert" for a raider who signed up from a partner
// server's raid list without being on the raid's server (#904). Anyone may sign
// up for an open PuG from a linked server; without being a member of the raid's
// server they never see its pings and posts, so the answer says so — naming the
// raid's server, with a link button "<server> beitreten" when there is an
// invite for the link.
//
// One member fetch on the raid's server, AFTER the answer went out (the caller
// acknowledges first, then edits): a single-user fetch needs no privileged
// intent. Three answers: member, not a member (Discord says "unknown member"),
// unknown (bot offline, other error, too slow) — only "not a member" shows the
// note, a Discord hiccup never nags a raider.
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const guildRoles = require("../discord/guildRoles");
const { tr } = require("../../utils/i18n/botText");
const logger = require("../../logger").child("partner-join-hint");

// The answer is already out, so waiting costs nothing but the edit coming later.
const MEMBER_WAIT_MS = 5000;
// Discord's "Unknown Member" / "Unknown User"
const NOT_MEMBER_CODES = new Set([10007, 10013]);

/** The server an own event's raid runs on — the same one checkRaiderRole reads. */
function raidGuildId(event, config = settingsStore.getConfig()) {
    return String((event && event.guildId) || (config && config.guildId) || "");
}

/**
 * Is the member on that server?
 * @returns {Promise<true|false|null>} null = could not be read
 */
async function isServerMember(guildId, userId, { waitMs = MEMBER_WAIT_MS } = {}) {
    const guild = typeof discord.getGuild === "function" ? discord.getGuild(String(guildId || "")) : null;
    if (!guild || !userId) return null;
    const uid = String(userId);
    if (guild.members.cache.has(uid)) return true;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
    const fetched = (async () => {
        try {
            return (await guild.members.fetch(uid)) ? true : null;
        } catch (e) {
            const code = e && (e.code || (e.rawError && e.rawError.code));
            if (NOT_MEMBER_CODES.has(code)) return false;
            logger.warn(`member check on ${guild.id} failed: ${(e && e.message) || e}`);
            return null;
        }
    })();
    try {
        return await Promise.race([fetched, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * A member's roles on the raid's server for the raider-role check of a signup.
 * Since anyone may sign up from a partner list (#904), a non-member would
 * slip past the role rule if "unknown member" read as "unknown"; so one fetch
 * that answers [] (no roles) when Discord says surely not on the server. Any
 * other failure (bot offline, Discord error) stays null, the lenient "a hiccup
 * never refuses a raider". One fetch only — this runs before some answers.
 * @returns {Promise<string[]|null>}
 */
async function signupRoleIds(guildId, userId) {
    const ids = await discord.memberRoleIds(guildId, userId, { absentAs: [] });
    return ids === undefined ? null : ids;
}

// A button label holds 80 characters; "<name> beitreten" must fit.
const NAME_MAX = 60;

/**
 * The raid server's name in the note: its label in discordServers.servers,
 * else the Discord server's own name, else "PuG".
 */
function serverNameOf(guildId, config = settingsStore.getConfig()) {
    const label = guildRoles.serverLabel(guildId, config);
    const canAsk = !label && typeof discord.getGuild === "function";
    const guild = canAsk ? discord.getGuild(String(guildId || "")) : null;
    const name = String(label || (guild && guild.name) || "PuG").trim() || "PuG";
    return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

/**
 * The note itself: the line, and a link button when an invite exists — both
 * name the raid's server.
 * @returns {{ line: string, button: object|null }}
 */
function buildJoinHint({ lang = "de", inviteUrl = "", serverName = "PuG" } = {}) {
    const server = String(serverName || "PuG");
    const line = `ℹ️ ${tr(lang, "Join the server **{server}**, otherwise you will not get pings and info.", { server })}`;
    const url = /^https:\/\//.test(String(inviteUrl || "")) ? String(inviteUrl) : "";
    return { line, button: url ? { type: 2, style: 5, label: tr(lang, "Join {server}", { server }), url } : null };
}

/**
 * The invite of one link ("from:to"). #905 brings the invites per link
 * (services/discord/pugInvites.js `inviteUrlForLink(linkKey)`, sync, URL or "");
 * until then there is none and the note comes without a button.
 */
function inviteUrlForLink(linkKey) {
    void linkKey;
    return "";
}

/**
 * The note for one saved signup, or null. Only when the click came from another
 * server than the raid's (a partner list: link "<raid server>:<this server>")
 * and that member is surely not on the raid's server.
 * @returns {Promise<{ line: string, button: object|null, linkKey: string }|null>}
 */
async function joinHintFor(interaction, event, { lang = "de", inviteUrlOf = inviteUrlForLink, config, waitMs } = {}) {
    const here = String((interaction && interaction.guildId) || "");
    const cfg = config || settingsStore.getConfig();
    const raidGuild = raidGuildId(event, cfg);
    if (!here || !raidGuild || here === raidGuild) return null;
    const userId = interaction.user && interaction.user.id;
    if ((await isServerMember(raidGuild, userId, { waitMs })) !== false) return null;
    const linkKey = `${raidGuild}:${here}`;
    return { ...buildJoinHint({ lang, inviteUrl: inviteUrlOf(linkKey), serverName: serverNameOf(raidGuild, cfg) }), linkKey };
}

/**
 * The note after "Mehrere Raids wählen …": the raids saved may come from more
 * than one server — one member check per server, one line, a button per invite.
 * @param {object[]} events the own events that were saved (not signed off)
 * @returns {Promise<{ line: string, buttons: object[] }|null>}
 */
async function joinHintForEvents(interaction, events, { lang = "de", inviteUrlOf = inviteUrlForLink, config, waitMs } = {}) {
    const cfg = config || settingsStore.getConfig();
    const seen = new Map();
    for (const event of events || []) {
        const guildId = raidGuildId(event, cfg);
        if (guildId && !seen.has(guildId)) seen.set(guildId, event);
    }
    const hints = await Promise.all([...seen.values()].map((event) => joinHintFor(interaction, event, { lang, inviteUrlOf, config: cfg, waitMs })));
    const found = hints.filter(Boolean);
    if (!found.length) return null;
    const urls = new Set();
    const buttons = found.map((h) => h.button).filter((b) => b && !urls.has(b.url) && urls.add(b.url));
    return { line: found.map((h) => h.line).join("\n"), buttons };
}

module.exports = {
    raidGuildId, isServerMember, signupRoleIds, serverNameOf, buildJoinHint, inviteUrlForLink, joinHintFor, joinHintForEvents,
    MEMBER_WAIT_MS,
};
