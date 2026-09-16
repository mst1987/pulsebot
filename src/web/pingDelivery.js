// Where a ping or a sign-up call goes (#264): the event channel, the talk
// server's ping channel, or both.
//
// Two Discord rules shape this module. A mention only notifies someone who is
// on the server the message is posted on, and a role mention only works on the
// server the role belongs to. So on the talk server
//
//   - raiders are mentioned one by one, and only those who are there;
//   - an event-server role becomes its talk-server counterpart from the role
//     sync mapping (`roleSync`), and a role without one becomes the mentions of
//     its members who are on the talk server;
//   - whoever is not on the talk server gets a DM instead — but only when the
//     event channel is not part of the target: with "both" they were already
//     reached there, and a DM on top would be the same ping twice.
const discord = require("./discord");
const guildRoles = require("./guildRoles");
const { getConfig } = require("./settingsStore");

const PING_TARGETS = ["event", "talk", "both"];

const TARGET_LABELS = {
    event: "Event-Kanal",
    talk: "Kommunikations-Discord",
    both: "Event-Kanal und Kommunikations-Discord",
};

/** A known target, else "event" — the old behaviour is the safe default. */
function normalizePingTarget(raw) {
    return PING_TARGETS.includes(raw) ? raw : "event";
}

/** The talk server's ping channel, or null when there is no talk server or no channel picked. */
function talkPingChannel(config = getConfig()) {
    const guildId = guildRoles.talkGuildId(config);
    const channelId = String(((config && config.discordServers) || {}).talkPingChannelId || "").trim();
    return guildId && channelId ? { guildId, channelId } : null;
}

/** What the raid-detail modals need to offer the "Wohin" segment. */
function pingTargetInfo(config = getConfig()) {
    const talk = talkPingChannel(config);
    let channelName = "";
    let guildName = "";
    if (talk) {
        const guild = discord.getGuild(talk.guildId);
        guildName = guild ? guild.name : "";
        const channel = guild && guild.channels && guild.channels.cache ? guild.channels.cache.get(talk.channelId) : null;
        channelName = channel ? channel.name : "";
    }
    return { talk: !!talk, talkGuildName: guildName, talkChannelName: channelName };
}

const includesEvent = (target) => target === "event" || target === "both";
const includesTalk = (target) => target === "talk" || target === "both";

/** The ids of the talk server's members; throws with a German message when they cannot be read. */
async function talkMemberIds(guildId) {
    const guild = discord.getGuild(guildId);
    if (!guild) throw new Error("Der Bot ist nicht auf dem Kommunikations-Discord.");
    try {
        const members = await discord.fetchGuildMembersCached(guildId, guild);
        return new Set(members.map((m) => String(m.id)));
    } catch (e) {
        throw new Error(`Mitglieder des Kommunikations-Discords nicht lesbar: ${(e && e.message) || "GuildMembers-Intent aktiv?"}`);
    }
}

/** A jump link to the event channel, or "" when a part is unknown. */
function eventChannelUrl(event, guildId) {
    return guildId && event && event.channelId ? `https://discord.com/channels/${guildId}/${event.channelId}` : "";
}

/** The DM text: the ping itself plus which raid it is about, since a DM has no channel to say so. */
function dmContent(text, event, guildId) {
    const start = Number(event && event.startTime) || 0;
    const head = event && event.title ? `**${event.title}**${start ? ` · <t:${start}:F>` : ""}` : "";
    return [String(text || "").trim(), head, eventChannelUrl(event, guildId)].filter(Boolean).join("\n");
}

/** DM each user in turn (sequential: Discord rate-limits DMs hard). Never throws. */
async function sendDms(userIds, payload) {
    const sent = [];
    const failed = [];
    for (const id of userIds) {
        const result = await discord.sendDirectMessage(id, payload);
        if (result && result.ok) sent.push(id);
        else failed.push(id);
    }
    return { sent, failed };
}

/**
 * Ping the given users (the missing raiders, or a reminder's recipients).
 *
 * @param {object} p
 * @param {string} p.target   "event" | "talk" | "both"
 * @param {object} p.event    { title, startTime, channelId }
 * @param {string[]} p.userIds
 * @param {string} p.text     the message; empty = discord.postMissingPing's default
 * @param {string} p.guildId  the event server (for the jump link in a DM)
 * @returns {Promise<{ target, event: object|null, talk: object|null, mentioned: number, dm: { sent: string[], failed: string[] } | null }>}
 */
