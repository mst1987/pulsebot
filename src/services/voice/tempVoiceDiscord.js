// The Discord side of the temporary raid voice channels (tempVoiceJob.js): create,
// count, sync who may join, move people out and delete. Every call takes the server
// and channel ids; none of them reads a store.
const { ChannelType, OverwriteType, PermissionsBitField } = require("discord.js");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");

const F = PermissionsBitField.Flags;

// What the bot needs for the channels: create/delete them, move people out at the
// latest close and, with "only assigned", set who may join.
const RIGHTS = [
    { key: "ManageChannels", label: "Kanäle verwalten" },
    { key: "MoveMembers", label: "Mitglieder verschieben" },
];
const RIGHTS_ONLY_ASSIGNED = [{ key: "ManageRoles", label: "Berechtigungen verwalten" }];
// How long fetching the assigned that are not cached may take before the cache alone decides.
const MEMBER_FETCH_MS = 5000;
// Discord's "Unknown Channel" - the only answer that proves a channel is gone.
const UNKNOWN_CHANNEL = 10003;

const botOffline = () => Object.assign(new Error("Bot nicht verbunden oder nicht auf dem Server."), { code: "bot_offline" });

function guildOf(guildId) {
    const guild = discord.getGuild(guildId);
    if (!guild) throw botOffline();
    return guild;
}

/** The channel from the cache, or null when it is gone (or the bot cannot see it). */
function channelOf(guildId, channelId) {
    const guild = discord.getGuild(guildId);
    if (!guild || !channelId) return null;
    return guild.channels.cache.get(String(channelId)) || null;
}

/** The link of "In Discord öffnen" - through linkCheck (#537), "" for a channel that is gone. */
const channelUrl = (guildId, channelId) => linkCheck.channelLink(guildId, channelId);

/**
 * The rights the bot misses for the channels, as labels ("Mitglieder verschieben");
 * checked in the Discord category when it is known. Null when nothing can be known
 * (bot not on the server or not connected).
 */
function missingRights(guildId, options = {}) {
    const keys = missingRightKeys(guildId, options);
    return keys && keys.map((key) => [...RIGHTS, ...RIGHTS_ONLY_ASSIGNED].find((r) => r.key === key).label);
}

/**
 * The same as Discord permission names ("MoveMembers"), for the settings page that
 * names them in its own language. Null when nothing can be known.
 */
function missingRightKeys(guildId, { parentId = "", onlyAssigned = false } = {}) {
    const guild = discord.getGuild(guildId);
    const me = guild && guild.members ? guild.members.me : null;
    if (!guild || !me) return null;
    const parent = parentId ? guild.channels.cache.get(String(parentId)) : null;
    const perms = parent && typeof parent.permissionsFor === "function" ? parent.permissionsFor(me) : me.permissions;
    if (!perms) return null;
    const wanted = onlyAssigned ? [...RIGHTS, ...RIGHTS_ONLY_ASSIGNED] : RIGHTS;
    return wanted.filter((r) => !perms.has(F[r.key])).map((r) => r.key);
}

/**
 * The permission overwrites for "only assigned": the category's own overwrites
 * stay (who may see it), but nobody may connect except the assigned and the bot.
 */
function onlyAssignedOverwrites(guild, parent, members) {
    const out = [];
    const everyoneId = guild.roles && guild.roles.everyone ? guild.roles.everyone.id : guild.id;
    const own = parent && parent.permissionOverwrites && parent.permissionOverwrites.cache ? [...parent.permissionOverwrites.cache.values()] : [];
    for (const o of own) {
        if (o.type !== OverwriteType.Role || o.id === everyoneId) continue;
        const allow = new PermissionsBitField(o.allow).remove(F.Connect);
        const deny = new PermissionsBitField(o.deny).add(F.Connect);
        out.push({ id: o.id, type: OverwriteType.Role, allow, deny });
    }
    const everyone = own.find((o) => o.id === everyoneId);
    out.push({
        id: everyoneId,
        type: OverwriteType.Role,
        allow: everyone ? new PermissionsBitField(everyone.allow).remove(F.Connect) : [],
        deny: everyone ? new PermissionsBitField(everyone.deny).add(F.Connect) : [F.Connect],
    });
    const meId = botId(guild);
    if (meId) out.push({ id: meId, type: OverwriteType.Member, allow: [F.ViewChannel, F.Connect, F.ManageChannels, F.MoveMembers] });
    for (const id of members) {
        if (id !== meId) out.push({ id, type: OverwriteType.Member, allow: [F.ViewChannel, F.Connect] });
    }
    return out;
}

