jest.mock("../../src/web/apiMiddleware", () => ({ requireFullAdmin: jest.fn() }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/discord", () => ({
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    listRoles: jest.fn(() => []),
    fetchGuildMembersCached: jest.fn(async () => []),
}));

const { requireFullAdmin } = require("../../src/web/apiMiddleware");
const settingsStore = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const { getBotCommands, buildBotCommandList, loadedCommands } = require("../../src/web/apiRoutes/botCommands");
const { makeCollection } = require("../helpers/mockInteraction");

const ORGA = "123456789012345678";
const mockRes = () => ({ writeHead: jest.fn(), end: jest.fn() });
const body = (res) => JSON.parse(res.end.mock.calls[0][0]);

beforeEach(() => {
    jest.clearAllMocks();
    requireFullAdmin.mockReturnValue({ id: "1", isAdmin: true });
    settingsStore.getConfig.mockReturnValue({ guildId: "900000000000000001" });
});

describe("buildBotCommandList", () => {
    const commands = [
        { name: "event", description: "Event anlegen", group: "raids", defaultAccess: { roles: [ORGA] } },
        { name: "event-next", accessOf: "event" },
        { name: "apply", description: "Button", group: "recruitment", defaultAccess: "everyone", kind: "button" },
        { name: "old" },
    ];

    it("lists the commands with their default, the stored rule and what inherits it", () => {
        const list = buildBotCommandList(commands, { botCommandAccess: { apply: { mode: "admins" } } });
        expect(list.map((c) => c.name)).toEqual(["apply", "event"]);
        expect(list[1]).toEqual({
            name: "event",
            description: "Event anlegen",
            group: "raids",
            kind: "slash",
            defaultAccess: { mode: "roles", roleIds: [ORGA] },
            access: null,
            effective: { mode: "roles", roleIds: [ORGA] },
            inherits: ["event-next"],
        });
        expect(list[0]).toMatchObject({ kind: "button", access: { mode: "admins", roleIds: [] }, effective: { mode: "admins" } });
    });
});

describe("GET /api/bot-commands", () => {
    it("is for full admins only", async () => {
        requireFullAdmin.mockReturnValue(null);
        const res = mockRes();
        await getBotCommands({}, res);
        expect(res.end).not.toHaveBeenCalled();
    });

    it("reads the real command files when the bot has not loaded any", () => {
        const all = loadedCommands();
        expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(["signup", "fillsetup", "logcheck-eval"]));
    });

    it("scans the command folder once, not on every request (#419)", () => {
        const fs = require("fs");
        loadedCommands();
        const readdir = jest.spyOn(fs, "readdirSync");
        try {
            const again = loadedCommands();
            expect(readdir).not.toHaveBeenCalled();
            expect(again.map((c) => c.name)).toEqual(expect.arrayContaining(["signup"]));
            // a copy each time: a caller sorting its list cannot reorder the next one's
            expect(loadedCommands()).not.toBe(again);
        } finally {
            readdir.mockRestore();
        }
    });

    it("answers with the used groups, the commands and the event guild's roles with member counts", async () => {
        discord.getClient.mockReturnValue({ commands: new Map([
            ["signup", { name: "signup", description: "Anmelden", group: "signup", defaultAccess: "everyone" }],
        ]) });
        discord.listRoles.mockReturnValue([{ id: ORGA, name: "Orga", color: "" }]);
        const guild = { name: "Pulse Events" };
        discord.getGuild.mockReturnValue(guild);
        discord.fetchGuildMembersCached.mockResolvedValue([
            { roles: { cache: makeCollection([[ORGA, {}]]) } },
            { roles: { cache: makeCollection([[ORGA, {}]]) } },
            { roles: { cache: makeCollection() } },
        ]);
        const res = mockRes();
        await getBotCommands({}, res);
        const data = body(res).data;
        expect(discord.listRoles).toHaveBeenCalledWith("900000000000000001");
        expect(data.groups.map((g) => g.id)).toEqual(["signup"]);
        expect(data.commands).toHaveLength(1);
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith("900000000000000001", guild);
        expect(data.roles).toEqual([{ id: ORGA, name: "Orga", color: "", memberCount: 2 }]);
        expect(data.guildName).toBe("Pulse Events");
    });

    it("reports an unknown member count as null when the member list cannot be fetched", async () => {
        discord.listRoles.mockReturnValue([{ id: ORGA, name: "Orga", color: "" }]);
        discord.getGuild.mockReturnValue({ name: "Pulse Events" });
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("no intent"));
        const res = mockRes();
        await getBotCommands({}, res);
        expect(body(res).data.roles[0].memberCount).toBeNull();
    });
});
