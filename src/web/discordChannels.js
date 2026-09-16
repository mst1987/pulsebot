// Changing channels on Discord for the Kanäle page (issue #259): edit, archive,
// delete (only from the archive), create a category, create from a template.
//
// A module of its own next to discord.js rather than more functions in it —
// discord.js is the bot's shared gateway, and the reads it offers stay there
// (listAllChannels, listCategories). Everything here goes through its client.

const { ChannelType, PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const { normalizeForType } = require("../utils/channelNames");

/** Slowmode Discord accepts: 0 (off) to 6 hours. */
const MAX_SLOWMODE = 21600;
const TOPIC_MAX = 1024;

/** A channel of any guild the bot is in, from the cache first. */
async function fetchChannel(channelId) {
    const client = discord.getClient();
    if (!client) throw new Error("Bot nicht verbunden.");
    const id = String(channelId || "").trim();
    const channel = (client.channels.cache && client.channels.cache.get(id)) || await client.channels.fetch(id).catch(() => null);
    if (!channel || channel.type === ChannelType.GuildCategory || typeof channel.edit !== "function") {
        throw new Error("Kanal nicht gefunden.");
    }
    return channel;
}

/**
 * Topic, slowmode and whether the permissions follow the category — the parts
 * of a channel the tree shows in its tooltip, which listAllChannels() leaves out.
 * `{ [channelId]: { topic, rateLimitPerUser, permissionsLocked } }`.
 */
function listChannelDetails(guildId) {
    const guild = discord.getGuild(guildId);
    if (!guild) return {};
    const out = {};
    for (const c of guild.channels.cache.values()) {
        if (c.type === ChannelType.GuildCategory) continue;
        let locked = null;
        try {
            locked = typeof c.permissionsLocked === "boolean" ? c.permissionsLocked : null;
        } catch {
            locked = null;
        }
        out[c.id] = { topic: c.topic || "", rateLimitPerUser: c.rateLimitPerUser || 0, permissionsLocked: locked };
    }
    return out;
}

/**
 * The fields of a change request that are actually set, validated. Only these
 * reach Discord — a bulk edit that leaves "Kategorie" at "unverändert" must not
 * move anything. Throws on a value Discord would refuse anyway.
 */
function pickChanges(changes = {}, type = 0) {
    const out = {};
    if (changes.name !== undefined && changes.name !== null) {
        const name = normalizeForType(changes.name, type);
        if (!name) throw new Error("Name ist leer.");
        out.name = name;
    }
    if (changes.topic !== undefined && changes.topic !== null) {
        const topic = String(changes.topic);
        if (topic.length > TOPIC_MAX) throw new Error(`Thema ist länger als ${TOPIC_MAX} Zeichen.`);
        out.topic = topic;
    }
    if (changes.parentId !== undefined && changes.parentId !== null) {
        out.parentId = String(changes.parentId).trim();
    }
    if (changes.rateLimitPerUser !== undefined && changes.rateLimitPerUser !== null && changes.rateLimitPerUser !== "") {
        const n = Math.floor(Number(changes.rateLimitPerUser));
        if (!Number.isFinite(n) || n < 0 || n > MAX_SLOWMODE) throw new Error("Slowmode muss zwischen 0 und 6 Stunden liegen.");
        out.rateLimitPerUser = n;
    }
    return out;
}

/** Apply picked changes to one channel. Returns the channel as it is afterwards. */
async function editChannel(channelId, changes = {}) {
    const channel = await fetchChannel(channelId);
    const picked = pickChanges(changes, channel.type);
    const payload = {};
    if (picked.name !== undefined && picked.name !== channel.name) payload.name = picked.name;
    if (picked.topic !== undefined && picked.topic !== (channel.topic || "")) payload.topic = picked.topic;
    if (picked.rateLimitPerUser !== undefined && picked.rateLimitPerUser !== (channel.rateLimitPerUser || 0)) payload.rateLimitPerUser = picked.rateLimitPerUser;
    if (picked.parentId !== undefined && picked.parentId !== (channel.parentId || "")) {
        payload.parent = picked.parentId || null;
        // Keep the channel's own permissions; moving is not re-permissioning.
        payload.lockPermissions = false;
    }
    const edited = Object.keys(payload).length ? await channel.edit(payload) : channel;
    return { id: edited.id, name: edited.name, parentId: edited.parentId || "", changed: Object.keys(payload).filter((k) => k !== "lockPermissions") };
}

/**
 * Move a channel into the archive category and take the right to write away
 * from everyone who had an overwrite there (and from @everyone). Voice-like
 * channels also lose "Verbinden". Returns where it came from, for the log.
 */
async function archiveChannel(channelId, archiveCategoryId) {
    const archiveId = String(archiveCategoryId || "").trim();
    if (!archiveId) throw new Error("Keine Archiv-Kategorie festgelegt.");
    const channel = await fetchChannel(channelId);
    const fromParentId = channel.parentId || "";
    const fromCategory = channel.parent ? channel.parent.name : "";
    if (fromParentId !== archiveId) await channel.edit({ parent: archiveId, lockPermissions: false });

    const voice = [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type);
    const deny = voice ? { SendMessages: false, Connect: false } : { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false };
    const overwrites = channel.permissionOverwrites;
    if (overwrites && typeof overwrites.edit === "function") {
        const everyone = channel.guild && channel.guild.roles ? channel.guild.roles.everyone : null;
        const targets = new Set([...(overwrites.cache ? overwrites.cache.keys() : [])]);
        if (everyone) targets.add(everyone.id);
        const me = channel.guild && channel.guild.members ? channel.guild.members.me : null;
        for (const id of targets) {
            // The bot keeps what it had, or the channel could not be deleted later.
            if (me && id === me.id) continue;
            await overwrites.edit(id, deny);
        }
    }
    return { id: channel.id, name: channel.name, fromParentId, fromCategory, guildId: channel.guildId || (channel.guild && channel.guild.id) || "" };
}

/**
 * Delete a channel — only one that sits in the archive category. This is the
 * one irreversible action of the page, so the rule lives here, below every
 * caller, and not just in the dialog that asks for the name.
 */
async function deleteChannel(channelId, archiveCategoryId) {
    const archiveId = String(archiveCategoryId || "").trim();
    if (!archiveId) throw new Error("Keine Archiv-Kategorie festgelegt.");
    const channel = await fetchChannel(channelId);
    if ((channel.parentId || "") !== archiveId) throw new Error("Nur Kanäle im Archiv können gelöscht werden.");
    const { id, name } = channel;
    await channel.delete("EventHelper: aus dem Archiv gelöscht");
    return { id, name };
}

/** Create a category (e.g. the archive). */
async function createCategory(guildId, name) {
    const guild = discord.getGuild(guildId);
    if (!guild) throw new Error("Server nicht gefunden oder Bot nicht verbunden.");
    const clean = String(name || "").trim().slice(0, 100);
    if (!clean) throw new Error("Name der Kategorie fehlt.");
    const created = await guild.channels.create({ name: clean, type: ChannelType.GuildCategory });
    return { id: created.id, name: created.name };
}

/**
 * The index to hand discord.js' setPosition() so a channel ends up right after
 * (or before) an anchor among its siblings. setPosition takes the channel out
 * of the sorted list first, so an anchor below the channel moves up by one.
 */
function positionTarget({ anchor, current, after = true }) {
    const a = Number(anchor) || 0;
    const moved = Number(current) < a;
    if (after) return moved ? a : a + 1;
    return moved ? a - 1 : a;
}

/**
 * Sort a channel in next to another one of the same category —
 * `{ afterChannelId }` or `{ beforeChannelId }` (#285: right behind the
 * previous date). Best-effort: a channel that cannot be moved still exists, so
 * this never throws; it answers whether it moved.
 */
async function placeChannel(channelOrId, { afterChannelId = "", beforeChannelId = "" } = {}) {
    const anchorId = afterChannelId || beforeChannelId;
    if (!anchorId) return false;
    try {
        const channel = typeof channelOrId === "object" && channelOrId ? channelOrId : await fetchChannel(channelOrId);
        const anchor = await fetchChannel(anchorId);
        if (anchor.id === channel.id || String(anchor.parentId || "") !== String(channel.parentId || "")) return false;
        if (typeof channel.setPosition !== "function" || !Number.isFinite(anchor.position) || !Number.isFinite(channel.position)) return false;
        const target = positionTarget({ anchor: anchor.position, current: channel.position, after: !!afterChannelId });
        if (target !== channel.position) await channel.setPosition(target);
        return true;
    } catch {
        return false;
    }
}

/**
 * Create a channel for a new event or quick-create: a copy of the template
 * channel (rights, topic, slowmode) when one is given, else a plain text
 * channel with the category's rights. `afterChannelId` / `beforeChannelId`
 * sort it in next to that channel.
 */
async function createFromTemplate(guildId, { name, parentId = "", templateChannelId = "", afterChannelId = "", beforeChannelId = "" } = {}) {
    let created;
    if (templateChannelId) {
        const template = await fetchChannel(templateChannelId);
        if (typeof template.clone !== "function") throw new Error("Vorlage-Kanal kann nicht kopiert werden.");
        created = await template.clone({ name, parent: parentId || template.parentId || null });
    } else {
        created = await discord.createChannel(guildId, { name, type: "text", parentId });
    }
    const positioned = afterChannelId || beforeChannelId
        ? await placeChannel(typeof created.setPosition === "function" ? created : created.id, { afterChannelId, beforeChannelId })
        : false;
    return { id: created.id, name: created.name, ...(templateChannelId ? { copiedFrom: templateChannelId } : {}), ...(positioned ? { positioned } : {}) };
}

/** A readable reason for a failed Discord call ("fehlende Rechte"). */
function discordErrorText(err) {
    const code = err && (err.code ?? err.rawError?.code);
    if (code === 50013 || code === 50001) return "fehlende Rechte";
    if (code === 10003) return "Kanal nicht gefunden";
    if (code === 50035) return "ungültige Eingabe";
    if (err && err.status === 429) return "Discord bremst (Rate-Limit)";
    return (err && err.message) || "unbekannter Fehler";
}

/** Whether the bot may manage channels at all in this guild. */
function botCanManageChannels(guildId) {
    const guild = discord.getGuild(guildId);
    const me = guild && guild.members ? guild.members.me : null;
    if (!me || !me.permissions || typeof me.permissions.has !== "function") return null;
    return me.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

module.exports = {
    MAX_SLOWMODE, TOPIC_MAX,
    fetchChannel, listChannelDetails, pickChanges, editChannel, archiveChannel, deleteChannel,
    createCategory, createFromTemplate, positionTarget, placeChannel, discordErrorText, botCanManageChannels,
};
