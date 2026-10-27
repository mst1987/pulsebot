// How a ping or a sign-up call reaches the raiders (#264, server network #894):
// always on the raid's own server, and a DM for whoever is not there.
//
// Two Discord rules shape this module. A mention only notifies someone who is
// on the server the message is posted on, and a role mention only works on the
// server the role belongs to. So a ping
//
//   1. reads the raid server's member list first (`fetchGuildMembersCached`) —
//      when that fails nothing is posted, so a failure never leaves a
//      half-delivered ping behind;
//   2. mentions the raiders who are on the raid server in the raid channel;
//   3. sends everyone else a DM (`dmCard`) with a link to the signup message
//      and to the raid's web page.
//
// A sign-up call mentions roles, and only on the raid server: whoever holds the
// role is on that server, so there is nobody to DM.
//
// The language: a ping in a channel is public — the event's language
// (botLanguage.eventLang, its category's); a DM is the recipient's own
// (botLanguage.langOf). So a text may come as a function `(lang) => string`,
// drawn once per language; a plain string (the orga's own words) goes out as it is.
//
// A DM is a card (utils/discord/card.js, kind "warn", `dmCard`): the raid as
// its heading, the text, the start short (`<t:…:d> <t:…:t>`) and buttons to the
// signup message and the web page. The channel pings themselves are
// discord.postMissingPing's.
const { ButtonBuilder, ButtonStyle } = require("discord.js");
const discord = require("./discord");
const { card } = require("../../utils/discord/card");
const linkCheck = require("./linkCheck");
const { getConfig } = require("../../stores/settingsStore");
const { tr } = require("../../utils/i18n/botText");
const { langOf, eventLang } = require("./botLanguage");

/** The ping's default text in a channel, when the orga wrote none. */
function missingPingText(lang = "de") {
    return tr(lang, "Please sign up or sign off for the raid, so the roster is complete.");
}

/** A text given as a string or as `(lang) => string`, in the language; "" for none. */
function textIn(text, lang) {
    return String((typeof text === "function" ? text(lang) : text) || "").trim();
}

/** The raid's server: the caller's guild, else the event's own. */
function raidGuildId(event, guildId) {
    return String(guildId || (event && event.guildId) || "").trim();
}

/** The ids of the raid server's members; throws with a German message when they cannot be read. */
async function raidMemberIds(guildId) {
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild) throw new Error("Der Bot ist nicht auf dem Server des Raids.");
    try {
        const members = await discord.fetchGuildMembersCached(guildId, guild);
        return new Set(members.map((m) => String(m.id)));
    } catch (e) {
        throw new Error(`Mitglieder des Raid-Servers nicht lesbar: ${(e && e.message) || "GuildMembers-Intent aktiv?"}`, { cause: e });
    }
}

/** A short start: "<t:…:d> <t:…:t> · <t:…:R>" — each reader's own date format and time zone; "" without one. */
function shortStart(start) {
    const sec = Number(start) || 0;
    return sec ? `<t:${sec}:d> <t:${sec}:t> · <t:${sec}:R>` : "";
}

/** A link button, or null without a url. */
function linkButton(label, url) {
    return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url) : null;
}

/**
 * The DM as a card (kind "warn", nothing in it pings): the raid as its heading —
 * a DM has no channel to say which one —, the ping, the start and buttons to
 * the signup message and to the raid's web page, labelled in the reader's language.
 */
function dmCard(text, event, guildId, lang = "de") {
    const when = shortStart(event && event.startTime);
    const buttons = event ? [
        // only links that work (#537): the signup message, else the channel
        linkButton(tr(lang, "To the signup"), linkCheck.eventLink(event, guildId)),
        linkButton(tr(lang, "Open on the web"), linkCheck.webTarget("signup", event.id)),
    ].filter(Boolean) : [];
    return card({
        kind: "warn",
        title: event && event.title,
        text: String(text || "").trim(),
        facts: when ? [["", when]] : [],
        buttons,
    });
}

