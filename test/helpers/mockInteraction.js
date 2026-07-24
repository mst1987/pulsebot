/**
 * Shared test helpers for faking a Discord.js interaction.
 *
 * None of these touch the network or the real Discord API. Use them to build
 * an `interaction` object with just enough surface for the command/util under
 * test, then assert on the jest.fn() spies (reply / editReply / followUp ...).
 */

/**
 * Build a fake Discord collection (Map-like) that also exposes the
 * `.cache.find` / `.forEach` shapes the code uses on emojis and channels.
 * @param {Array} entries array of [key, value] pairs
 */
function makeCollection(entries = []) {
    const map = new Map(entries);
    map.find = (predicate) => {
        for (const value of map.values()) {
            if (predicate(value)) return value;
        }
        return undefined;
    };
    map.filter = (predicate) => {
        const out = new Map();
        for (const [key, value] of map.entries()) {
            if (predicate(value, key)) out.set(key, value);
        }
        out.find = map.find;
        return out;
    };
    return map;
}

/**
 * Create a mock interaction.
 *
 * @param {object} [opts]
 * @param {string} [opts.userId="123"]        interaction.user.id
 * @param {object} [opts.options={}]           map returned by getString/getInteger/...
 * @param {string} [opts.commandName]          interaction.commandName
 * @param {string} [opts.customId]             interaction.customId (button/modal)
 * @param {object} [opts.channel]              override interaction.channel
 * @param {object} [opts.guild]                override interaction.guild
 * @param {Array}  [opts.emojis=[]]            [name, emoji] entries for guild.emojis.cache
 * @param {Array}  [opts.channels=[]]          [id, channel] entries for guild.channels.cache
 * @param {object} [opts.member]               object returned by guild.members.fetch
 */
function mockInteraction(opts = {}) {
    const {
        userId = "123",
        options = {},
        commandName,
        customId,
        emojis = [],
        channels = [],
        member = { displayName: "Tester", id: userId },
    } = opts;

    const sentMessage = {
        delete: jest.fn().mockResolvedValue(undefined),
        edit: jest.fn().mockResolvedValue(undefined),
    };

    const guild = opts.guild || {
        id: "guild-1",
        emojis: { cache: makeCollection(emojis) },
        channels: { cache: makeCollection(channels) },
        members: { fetch: jest.fn().mockResolvedValue(member) },
    };

    const channel = opts.channel || {
        id: "channel-1",
        parent: { id: "category-1" },
        messages: { fetch: jest.fn().mockResolvedValue(makeCollection()) },
    };

    const getOpt = (name) => (name in options ? options[name] : null);

    const interaction = {
        user: { id: userId, username: "tester" },
        guild,
        channel,
        commandName,
        customId,
        replied: false,
        deferred: false,
        reply: jest.fn().mockResolvedValue(sentMessage),
        editReply: jest.fn().mockResolvedValue(sentMessage),
        followUp: jest.fn().mockResolvedValue(sentMessage),
        deferReply: jest.fn().mockResolvedValue(undefined),
        deleteReply: jest.fn().mockResolvedValue(undefined),
        showModal: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(sentMessage),
        fetchReply: jest.fn().mockResolvedValue(sentMessage),
        options: {
            getString: jest.fn((name) => getOpt(name)),
            getInteger: jest.fn((name) => getOpt(name)),
            getNumber: jest.fn((name) => getOpt(name)),
            getBoolean: jest.fn((name) => getOpt(name)),
            getUser: jest.fn((name) => getOpt(name)),
            getChannel: jest.fn((name) => getOpt(name)),
            getSubcommand: jest.fn(() => options.__subcommand || null),
        },
        // modal/text-input helpers
        fields: {
            getTextInputValue: jest.fn((name) => getOpt(name)),
        },
        _sentMessage: sentMessage,
    };

    return interaction;
}

module.exports = { mockInteraction, makeCollection };
