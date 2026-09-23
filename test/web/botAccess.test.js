jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/discord", () => ({
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    fetchGuildMembersCached: jest.fn(async () => []),
}));

const { MessageFlags } = require("discord.js");
const settingsStore = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const { logcheckAdminIds } = require("../../src/config/variables");
const {
    resolveBotAccess, ruleFor, accessOwner, eventGuildId, eventMemberRoles, denyMessage, guardInteraction,
} = require("../../src/web/botAccess");
const { mockInteraction, makeCollection } = require("../helpers/mockInteraction");

const GUILD = "900000000000000001";
const ORGA = "123456789012345678";
const RAIDLEAD = "223456789012345678";
const ADMIN_ROLE = "323456789012345678";

const COMMANDS = new Map([
    ["fillsetup", { name: "fillsetup", group: "raids", defaultAccess: "admins" }],
    ["signup", { name: "signup", group: "signup", defaultAccess: "everyone" }],
    ["event", { name: "event", group: "raids", defaultAccess: { roles: [ORGA] } }],
    ["event-next", { name: "event-next", accessOf: "event" }],
    ["legacy", { name: "legacy" }],
    ["loop-a", { name: "loop-a", accessOf: "loop-b" }],
    ["loop-b", { name: "loop-b", accessOf: "loop-a" }],
]);

const member = (roleIds = [], id = "555") => ({ id, roleIds });

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({ guildId: GUILD });
    discord.getGuild.mockReturnValue(null);
    discord.fetchGuildMembersCached.mockResolvedValue([]);
});

describe("resolveBotAccess", () => {
    it("always lets an admin through, by user id or by admin role", () => {
        const config = { adminRoleIds: [ADMIN_ROLE] };
        expect(resolveBotAccess("fillsetup", member([], logcheckAdminIds[0]), { commands: COMMANDS, config }))
            .toMatchObject({ allowed: true, reason: "admin" });
        expect(resolveBotAccess("fillsetup", member([ADMIN_ROLE]), { commands: COMMANDS, config }))
            .toMatchObject({ allowed: true, reason: "admin" });
        // even a command nobody declared anything for
        expect(resolveBotAccess("unknown", member([ADMIN_ROLE]), { commands: COMMANDS, config }).allowed).toBe(true);
    });

    it("lets everyone run an everyone command", () => {
        expect(resolveBotAccess("signup", member(), { commands: COMMANDS })).toMatchObject({ allowed: true, reason: "everyone" });
        expect(resolveBotAccess("signup", null, { commands: COMMANDS }).allowed).toBe(true);
    });

    it("allows a member with one of the roles and refuses one without", () => {
        const config = { botCommandAccess: { fillsetup: { mode: "roles", roleIds: [ORGA, RAIDLEAD] } } };
        expect(resolveBotAccess("fillsetup", member([RAIDLEAD]), { commands: COMMANDS, config }))
            .toMatchObject({ allowed: true, reason: "role" });
        expect(resolveBotAccess("fillsetup", member(["999999999999999999"]), { commands: COMMANDS, config }))
            .toMatchObject({ allowed: false, reason: "denied" });
    });

    it("falls back to the command's defaultAccess when nothing is stored", () => {
        expect(resolveBotAccess("fillsetup", member([ORGA]), { commands: COMMANDS }).allowed).toBe(false);
        expect(resolveBotAccess("event", member([ORGA]), { commands: COMMANDS }))
            .toMatchObject({ allowed: true, rule: { source: "default", mode: "roles" } });
    });

    it("lets the stored setting win over the default, in both directions", () => {
        const config = { botCommandAccess: { signup: { mode: "admins" }, fillsetup: { mode: "everyone" } } };
        expect(resolveBotAccess("signup", member(), { commands: COMMANDS, config }).allowed).toBe(false);
        expect(resolveBotAccess("fillsetup", member(), { commands: COMMANDS, config }))
            .toMatchObject({ allowed: true, rule: { source: "setting" } });
    });

    it("is fail-closed: no setting and no default means admins only", () => {
        expect(resolveBotAccess("legacy", member([ORGA]), { commands: COMMANDS }))
            .toMatchObject({ allowed: false, rule: { mode: "admins", source: "fallback" } });
        expect(resolveBotAccess("does-not-exist", member(), { commands: COMMANDS }).allowed).toBe(false);
        expect(resolveBotAccess("loop-a", member(), { commands: COMMANDS }).allowed).toBe(false);
    });

    it("judges a button by the command it belongs to", () => {
        expect(accessOwner("event-next", COMMANDS).name).toBe("event");
        expect(resolveBotAccess("event-next", member([ORGA]), { commands: COMMANDS }).allowed).toBe(true);
        expect(resolveBotAccess("event-next", member([RAIDLEAD]), { commands: COMMANDS }).allowed).toBe(false);
        // a setting on the command reaches the button too
        const config = { botCommandAccess: { event: { mode: "roles", roleIds: [RAIDLEAD] } } };
        expect(resolveBotAccess("event-next", member([RAIDLEAD]), { commands: COMMANDS, config }).allowed).toBe(true);
        // and a stored rule under the button's own name is ignored
        const own = { botCommandAccess: { "event-next": { mode: "everyone" } } };
        expect(ruleFor("event-next", { commands: COMMANDS, config: own }).mode).toBe("roles");
    });

    it("accepts commands as an array or a plain object", () => {
        const list = [...COMMANDS.values()];
        expect(resolveBotAccess("signup", member(), { commands: list }).allowed).toBe(true);
        expect(resolveBotAccess("signup", member(), { commands: Object.fromEntries(COMMANDS) }).allowed).toBe(true);
    });
});