const botId = (guild) => (guild.members && guild.members.me ? guild.members.me.id : "");

/**
 * Only the assigned that are on the server - an overwrite for a stranger fails the
 * whole create. Who is not cached is fetched first (at most MEMBER_FETCH_MS); when
 * that fails, the cache alone decides.
 */
async function knownMembers(guild, members = []) {
    const cache = guild.members && guild.members.cache;
    const ids = [...new Set(members.map(String).filter(Boolean))];
    const unknown = ids.filter((id) => !(cache && cache.has(id)));
    if (unknown.length && guild.members && typeof guild.members.fetch === "function") {
        let timer = null;
        try {
            await Promise.race([
                guild.members.fetch({ user: unknown }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("member fetch timeout")), MEMBER_FETCH_MS); }),
            ]);
        } catch {
            // The cache decides; whoever is missing gets the seat on the next sync.
        } finally {
            clearTimeout(timer);
        }
    }
    return ids.filter((id) => cache && cache.has(id));
}

/**
 * Create the raid's voice channel; `{ id, name, granted }` - granted = the members the
 * bot gave a seat. A rate limit rejects at once (discord.isRateLimitError); Discord's
 * refusal passes through.
 */
async function createVoice(guildId, { name, parentId = "", onlyAssigned = false, members = [] } = {}) {
    const guild = guildOf(guildId);
    const parent = parentId ? guild.channels.cache.get(String(parentId)) : null;
    const payload = { name: String(name || "Raid"), type: ChannelType.GuildVoice };
    if (parent) payload.parent = parent.id;
    let granted = [];
    if (onlyAssigned) {
        const meId = botId(guild);
        granted = (await knownMembers(guild, members)).filter((id) => id !== meId);
        payload.permissionOverwrites = onlyAssignedOverwrites(guild, parent, granted);
    }
    const created = await discord.failFastOnRateLimit(`/guilds/${guild.id}/channels`, () => guild.channels.create(payload));
    return { id: created.id, name: created.name, granted };
}

/**
 * With "only assigned": give the newly assigned their seat and take it from those no
 * longer in the setup - but only seats the bot gave itself (`granted`); a seat set by
 * hand stays. Returns `{ granted, changed }`; null when the channel is gone.
 */