async function deliverUserPing({ target, event, userIds, text = "", guildId = "", config = getConfig() }) {
    const mode = normalizePingTarget(target);
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    const talk = includesTalk(mode) ? talkPingChannel(config) : null;
    if (includesTalk(mode) && !talk) throw new Error("Auf dem Kommunikations-Discord ist kein Ping-Kanal eingestellt.");
    // Read the talk members before posting anything, so a failure there never
    // leaves a half-delivered ping behind.
    const onTalk = talk ? await talkMemberIds(talk.guildId) : null;

    const result = { target: mode, event: null, talk: null, mentioned: 0, dm: null };
    if (includesEvent(mode)) {
        if (!event || !event.channelId) throw new Error("Das Event hat keinen Kanal.");
        result.event = await discord.postMissingPing(event.channelId, users, text);
    }
    if (talk) {
        const present = users.filter((id) => onTalk.has(id));
        const absent = users.filter((id) => !onTalk.has(id));
        if (present.length) result.talk = await discord.postMissingPing(talk.channelId, present, text);
        result.mentioned = present.length;
        if (!includesEvent(mode) && absent.length) {
            result.dm = await sendDms(absent, { content: dmContent(text || "Bitte melde dich für den Raid an oder ab.", event, guildId) });
        }
    }
    return result;
}

/** The event-server roles that have a talk-server counterpart, and those that do not. */
function mapRoles(roleIds, config) {
    const mapping = Array.isArray(config && config.roleSync) ? config.roleSync : [];
    const talkRoleIds = [];
    const unmapped = [];
    for (const id of roleIds) {
        const pairs = mapping.filter((m) => m.eventRoleId === id);
        if (pairs.length) pairs.forEach((m) => talkRoleIds.push(m.talkRoleId));
        else unmapped.push(id);
    }
    return { talkRoleIds: [...new Set(talkRoleIds)], unmapped };
}

/**
 * Post a sign-up call (a notify template) with role pings.
 *
 * @param {object} p
 * @param {string} p.target      "event" | "talk" | "both"
 * @param {object} p.event       { title, startTime, channelId }
 * @param {string} p.channelId   the event channel the call goes to
 * @param {object} p.template    { title, body }
 * @param {string[]} p.roleIds   event-server roles
 * @param {string} p.guildId     the server those roles belong to
 */
async function deliverAnnouncement({ target, event, channelId, template, roleIds, guildId = "", config = getConfig() }) {
    const mode = normalizePingTarget(target);
    const roles = [...new Set((roleIds || []).map(String).filter(Boolean))];
    const result = { target: mode, event: null, talk: null, mentioned: 0, dm: null };

    let talkPlan = null;
    if (includesTalk(mode)) {
        const talk = talkPingChannel(config);
        if (!talk) throw new Error("Auf dem Kommunikations-Discord ist kein Ping-Kanal eingestellt.");
        const onTalk = roles.length ? await talkMemberIds(talk.guildId) : new Set();
        const { talkRoleIds, unmapped } = mapRoles(roles, config);
        let userIds = [];
        let absent = [];
        if (roles.length) {
            const all = await discord.listMembersWithRoles(guildId, roles);
            if (all.error) throw new Error(all.error);
            const covered = new Set();
            if (talkRoleIds.length && unmapped.length < roles.length) {
                const mapped = await discord.listMembersWithRoles(guildId, roles.filter((r) => !unmapped.includes(r)));
                if (mapped.error) throw new Error(mapped.error);
                mapped.members.forEach((m) => covered.add(String(m.id)));
            }
            userIds = all.members.map((m) => String(m.id)).filter((id) => onTalk.has(id) && !covered.has(id));
            absent = all.members.map((m) => String(m.id)).filter((id) => !onTalk.has(id));
        }
        talkPlan = { talk, talkRoleIds, userIds, absent };
    }

    if (includesEvent(mode)) {
        if (!channelId) throw new Error("Vorlage oder Channel fehlt.");
        result.event = await discord.postAnnouncement(channelId, template, roles);
    }
    if (talkPlan) {
        result.talk = await discord.postAnnouncement(talkPlan.talk.channelId, template, talkPlan.talkRoleIds, talkPlan.userIds);
        result.mentioned = talkPlan.userIds.length;
        if (!includesEvent(mode) && talkPlan.absent.length) {
            const text = [template.title ? `**${template.title}**` : "", template.body || ""].filter(Boolean).join("\n");
            result.dm = await sendDms(talkPlan.absent, { content: dmContent(text, event, guildId) });
        }
    }
    return result;
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
    PING_TARGETS, TARGET_LABELS,
    normalizePingTarget, talkPingChannel, pingTargetInfo,
    deliverUserPing, deliverAnnouncement, dmSummary, dmContent, mapRoles, sendDms,
};