describe("the discord helpers used here", () => {
    it("are really exported by web/discord.js (the mock above would hide a missing one)", () => {
        const real = jest.requireActual("../../src/web/discord");
        for (const name of ["getClient", "getGuild", "fetchGuildMembersCached", "listRoles"]) {
            expect({ name, type: typeof real[name] }).toEqual({ name, type: "function" });
        }
    });
});

describe("eventGuildId", () => {
    it("is the first configured event server, then the configured guild", () => {
        expect(eventGuildId({ discordServers: { eventGuilds: [{ guildId: "1" }] }, guildId: "2" })).toBe("1");
        expect(eventGuildId({ guildId: "2" })).toBe("2");
    });
});

describe("eventMemberRoles", () => {
    it("uses the interaction's member when it happened on the event guild", async () => {
        const interaction = mockInteraction({ guild: { id: GUILD } });
        interaction.member = { roles: { cache: makeCollection([[ORGA, {}]]) } };
        expect(await eventMemberRoles(interaction, GUILD)).toEqual([ORGA]);
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("looks the user up on the event guild when the interaction came from elsewhere", async () => {
        const guild = { members: { fetch: jest.fn() } };
        discord.getGuild.mockReturnValue(guild);
        discord.fetchGuildMembersCached.mockResolvedValue([
            { id: "555", roles: { cache: makeCollection([[RAIDLEAD, {}]]) } },
        ]);
        const interaction = mockInteraction({ userId: "555", guild: { id: "other" } });
        expect(await eventMemberRoles(interaction, GUILD)).toEqual([RAIDLEAD]);
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith(GUILD, guild);
    });

    it("falls back to a single fetch and to no roles, never throwing", async () => {
        const guild = { members: { fetch: jest.fn().mockResolvedValue({ roles: { cache: makeCollection([[ORGA, {}]]) } }) } };
        discord.getGuild.mockReturnValue(guild);
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("no intent"));
        expect(await eventMemberRoles(mockInteraction({ userId: "555" }), GUILD)).toEqual([ORGA]);

        guild.members.fetch.mockRejectedValue(new Error("unknown member"));
        expect(await eventMemberRoles(mockInteraction({ userId: "555" }), GUILD)).toEqual([]);

        discord.getGuild.mockReturnValue(null);
        expect(await eventMemberRoles(mockInteraction(), GUILD)).toEqual([]);
        expect(await eventMemberRoles(mockInteraction(), "")).toEqual([]);
    });
});

describe("denyMessage", () => {
    it("names the roles of the event guild", () => {
        discord.getGuild.mockReturnValue({ roles: { cache: makeCollection([[ORGA, { name: "Orga" }], [RAIDLEAD, { name: "Raidleiter" }]]) } });
        expect(denyMessage({ mode: "roles", roleIds: [ORGA, RAIDLEAD] }, GUILD)).toBe("You need @Orga or @Raidleiter for this.");
        expect(denyMessage({ mode: "roles", roleIds: [ORGA] }, GUILD)).toBe("You need @Orga for this.");
        expect(denyMessage({ mode: "admins", roleIds: [] }, GUILD)).toBe("This is reserved for admins.");
    });
});

describe("guardInteraction", () => {
    it("lets an everyone command through without asking Discord", async () => {
        const interaction = mockInteraction();
        expect(await guardInteraction(interaction, COMMANDS.get("signup"), COMMANDS)).toBe(true);
        expect(discord.getGuild).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("refuses with a message only the user sees", async () => {
        const interaction = mockInteraction({ userId: "555" });
        expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "This is reserved for admins.", flags: MessageFlags.Ephemeral });
    });

    it("lets a member with a granted role run a button of that command", async () => {
        settingsStore.getConfig.mockReturnValue({ guildId: GUILD });
        const interaction = mockInteraction({ userId: "555", customId: "event-next", guild: { id: GUILD } });
        interaction.member = { roles: { cache: makeCollection([[ORGA, {}]]) } };
        expect(await guardInteraction(interaction, COMMANDS.get("event-next"), COMMANDS)).toBe(true);
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("answers a refused autocomplete with no choices instead of a reply", async () => {
        const interaction = mockInteraction({ userId: "555" });
        interaction.isAutocomplete = () => true;
        interaction.respond = jest.fn().mockResolvedValue(undefined);
        expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
        expect(interaction.respond).toHaveBeenCalledWith([]);
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("does not reply twice to an interaction that was already answered", async () => {
        const interaction = mockInteraction({ userId: "555" });
        interaction.replied = true;
        expect(await guardInteraction(interaction, COMMANDS.get("legacy"), COMMANDS)).toBe(false);
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});