/**
 * DM each user in turn (sequential: Discord rate-limits DMs hard). Never throws.
 * `payload` is one payload for all, or `(lang) => payload`: then each user gets
 * it in their own language (botLanguage.langOf), drawn once per language.
 */
async function sendDms(userIds, payload, { config } = {}) {
    const sent = [];
    const failed = [];
    const drawn = new Map();
    const payloadFor = (id) => {
        if (typeof payload !== "function") return payload;
        const lang = langOf(id, { config });
        if (!drawn.has(lang)) drawn.set(lang, payload(lang));
        return drawn.get(lang);
    };
    for (const id of userIds) {
        const result = await discord.sendDirectMessage(id, payloadFor(id));
        if (result && result.ok) sent.push(id);
        else failed.push(id);
    }
    return { sent, failed };
}

/**
 * Ping the given users (the missing raiders, a reminder's recipients, a move
 * note): mentioned in the raid channel when they are on the raid server, else a DM.
 *
 * @param {object} p
 * @param {object} p.event    { id, title, startTime, channelId, guildId?, message? }
 * @param {string[]} p.userIds
 * @param {string|function} p.text the message, or `(lang) => message`; empty = missingPingText()
 * @param {string} p.guildId  the raid's server (default: event.guildId)
 * @returns {Promise<{ event: object|null, mentioned: number, dm: { sent: string[], failed: string[] } | null }>}
 */
async function deliverUserPing({ event, userIds, text = "", guildId = "", config = getConfig() }) {
    if (!event || !event.channelId) throw new Error("Das Event hat keinen Kanal.");
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    const raidGuild = raidGuildId(event, guildId);
    // Read the members before posting anything, so a failure there never
    // leaves a half-delivered ping behind.
    const onServer = await raidMemberIds(raidGuild);
    const present = users.filter((id) => onServer.has(id));
    const absent = users.filter((id) => !onServer.has(id));

    const result = { event: null, mentioned: 0, dm: null };
    // in the channel: the event's language (its category's)
    const lang = eventLang(event, config);
    if (present.length) {
        result.event = await discord.postMissingPing(event.channelId, present, textIn(text, lang) || missingPingText(lang));
        result.mentioned = present.length;
    }
    if (absent.length) {
        // a DM: each raider's own language
        const dm = (dmLang) => dmCard(textIn(text, dmLang) || tr(dmLang, "Please sign up or sign off for the raid."), event, raidGuild, dmLang);
        result.dm = await sendDms(absent, dm, { config });
    }
    return result;
}

/**
 * Post a sign-up call (a notify template) with role pings in the raid channel.
 * The roles are the raid server's, and whoever holds one is on that server —
 * so the role mention reaches all of them and no DM is needed.
 *
 * @param {object} p
 * @param {string} p.channelId   the raid channel the call goes to
 * @param {object} p.template    { title, body }
 * @param {string[]} p.roleIds   roles of the raid server
 * @returns {Promise<{ event: object, mentioned: number, dm: null }>}
 */
async function deliverAnnouncement({ channelId, template, roleIds }) {
    if (!channelId || !template) throw new Error("Vorlage oder Channel fehlt.");
    const roles = [...new Set((roleIds || []).map(String).filter(Boolean))];
    const posted = await discord.postAnnouncement(channelId, template, roles);
    return { event: posted, mentioned: 0, dm: null };
}

/** " · 3 per DM" / " · 2 DMs fehlgeschlagen" — the tail of the success message. */
function dmSummary(dm) {
    if (!dm) return "";
    const parts = [];
    if (dm.sent.length) parts.push(`${dm.sent.length} per DM`);
    if (dm.failed.length) parts.push(`${dm.failed.length} ${dm.failed.length === 1 ? "DM" : "DMs"} fehlgeschlagen`);
    return parts.length ? ` · ${parts.join(" · ")}` : "";
}

module.exports = {
    deliverUserPing, deliverAnnouncement, dmSummary, dmCard, shortStart, sendDms, missingPingText,
};
