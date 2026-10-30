jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/discord", () => ({
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    fetchGuildMembersCached: jest.fn(async () => []),
}));

const { MessageFlags } = require("discord.js");
const { cardText } = require("../../helpers/cardText");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { logcheckAdminIds } = require("../../../src/config/variables");
const {
    resolveBotAccess, ruleFor, accessOwner, eventMemberRoles, denyMessage, guardInteraction,
    isFullAdminAnywhere, resetAdminCache, recordGuildOf,
} = require("../../../src/services/discord/botAccess");
const { mockInteraction, makeCollection } = require("../../helpers/mockInteraction");
const userAccess = require("../../../src/services/discord/members/userAccess");

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
    resetAdminCache();
    settingsStore.getConfig.mockReturnValue({ guildId: GUILD, botLanguage: "en", serverSettings: { [GUILD]: { botLanguage: "en" } } });
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
    it("are really exported by services/discord/discord.js (the mock above would hide a missing one)", () => {
        const real = jest.requireActual("../../../src/services/discord/discord");
        for (const name of ["getClient", "getGuild", "fetchGuildMembersCached", "listRoles"]) {
            expect({ name, type: typeof real[name] }).toEqual({ name, type: "function" });
        }
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
        expect(denyMessage({ mode: "roles", roleIds: [ORGA, RAIDLEAD] }, GUILD, "en")).toBe("You need @Orga or @Raidleiter for this.");
        expect(denyMessage({ mode: "roles", roleIds: [ORGA] }, GUILD, "en")).toBe("You need @Orga for this.");
        expect(denyMessage({ mode: "admins", roleIds: [] }, GUILD, "en")).toBe("This is reserved for admins.");
    });

    it("speaks German by default", () => {
        discord.getGuild.mockReturnValue({ roles: { cache: makeCollection([[ORGA, { name: "Orga" }], [RAIDLEAD, { name: "Raidleiter" }]]) } });
        expect(denyMessage({ mode: "roles", roleIds: [ORGA, RAIDLEAD] }, GUILD)).toBe("Dafür brauchst du @Orga oder @Raidleiter.");
        expect(denyMessage({ mode: "admins", roleIds: [] }, GUILD)).toBe("Das ist den Admins vorbehalten.");
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
        const sent = interaction.reply.mock.calls[0][0];
        expect(cardText(sent)).toContain("This is reserved for admins.");
        expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    });

    it("refuses in the server language German when the user chose none", async () => {
        settingsStore.getConfig.mockReturnValue({ guildId: GUILD });
        const interaction = mockInteraction({ userId: "555" });
        expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
        expect(cardText(interaction.reply.mock.calls[0][0])).toContain("Das ist den Admins vorbehalten.");
    });

    it("lets a member with a granted role run a button of that command", async () => {
        settingsStore.getConfig.mockReturnValue({ guildId: GUILD });
        const interaction = mockInteraction({ userId: "555", customId: "event-next", guild: { id: GUILD } });
        interaction.member = { roles: { cache: makeCollection([[ORGA, {}]]) } };
        expect(await guardInteraction(interaction, COMMANDS.get("event-next"), COMMANDS)).toBe(true);
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    describe("per server (#925)", () => {
        const OTHER = "900000000000000002";
        const servers = { servers: [{ guildId: OTHER }, { guildId: GUILD }], links: [] };

        it("reads the roles on the server of the click, not on the first server of the list", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, discordServers: servers });
            const interaction = mockInteraction({ userId: "555", customId: "event-next", guild: { id: GUILD } });
            interaction.guildId = GUILD;
            interaction.member = { roles: { cache: makeCollection([[ORGA, {}]]) } };
            expect(await guardInteraction(interaction, COMMANDS.get("event-next"), COMMANDS)).toBe(true);
            expect(discord.getGuild).not.toHaveBeenCalled();
        });

        it("judges by the rules of the server of the click: a role granted on B opens nothing on A", async () => {
            settingsStore.getConfig.mockReturnValue({
                guildId: GUILD,
                discordServers: servers,
                serverSettings: { [OTHER]: { botCommandAccess: { fillsetup: { mode: "roles", roleIds: [RAIDLEAD] } } } },
            });
            const onA = mockInteraction({ userId: "555", customId: "fillsetup", guild: { id: GUILD } });
            onA.guildId = GUILD;
            onA.member = { roles: { cache: makeCollection([[RAIDLEAD, {}]]) } };
            expect(await guardInteraction(onA, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
            const onB = mockInteraction({ userId: "555", customId: "fillsetup", guild: { id: OTHER } });
            onB.guildId = OTHER;
            onB.member = { roles: { cache: makeCollection([[RAIDLEAD, {}]]) } };
            expect(await guardInteraction(onB, COMMANDS.get("fillsetup"), COMMANDS)).toBe(true);
        });

        it("ignores rules stored on the top level (only serverSettings count)", async () => {
            settingsStore.getConfig.mockReturnValue({
                guildId: GUILD,
                botCommandAccess: { fillsetup: { mode: "everyone", roleIds: [] } },
            });
            const interaction = mockInteraction({ userId: "555", guild: { id: GUILD } });
            interaction.guildId = GUILD;
            expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
        });

        it("lets a full admin through on every server, also by an admin role held on another server", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, discordServers: servers, adminRoleIds: [ADMIN_ROLE] });
            const spy = jest.spyOn(userAccess, "resolveGuildAccess").mockResolvedValue({ isAdmin: true, guilds: {} });
            const interaction = mockInteraction({ userId: "555", guild: { id: OTHER } });
            interaction.guildId = OTHER;
            interaction.member = { roles: { cache: makeCollection([]) } };
            expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(true);
            expect(spy).toHaveBeenCalledWith("555");
            spy.mockResolvedValue({ isAdmin: false, guilds: {} });
            resetAdminCache();
            const again = mockInteraction({ userId: "555", guild: { id: OTHER } });
            again.guildId = OTHER;
            again.member = { roles: { cache: makeCollection([]) } };
            expect(await guardInteraction(again, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
            spy.mockRestore();
        });

        it("asks nobody about other servers when no admin role is configured", async () => {
            const spy = jest.spyOn(userAccess, "resolveGuildAccess");
            const interaction = mockInteraction({ userId: "555", guild: { id: GUILD } });
            interaction.guildId = GUILD;
            expect(await guardInteraction(interaction, COMMANDS.get("fillsetup"), COMMANDS)).toBe(false);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        const dm = (userId = "555") => {
            const interaction = mockInteraction({ userId, customId: "event-next" });
            interaction.guild = null;
            interaction.guildId = null;
            interaction.member = null;
            return interaction;
        };
        // the orga of OTHER (the first server of the list, formerly the "home server")
        const orgaOnOther = () => discord.getGuild.mockImplementation((id) => (id === OTHER ? {
            id: OTHER,
            members: { fetch: jest.fn(async () => ({ roles: { cache: makeCollection([[ORGA, {}]]) } })) },
        } : null));

        it("judges a DM without a record by no server: the orga of the first server is refused (fail closed)", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, discordServers: servers });
            orgaOnOther();
            const interaction = dm();
            expect(await guardInteraction(interaction, COMMANDS.get("event-next"), COMMANDS)).toBe(false);
            expect(discord.getGuild).not.toHaveBeenCalledWith(OTHER);
            expect(interaction.reply).toHaveBeenCalled();
            // an everyone command still runs in a DM
            expect(await guardInteraction(dm(), COMMANDS.get("signup"), COMMANDS)).toBe(true);
        });

        it("lets a full admin through in a DM without a record", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, discordServers: servers, adminRoleIds: [ADMIN_ROLE] });
            const spy = jest.spyOn(userAccess, "resolveGuildAccess").mockResolvedValue({ isAdmin: true, guilds: {} });
            expect(await guardInteraction(dm(), COMMANDS.get("fillsetup"), COMMANDS)).toBe(true);
            spy.mockRestore();
            // ADMIN_USER_ID / LOGCHECK_ADMIN_IDS need no role at all
            const envAdmin = logcheckAdminIds[0];
            if (envAdmin) expect(await guardInteraction(dm(envAdmin), COMMANDS.get("fillsetup"), COMMANDS)).toBe(true);
        });

        it("judges a DM by the server of its record when the command names it", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, discordServers: servers });
            orgaOnOther();
            const onOther = { ...COMMANDS.get("event-next"), guildIdOf: jest.fn(async () => OTHER) };
            expect(await guardInteraction(dm(), onOther, COMMANDS)).toBe(true);
            expect(discord.getGuild).toHaveBeenCalledWith(OTHER);
            // a record of GUILD: the orga role held on OTHER opens nothing there
            const onGuild = { ...COMMANDS.get("event-next"), guildIdOf: () => GUILD };
            expect(await guardInteraction(dm(), onGuild, COMMANDS)).toBe(false);
            // a failing lookup counts as no server
            const broken = { ...COMMANDS.get("event-next"), guildIdOf: () => { throw new Error("gone"); } };
            expect(await guardInteraction(dm(), broken, COMMANDS)).toBe(false);
        });

        it("asks the record hook in a DM only - a click on a server names its server itself", async () => {
            const hook = jest.fn(() => OTHER);
            expect(await recordGuildOf({ guildIdOf: hook }, { guildId: GUILD })).toBe("");
            expect(hook).not.toHaveBeenCalled();
            expect(await recordGuildOf({ guildIdOf: hook }, { guildId: null })).toBe(OTHER);
            expect(await recordGuildOf({}, { guildId: null })).toBe("");
        });
    });

    describe("full admin on another server: fast and cached (#925)", () => {
        beforeEach(() => settingsStore.getConfig.mockReturnValue({ guildId: GUILD, adminRoleIds: [ADMIN_ROLE] }));

        it("asks the role lookup once a minute per user", async () => {
            const spy = jest.spyOn(userAccess, "resolveGuildAccess").mockResolvedValue({ isAdmin: true, guilds: {} });
            expect(await isFullAdminAnywhere("555")).toBe(true);
            expect(await isFullAdminAnywhere("555")).toBe(true);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(await isFullAdminAnywhere("556")).toBe(true);
            expect(spy).toHaveBeenCalledTimes(2);
            spy.mockRestore();
        });

        it("counts a slow lookup as no (fail closed) and keeps its answer for the next click", async () => {
            let finish;
            const spy = jest.spyOn(userAccess, "resolveGuildAccess").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
            expect(await isFullAdminAnywhere("555", { timeoutMs: 5 })).toBe(false);
            finish({ isAdmin: true, guilds: {} });
            await new Promise((resolve) => setImmediate(resolve));
            expect(await isFullAdminAnywhere("555", { timeoutMs: 5 })).toBe(true);
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });

        it("counts a failing lookup as no", async () => {
            const spy = jest.spyOn(userAccess, "resolveGuildAccess").mockRejectedValue(new Error("down"));
            expect(await isFullAdminAnywhere("555")).toBe(false);
            spy.mockRestore();
        });
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
