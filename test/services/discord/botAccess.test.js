jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/discord", () => ({
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    fetchGuildMembersCached: jest.fn(async () => []),
}));
jest.mock("../../../src/services/plans/serverPlan", () => ({ hasFeature: jest.fn(() => true) }));

const { MessageFlags, PermissionFlagsBits } = require("discord.js");
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
    it("lets only a full admin pass with fullAdminOnly, whatever the rule says", () => {
        const ctx = { commands: COMMANDS, config: {}, fullAdminOnly: true };
        expect(resolveBotAccess("signup", member(), ctx).allowed).toBe(false);
        expect(resolveBotAccess("event", member([ORGA]), ctx).allowed).toBe(false);
        expect(resolveBotAccess("signup", member([], logcheckAdminIds[0]), ctx).reason).toBe("admin");
    });

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

    describe("a command on data every server shares (#1073)", () => {
        const SHARED = new Map([
            ["open", { name: "open", group: "signup", defaultAccess: "everyone", sharedData: true }],
            ["forRole", { name: "forRole", group: "raids", defaultAccess: { roles: [ORGA] }, sharedData: true }],
            ["forRole-button", { name: "forRole-button", accessOf: "forRole" }],
            ["own", { name: "own", group: "signup", defaultAccess: "everyone" }],
            ["ownRole", { name: "ownRole", group: "raids", defaultAccess: { roles: [ORGA] } }],
        ]);
        const REFUSED = "This command reaches data every server shares, and this server is not cleared for that.";
        const withMark = (trusted) => settingsStore.getConfig.mockReturnValue({
            guildId: GUILD,
            botLanguage: "en",
            serverSettings: { [GUILD]: { botLanguage: "en" } },
            discordServers: { servers: [{ guildId: GUILD, label: "", trusted }], links: [] },
        });
        const onGuild = (id = "555") => {
            const interaction = mockInteraction({ userId: id });
            interaction.guildId = GUILD;
            interaction.guild = { id: GUILD };
            return interaction;
        };
        const holding = (roleIds) => {
            const interaction = onGuild();
            interaction.member = { roles: roleIds };
            return interaction;
        };

        describe("on a server without the mark", () => {
            beforeEach(() => withMark(false));

            it("refuses a rule of everyone, with a message only the user sees", async () => {
                const interaction = onGuild();
                expect(await guardInteraction(interaction, SHARED.get("open"), SHARED)).toBe(false);
                const sent = interaction.reply.mock.calls[0][0];
                expect(cardText(sent)).toContain(REFUSED);
                expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
            });

            it("refuses somebody holding the role of the rule", async () => {
                const interaction = holding([ORGA]);
                expect(await eventMemberRoles(interaction, GUILD)).toEqual([ORGA]);
                expect(await guardInteraction(interaction, SHARED.get("forRole"), SHARED)).toBe(false);
                expect(cardText(interaction.reply.mock.calls[0][0])).toContain(REFUSED);
            });

            it("judges a button by the command it belongs to", async () => {
                const interaction = holding([ORGA]);
                expect(await guardInteraction(interaction, SHARED.get("forRole-button"), SHARED)).toBe(false);
            });

            it("lets a full admin through", async () => {
                const interaction = onGuild(logcheckAdminIds[0]);
                expect(await guardInteraction(interaction, SHARED.get("open"), SHARED)).toBe(true);
            });

            it("leaves a command on the server's own data as it is", async () => {
                expect(await guardInteraction(onGuild(), SHARED.get("own"), SHARED)).toBe(true);
                expect(await guardInteraction(holding([ORGA]), SHARED.get("ownRole"), SHARED)).toBe(true);
            });

            it("closes /recruitment for a role the server gave itself the command with", async () => {
                const recruitment = require("../../../src/commands/apply/recruitment");
                const commands = new Map([["recruitment", recruitment]]);
                settingsStore.getConfig.mockReturnValue({
                    guildId: GUILD,
                    botLanguage: "en",
                    serverSettings: { [GUILD]: { botLanguage: "en", botCommandAccess: { recruitment: { mode: "roles", roleIds: [ORGA] } } } },
                    discordServers: { servers: [{ guildId: GUILD, label: "" }], links: [] },
                });
                expect(await guardInteraction(holding([ORGA]), recruitment, commands)).toBe(false);
            });
        });

        it("stays closed when the mark cannot be read", async () => {
            settingsStore.getConfig.mockReturnValue({ guildId: GUILD, botLanguage: "en", serverSettings: { [GUILD]: { botLanguage: "en" } } });
            expect(await guardInteraction(onGuild(), SHARED.get("open"), SHARED)).toBe(false);
        });

        it("stays closed without a server", async () => {
            withMark(true);
            const interaction = mockInteraction({ userId: "555" });
            interaction.guildId = null;
            interaction.guild = null;
            expect(await guardInteraction(interaction, SHARED.get("open"), SHARED)).toBe(false);
        });

        describe("on a marked server", () => {
            beforeEach(() => withMark(true));

            it("follows the rule of the server", async () => {
                expect(await guardInteraction(onGuild(), SHARED.get("open"), SHARED)).toBe(true);
                expect(await guardInteraction(holding([ORGA]), SHARED.get("forRole"), SHARED)).toBe(true);
                expect(await guardInteraction(holding([RAIDLEAD]), SHARED.get("forRole"), SHARED)).toBe(false);
            });

            it("opens /recruitment for a role the rule names", async () => {
                const recruitment = require("../../../src/commands/apply/recruitment");
                const commands = new Map([["recruitment", recruitment]]);
                settingsStore.getConfig.mockReturnValue({
                    guildId: GUILD,
                    botLanguage: "en",
                    serverSettings: { [GUILD]: { botLanguage: "en", botCommandAccess: { recruitment: { mode: "roles", roleIds: [ORGA] } } } },
                    discordServers: { servers: [{ guildId: GUILD, label: "", trusted: true }], links: [] },
                });
                expect(await guardInteraction(holding([ORGA]), recruitment, commands)).toBe(true);
            });
        });
    });

    describe("the rank Server-Admin (#1073)", () => {
        const OTHER = "900000000000000002";
        const OWNER = "777000000000000001";
        const RANKED = new Map([
            ["adminsOnly", { name: "adminsOnly", group: "raids", defaultAccess: "admins" }],
            ["forRole", { name: "forRole", group: "raids", defaultAccess: { roles: [ORGA] } }],
            ["forRole-button", { name: "forRole-button", accessOf: "forRole" }],
            ["shared", { name: "shared", group: "raids", defaultAccess: { roles: [ORGA] }, sharedData: true }],
            ["shared-button", { name: "shared-button", accessOf: "shared" }],
        ]);
        const SHARED_REFUSED = "This command reaches data every server shares, and this server is not cleared for that.";
        const admin = { has: (flag) => flag === PermissionFlagsBits.Administrator };
        const plain = { has: () => false };
        const listed = ({ trusted = false, list = [GUILD, OTHER] } = {}) => settingsStore.getConfig.mockReturnValue({
            guildId: GUILD,
            botLanguage: "en",
            serverSettings: { [GUILD]: { botLanguage: "en" } },
            discordServers: { servers: list.map((guildId) => ({ guildId, label: "", trusted })), links: [] },
        });
        const onServer = ({ guildId = GUILD, perms = admin, roles = [], userId = "555", ownerId = OWNER } = {}) => {
            const interaction = mockInteraction({ userId });
            interaction.guildId = guildId;
            interaction.guild = { id: guildId, ownerId };
            interaction.member = { roles };
            interaction.memberPermissions = perms;
            return interaction;
        };
        const dm = (userId = "555") => {
            const interaction = mockInteraction({ userId });
            interaction.guild = null;
            interaction.guildId = null;
            interaction.member = null;
            return interaction;
        };
        const recordOn = (guildId, name = "adminsOnly") => ({ ...RANKED.get(name), guildIdOf: () => guildId });
        const memberOn = (guildId, fetch) => discord.getGuild.mockImplementation((id) => (id === guildId
            ? { id: guildId, ownerId: OWNER, members: { fetch } }
            : null));

        describe("on its own listed server", () => {
            beforeEach(() => listed());

            it("passes a rule of admins only and a rule of roles it does not hold", async () => {
                expect(await guardInteraction(onServer(), RANKED.get("adminsOnly"), RANKED)).toBe(true);
                expect(await guardInteraction(onServer(), RANKED.get("forRole"), RANKED)).toBe(true);
                expect(await guardInteraction(onServer(), RANKED.get("forRole-button"), RANKED)).toBe(true);
            });

            it("counts the owner of the server as well", async () => {
                const interaction = onServer({ perms: plain, userId: OWNER });
                expect(await guardInteraction(interaction, RANKED.get("adminsOnly"), RANKED)).toBe(true);
            });

            it("gives a member without the Administrator right nothing", async () => {
                const interaction = onServer({ perms: plain });
                expect(await guardInteraction(interaction, RANKED.get("adminsOnly"), RANKED)).toBe(false);
                expect(cardText(interaction.reply.mock.calls[0][0])).toContain("This is reserved for admins.");
                expect(await guardInteraction(onServer({ perms: null }), RANKED.get("adminsOnly"), RANKED)).toBe(false);
                const broken = { has: () => { throw new Error("odd"); } };
                expect(await guardInteraction(onServer({ perms: broken }), RANKED.get("adminsOnly"), RANKED)).toBe(false);
            });

            it("is no full admin: a command on shared data stays closed", async () => {
                const interaction = onServer();
                expect(await guardInteraction(interaction, RANKED.get("shared"), RANKED)).toBe(false);
                expect(cardText(interaction.reply.mock.calls[0][0])).toContain(SHARED_REFUSED);
                expect(await guardInteraction(onServer(), RANKED.get("shared-button"), RANKED)).toBe(false);
                expect(await guardInteraction(onServer({ perms: plain, userId: OWNER }), RANKED.get("shared"), RANKED)).toBe(false);
            });

            it("asks the interaction only, never Discord", async () => {
                const spy = jest.spyOn(userAccess, "resolveGuildAccess");
                expect(await guardInteraction(onServer(), RANKED.get("adminsOnly"), RANKED)).toBe(true);
                expect(discord.getGuild).not.toHaveBeenCalled();
                expect(spy).not.toHaveBeenCalled();
                spy.mockRestore();
            });
        });

        it("keeps a command on shared data closed on a marked server too, unless a role of the rule is held", async () => {
            listed({ trusted: true });
            expect(await guardInteraction(onServer(), RANKED.get("shared"), RANKED)).toBe(false);
            expect(await guardInteraction(onServer({ perms: plain, userId: OWNER }), RANKED.get("shared"), RANKED)).toBe(false);
            // role users there: as before
            expect(await guardInteraction(onServer({ perms: plain, roles: [ORGA] }), RANKED.get("shared"), RANKED)).toBe(true);
            expect(await guardInteraction(onServer({ perms: plain, roles: [RAIDLEAD] }), RANKED.get("shared"), RANKED)).toBe(false);
            // and the rank holding the role passes by the role, not by the rank
            expect(await guardInteraction(onServer({ roles: [ORGA] }), RANKED.get("shared"), RANKED)).toBe(true);
        });

        it("lets the full admin through on shared data as before", async () => {
            listed();
            const envAdmin = logcheckAdminIds[0];
            if (envAdmin) {
                expect(await guardInteraction(onServer({ perms: plain, userId: envAdmin }), RANKED.get("shared"), RANKED)).toBe(true);
                expect(await guardInteraction(dm(envAdmin), RANKED.get("adminsOnly"), RANKED)).toBe(true);
            }
        });

        it("gives nothing on a server outside the list (home guild, overview target)", async () => {
            listed({ list: [OTHER] });
            expect(await guardInteraction(onServer({ guildId: GUILD }), RANKED.get("adminsOnly"), RANKED)).toBe(false);
            expect(await guardInteraction(onServer({ guildId: GUILD, perms: plain, userId: OWNER }), RANKED.get("adminsOnly"), RANKED)).toBe(false);
        });

        it("counts only for the server of the interaction, never for another one", async () => {
            listed();
            const { isServerAdminOf } = require("../../../src/services/discord/botAccess");
            const stored = settingsStore.getConfig();
            // admin on GUILD, asked about OTHER: no
            expect(await isServerAdminOf(onServer({ guildId: GUILD }), OTHER, stored)).toBe(false);
            expect(await isServerAdminOf(onServer({ guildId: GUILD }), GUILD, stored)).toBe(true);
            expect(await isServerAdminOf(onServer(), "", stored)).toBe(false);
            expect(await isServerAdminOf(null, GUILD, stored)).toBe(false);
            expect(await isServerAdminOf(onServer({ userId: "" }), GUILD, stored)).toBe(false);
        });

        it("serverAdminPasses: the same answer for a gate by rule name, never for a rule on shared data", async () => {
            listed();
            const { serverAdminPasses } = require("../../../src/services/discord/botAccess");
            const stored = settingsStore.getConfig();
            expect(await serverAdminPasses("forRole-button", onServer(), GUILD, { commands: RANKED, stored })).toBe(true);
            expect(await serverAdminPasses("adminsOnly", onServer(), GUILD, { commands: RANKED })).toBe(true);
            expect(await serverAdminPasses("shared-button", onServer(), GUILD, { commands: RANKED, stored })).toBe(false);
            expect(await serverAdminPasses("forRole", onServer({ perms: plain }), GUILD, { commands: RANKED, stored })).toBe(false);
            expect(await serverAdminPasses("forRole", onServer(), OTHER, { commands: RANKED, stored })).toBe(false);
            const broken = { get user() { throw new Error("odd"); }, guildId: GUILD };
            expect(await serverAdminPasses("forRole", broken, GUILD, { commands: RANKED, stored })).toBe(false);
            // an unreadable server list gives no rank (fail closed)
            const unreadable = { get discordServers() { throw new Error("broken store"); } };
            expect(await serverAdminPasses("forRole", onServer(), GUILD, { commands: RANKED, stored: unreadable })).toBe(false);
        });

        it("gives no rank in the router when the server list is unreadable (fail closed)", async () => {
            const base = { guildId: GUILD, botLanguage: "en", serverSettings: { [GUILD]: { botLanguage: "en" } } };
            // a list that is no list, and an entry that cannot be read: no listed server, no rank
            const broken = { get guildId() { throw new Error("broken entry"); } };
            for (const servers of ["garbage", null, [broken]]) {
                settingsStore.getConfig.mockReturnValue({ ...base, discordServers: { servers, links: [] } });
                expect(await guardInteraction(onServer(), RANKED.get("adminsOnly"), RANKED)).toBe(false);
                expect(await guardInteraction(onServer({ perms: plain, userId: OWNER }), RANKED.get("forRole-button"), RANKED)).toBe(false);
            }
        });

        describe("on the real command registry", () => {
            const { loadCommandModules } = require("../../../src/commands/loader");
            const modules = loadCommandModules();
            beforeEach(() => listed());

            it("refuses /fillsetup (the one global setup sheet) and opens /kanal", async () => {
                const refused = onServer();
                expect(await guardInteraction(refused, modules.get("fillsetup"), modules)).toBe(false);
                expect(cardText(refused.reply.mock.calls[0][0])).toContain(SHARED_REFUSED);
                expect(await guardInteraction(onServer(), modules.get("kanal"), modules)).toBe(true);
            });

            it("refuses a component that follows a command on shared data (accessOf)", async () => {
                const withButton = new Map(modules);
                for (const owner of ["fillsetup", "recruitment"]) {
                    const button = { name: `${owner}-probe`, accessOf: owner };
                    withButton.set(button.name, button);
                    expect(await guardInteraction(onServer(), button, withButton)).toBe(false);
                }
                // and one that follows an own-server admins command passes
                const eventButton = { name: "event-probe", accessOf: "event" };
                withButton.set(eventButton.name, eventButton);
                expect(await guardInteraction(onServer(), eventButton, withButton)).toBe(true);
            });
        });

        describe("in a DM", () => {
            beforeEach(() => listed());

            it("never counts without a record", async () => {
                memberOn(GUILD, jest.fn(async () => ({ permissions: admin })));
                const interaction = dm();
                expect(await guardInteraction(interaction, RANKED.get("adminsOnly"), RANKED)).toBe(false);
                expect(discord.getGuild).not.toHaveBeenCalled();
                expect(interaction.reply).toHaveBeenCalled();
            });

            it("counts for the record's server when Discord confirms the rank there", async () => {
                const fetch = jest.fn(async () => ({ permissions: admin }));
                memberOn(GUILD, fetch);
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(true);
                expect(fetch).toHaveBeenCalledWith("555");
                // the owner of the record's server, by the guild's ownerId
                const ownerFetch = jest.fn(async () => ({ permissions: plain }));
                memberOn(GUILD, ownerFetch);
                expect(await guardInteraction(dm(OWNER), recordOn(GUILD), RANKED)).toBe(true);
            });

            it("stays closed for a command on shared data", async () => {
                memberOn(GUILD, jest.fn(async () => ({ permissions: admin })));
                expect(await guardInteraction(dm(), recordOn(GUILD, "shared"), RANKED)).toBe(false);
            });

            it("stays closed when the rank is on another server than the record's", async () => {
                memberOn(OTHER, jest.fn(async () => ({ permissions: admin })));
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
            });

            it("stays closed when Discord does not confirm it (fail closed)", async () => {
                memberOn(GUILD, jest.fn(async () => ({ permissions: plain })));
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
                memberOn(GUILD, jest.fn(async () => { throw new Error("Unknown Member"); }));
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
                memberOn(GUILD, jest.fn(async () => ({})));
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
                discord.getGuild.mockReturnValue({ id: GUILD });
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
            });

            it("gives up after a short wait, so the refusal still reaches Discord in time", async () => {
                jest.useFakeTimers();
                try {
                    // the role lookup answers (no roles), the rank lookup never does
                    memberOn(GUILD, jest.fn()
                        .mockResolvedValueOnce({ roles: { cache: makeCollection([]) } })
                        .mockImplementation(() => new Promise(() => {})));
                    const pending = guardInteraction(dm(), recordOn(GUILD), RANKED);
                    await jest.advanceTimersByTimeAsync(1600);
                    expect(await pending).toBe(false);
                } finally {
                    jest.useRealTimers();
                }
            });

            it("never counts for a record on a server outside the list", async () => {
                listed({ list: [OTHER] });
                memberOn(GUILD, jest.fn(async () => ({ permissions: admin })));
                expect(await guardInteraction(dm(), recordOn(GUILD), RANKED)).toBe(false);
            });
        });
    });

    describe("a command behind a plan feature (#1080)", () => {
        const { hasFeature } = require("../../../src/services/plans/serverPlan");
        const PLANNED = new Map([
            ["planned", { name: "planned", group: "signup", defaultAccess: "everyone", feature: "test" }],
            ["planned-button", { name: "planned-button", accessOf: "planned" }],
        ]);

        it("refuses it when the server's plan lacks the feature, with a message only the user sees", async () => {
            hasFeature.mockReturnValueOnce(false);
            const interaction = mockInteraction({ userId: "555" });
            expect(await guardInteraction(interaction, PLANNED.get("planned"), PLANNED)).toBe(false);
            expect(hasFeature).toHaveBeenCalledWith(expect.anything(), "test");
            const sent = interaction.reply.mock.calls[0][0];
            expect(cardText(sent)).toContain("This feature is not part of this server's plan.");
            expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        });

        it("refuses a full admin too", async () => {
            hasFeature.mockReturnValueOnce(false);
            const interaction = mockInteraction({ userId: logcheckAdminIds[0] });
            expect(await guardInteraction(interaction, PLANNED.get("planned"), PLANNED)).toBe(false);
        });

        it("judges a button by the command it belongs to", async () => {
            hasFeature.mockReturnValueOnce(false);
            const interaction = mockInteraction({ userId: "555" });
            expect(await guardInteraction(interaction, PLANNED.get("planned-button"), PLANNED)).toBe(false);
            expect(hasFeature).toHaveBeenCalledWith(expect.anything(), "test");
        });

        it("lets it through when the plan has the feature", async () => {
            const interaction = mockInteraction({ userId: "555" });
            expect(await guardInteraction(interaction, PLANNED.get("planned"), PLANNED)).toBe(true);
            expect(interaction.reply).not.toHaveBeenCalled();
        });

        it("does not ask for a command without a feature", async () => {
            await guardInteraction(mockInteraction(), COMMANDS.get("signup"), COMMANDS);
            expect(hasFeature).not.toHaveBeenCalled();
        });
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
