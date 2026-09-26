// A fake discord.js client for the suites that hand one to src/ (#433) - a
// guild with channels and members, a channel with messages - built on the
// Map-like collection of mockInteraction.js. Nothing here talks to Discord.
//
//   const client = makeClient({ guilds: [makeGuild({ id: "g1", members: [member] })], channels: [makeChannel({ id: "c1" })] });
//   discord.getClient.mockReturnValue(client);
//
// Every list takes objects with an `id` (or [id, value] pairs). fetch(id)
// answers what the cache holds; a miss rejects like Discord does (Unknown
// Channel / Member / Guild, with its code) unless `missing: "null"` is given,
// which answers null instead - the shape several src/ callers guard for.
const { ChannelType } = require("discord.js");
const { makeCollection } = require("./mockInteraction");

const UNKNOWN = { channel: 10003, guild: 10004, member: 10007, message: 10008 };

/** The error discord.js throws for an unknown id (`code` as the API sends it). */
function discordError(kind) {
    const name = kind.charAt(0).toUpperCase() + kind.slice(1);
    return Object.assign(new Error(`Unknown ${name}`), { code: UNKNOWN[kind], status: 404 });
}

function collectionOf(list) {
    return makeCollection(list.map((entry) => (Array.isArray(entry) ? entry : [entry.id, entry])));
}

/** A manager `{ cache, fetch }`: fetch(id) -> the cached entry, fetch() -> the whole cache. */
function manager(list, kind, missing) {
    const cache = collectionOf(list);
    const fetch = jest.fn(async (id) => {
        if (id === undefined || id === null || typeof id === "object") return cache;
        if (cache.has(id)) return cache.get(id);
        if (missing === "null") return null;
        throw discordError(kind);
    });
    return { cache, fetch };
}

/**
 * A text channel: send() answers a message, messages.fetch(id) the one in
 * `messages` (or rejects), isTextBased() true. `over` adds or replaces fields.
 */
function makeChannel({ id = "c1", name = "raid", type = ChannelType.GuildText, guildId = "g1", messages = [], ...over } = {}) {
    const msgs = manager(messages, "message");
    const channel = {
        id,
        name,
        type,
        guildId,
        isTextBased: () => type !== ChannelType.GuildVoice && type !== ChannelType.GuildCategory,
        send: jest.fn(async (payload) => ({ id: "m-new", channelId: id, payload })),
        messages: { cache: msgs.cache, fetch: msgs.fetch },
        ...over,
    };
    return channel;
}

/** A guild member with roles `roleIds`; `roles.cache` is a collection of { id }. */
function makeMember({ id = "u1", roleIds = [], displayName = "Tester", ...over } = {}) {
    return {
        id,
        displayName,
        user: { id, username: displayName.toLowerCase(), bot: false },
        roles: { cache: collectionOf(roleIds.map((r) => ({ id: r }))) },
        send: jest.fn(async () => ({ id: "dm-1" })),
        ...over,
    };
}

/**
 * A guild: channels / members / roles as managers, `members.me` the bot.
 * `over` adds or replaces fields (scheduledEvents, emojis, ...).
 */
function makeGuild({ id = "g1", name = "Guild", channels = [], members = [], roles = [], me = { id: "bot" }, ...over } = {}) {
    const ch = manager(channels, "channel");
    const mem = manager(members, "member");
    const rl = manager(roles, "role");
    const guild = {
        id,
        name,
        channels: { cache: ch.cache, fetch: ch.fetch, create: jest.fn(async (payload) => ({ id: "new-chan", ...payload })) },
        members: { cache: mem.cache, fetch: mem.fetch, me },
        roles: { cache: rl.cache, fetch: rl.fetch, everyone: { id } },
        ...over,
    };
    return guild;
}

/**
 * The client: guilds and channels as managers, `user` the bot, isReady() true.
 * `members` puts those members on a default guild "g1" when no guild is given.
 * `missing: "null"` makes a channels.fetch miss answer null instead of throwing.
 */
function makeClient({ guilds = [], channels = [], members = [], user = { id: "bot", tag: "EventHelper#0001" }, ready = true, missing, ...over } = {}) {
    const guildList = guilds.length || !members.length ? guilds : [makeGuild({ members })];
    const gl = manager(guildList, "guild");
    const ch = manager(channels, "channel", missing);
    return {
        user,
        isReady: jest.fn(() => ready),
        guilds: { cache: gl.cache, fetch: gl.fetch },
        channels: { cache: ch.cache, fetch: ch.fetch },
        ...over,
    };
}

module.exports = { makeClient, makeGuild, makeChannel, makeMember, discordError };