async function syncMembers(guildId, channelId, members = [], granted = []) {
    const channel = channelOf(guildId, channelId);
    if (!channel || !channel.permissionOverwrites) return null;
    const guild = channel.guild;
    const meId = botId(guild);
    const want = new Set((await knownMembers(guild, members)).filter((id) => id !== meId));
    const ours = new Set(granted.map(String));
    const have = new Set([...channel.permissionOverwrites.cache.values()].filter((o) => o.type === OverwriteType.Member).map((o) => o.id));
    let changed = 0;
    for (const id of ours) {
        if (want.has(id)) continue;
        if (have.has(id)) {
            await channel.permissionOverwrites.delete(id);
            changed += 1;
        }
        ours.delete(id);
    }
    for (const id of want) {
        if (!have.has(id)) {
            await channel.permissionOverwrites.create(id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
            changed += 1;
            ours.add(id);
        }
        // An overwrite set by hand before the setup named them stays theirs, not ours.
    }
    return { granted: [...ours], changed };
}

/**
 * "Only assigned" switched on or off while the channel is open. On: the category's
 * overwrites plus the seats (as on create). Off: the channel follows its Discord
 * category again (or, without one, drops the @everyone lock). Returns
 * `{ granted }`; null when the channel is gone.
 */
async function setAccess(guildId, channelId, { onlyAssigned = false, members = [] } = {}) {
    const channel = channelOf(guildId, channelId);
    if (!channel || !channel.permissionOverwrites) return null;
    const guild = channel.guild;
    const parent = channel.parentId ? guild.channels.cache.get(String(channel.parentId)) : null;
    if (onlyAssigned) {
        const meId = botId(guild);
        const granted = (await knownMembers(guild, members)).filter((id) => id !== meId);
        await channel.permissionOverwrites.set(onlyAssignedOverwrites(guild, parent, granted), "Nur Eingeteilte");
        return { granted };
    }
    if (parent && typeof channel.lockPermissions === "function") {
        await channel.lockPermissions();
    } else {
        const everyoneId = guild.roles && guild.roles.everyone ? guild.roles.everyone.id : guild.id;
        if (channel.permissionOverwrites.cache.has(everyoneId)) await channel.permissionOverwrites.delete(everyoneId);
    }
    return { granted: [] };
}

/**
 * Whether the channel is proven gone: only Discord's "Unknown Channel" (404/10003)
 * counts. A cached channel, a server that is not available or any other error is not
 * proof - false.
 */
async function channelGone(guildId, channelId) {
    if (!channelId || !discord.isGuildAvailable(guildId)) return false;
    const guild = discord.getGuild(guildId);
    if (!guild) return false;
    if (guild.channels.cache.has(String(channelId))) return false;
    try {
        const found = await guild.channels.fetch(String(channelId), { force: true });
        return !found;
    } catch (e) {
        return Boolean(e && (e.code === UNKNOWN_CHANNEL || e.status === 404));
    }
}

/**
 * A voice channel the bot created for a raid before it could note the id (a crash
 * between create and save): same name, same Discord category, created since `since`
 * (seconds, a minute's slack). The channel, or null.
 */
function findCreatedVoice(guildId, { name = "", parentId = "", since = 0 } = {}) {
    const guild = discord.getGuild(guildId);
    if (!guild || !name) return null;
    const from = (Number(since) - 60) * 1000;
    for (const ch of guild.channels.cache.values()) {
        if (ch.type !== ChannelType.GuildVoice || ch.name !== name) continue;
        if (String(ch.parentId || "") !== String(parentId || "")) continue;
        if (Number(ch.createdTimestamp || 0) >= from) return ch;
    }
    return null;
}

/**
 * Rename the channel (a raid split off or merged back); the new name, or "" when it
 * is gone. A rate limit rejects at once (discord.isRateLimitError) instead of waiting.
 */
async function renameVoice(guildId, channelId, name) {
    const channel = channelOf(guildId, channelId);
    if (!channel || !name) return "";
    if (channel.name === name) return name;
    const done = await discord.setChannelNameFast(channel, String(name), "Raid-Sprachkanal umbenannt");
    return (done && done.name) || String(name);
}

/** How many are in the channel right now; null when the channel is gone. */
function memberCount(guildId, channelId) {
    const channel = channelOf(guildId, channelId);
    if (!channel) return null;
    return channel.members ? channel.members.size : 0;
}

/**
 * Close the channel: whoever is still in it moves to `moveTo` (the category's
 * fixed channel) when that exists and the bot may move, then the channel goes.
 * Returns `{ moved, deleted }`; a channel already gone counts as deleted.
 */
async function closeVoice(guildId, channelId, { moveTo = "" } = {}) {
    const channel = channelOf(guildId, channelId);
    if (!channel) return { moved: 0, deleted: true };
    const target = moveTo ? channelOf(guildId, moveTo) : null;
    let moved = 0;
    if (target && target.id !== channel.id && channel.members) {
        for (const member of [...channel.members.values()]) {
            try {
                await member.voice.setChannel(target);
                moved += 1;
            } catch {
                // Somebody who cannot be moved stays; the delete below drops them from the call.
            }
        }
    }
    await channel.delete("Temporärer Raid-Sprachkanal geschlossen");
    return { moved, deleted: true };
}

/** The raid leader's name on the server, for {leader}; "" when unknown. */
function memberName(guildId, userId) {
    const guild = discord.getGuild(guildId);
    const member = guild && guild.members && guild.members.cache ? guild.members.cache.get(String(userId || "")) : null;
    return member ? member.displayName || (member.user && member.user.username) || "" : "";
}

/** The Discord category's name ("Raids"), "" when unknown. */
function channelName(guildId, channelId) {
    const channel = channelOf(guildId, channelId);
    return channel ? channel.name || "" : "";
}

module.exports = {
    RIGHTS, RIGHTS_ONLY_ASSIGNED, channelUrl, missingRights, missingRightKeys, onlyAssignedOverwrites, createVoice, renameVoice, syncMembers, setAccess,
    channelGone, findCreatedVoice, memberCount, closeVoice, memberName, channelName,
};
