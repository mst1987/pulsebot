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
function missingRights(guildId, { parentId = "", onlyAssigned = false } = {}) {
    const guild = discord.getGuild(guildId);
    const me = guild && guild.members ? guild.members.me : null;
    if (!guild || !me) return null;
    const parent = parentId ? guild.channels.cache.get(String(parentId)) : null;
    const perms = parent && typeof parent.permissionsFor === "function" ? parent.permissionsFor(me) : me.permissions;
    if (!perms) return null;
    const wanted = onlyAssigned ? [...RIGHTS, ...RIGHTS_ONLY_ASSIGNED] : RIGHTS;
    return wanted.filter((r) => !perms.has(F[r.key])).map((r) => r.label);
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
    const meId = guild.members && guild.members.me ? guild.members.me.id : "";
    if (meId) out.push({ id: meId, type: OverwriteType.Member, allow: [F.ViewChannel, F.Connect, F.ManageChannels, F.MoveMembers] });
    for (const id of members) {
        if (id !== meId) out.push({ id, type: OverwriteType.Member, allow: [F.ViewChannel, F.Connect] });
    }
    return out;
}

/** Only the assigned that are on the server - an overwrite for a stranger fails the whole create. */
function knownMembers(guild, members = []) {
    const cache = guild.members && guild.members.cache;
    return [...new Set(members.map(String))].filter((id) => cache && cache.has(id));
}

/** Create the raid's voice channel; `{ id, name }`. Discord's refusal passes through. */
async function createVoice(guildId, { name, parentId = "", onlyAssigned = false, members = [] } = {}) {
    const guild = guildOf(guildId);
    const parent = parentId ? guild.channels.cache.get(String(parentId)) : null;
    const payload = { name: String(name || "Raid"), type: ChannelType.GuildVoice };
    if (parent) payload.parent = parent.id;
    if (onlyAssigned) payload.permissionOverwrites = onlyAssignedOverwrites(guild, parent, knownMembers(guild, members));
    const created = await guild.channels.create(payload);
    return { id: created.id, name: created.name };
}

/**
 * With "only assigned": give the newly assigned their seat and take it from those
 * no longer in the setup. Returns how many overwrites changed; 0 when the channel is gone.
 */
async function syncMembers(guildId, channelId, members = []) {
    const channel = channelOf(guildId, channelId);
    if (!channel || !channel.permissionOverwrites) return 0;
    const guild = channel.guild;
    const meId = guild.members && guild.members.me ? guild.members.me.id : "";
    const want = new Set(knownMembers(guild, members));
    const have = [...channel.permissionOverwrites.cache.values()].filter((o) => o.type === OverwriteType.Member && o.id !== meId);
    let changed = 0;
    for (const o of have) {
        if (want.has(o.id)) want.delete(o.id);
        else {
            await channel.permissionOverwrites.delete(o.id);
            changed += 1;
        }
    }
    for (const id of want) {
        await channel.permissionOverwrites.create(id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
        changed += 1;
    }
    return changed;
}

/** Rename the channel (a raid split off or merged back); the new name, or "" when it is gone. */
async function renameVoice(guildId, channelId, name) {
    const channel = channelOf(guildId, channelId);
    if (!channel || !name) return "";
    if (channel.name === name) return name;
    const done = await channel.setName(String(name));
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
    RIGHTS, RIGHTS_ONLY_ASSIGNED, channelUrl, missingRights, onlyAssignedOverwrites, createVoice, renameVoice, syncMembers, memberCount,
    closeVoice, memberName, channelName,
};
