jest.mock("../../../src/services/discord/discord", () => ({ listGuilds: jest.fn() }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({ guildId: "" })) }));

const discord = require("../../../src/services/discord/discord");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const { pickActiveGuild, mayEnterGuild, enterableGuilds } = require("../../../src/web/http/guildChoice");

const READ = { read: true, write: false };
const viewer = (guilds = {}) => ({ id: "7", guildAccess: { isAdmin: false, guilds } });
const fullAdmin = { id: "1", guildAccess: { isAdmin: true, guilds: {} } };

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({ guildId: "" });
    discord.listGuilds.mockReturnValue([]);
});

describe("web/http/guildChoice pickActiveGuild (#925)", () => {
    it("keeps an explicit selection", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(pickActiveGuild("g2")).toBe("g2");
    });

    it("takes the configured guild when the bot is a member", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(pickActiveGuild(null)).toBe("g1");
    });

    // A configured guild the bot is not in must not become the server whose
    // rights decide - that would be a server no one can manage.
    it("ignores a configured guild the bot is not in", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "gX" });
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(pickActiveGuild(null)).toBe("");
    });

    it("falls back to the only guild", () => {
        discord.listGuilds.mockReturnValue([{ id: "g1" }]);
        expect(pickActiveGuild(undefined)).toBe("g1");
    });

    it("returns an empty id when nothing can be chosen", () => {
        expect(pickActiveGuild("")).toBe("");
    });
});

describe("web/http/guildChoice mayEnterGuild (#1074)", () => {
    it("lets a member in, nobody else on that entry alone", () => {
        expect(mayEnterGuild(viewer({ g1: { isMember: true } }), "g1")).toBe(true);
        expect(mayEnterGuild(viewer({ g1: { isMember: true } }), "g2")).toBe(false);
    });

    it("lets an account with a grant of its own in, without a membership", () => {
        settingsStore.getConfig.mockReturnValue({ serverSettings: { g2: { userPermissions: { 7: { raids: READ } } } } });
        expect(mayEnterGuild(viewer(), "g2")).toBe(true);
    });

    it("does not count a grant of another account", () => {
        settingsStore.getConfig.mockReturnValue({ serverSettings: { g2: { userPermissions: { 8: { raids: READ } } } } });
        expect(mayEnterGuild(viewer(), "g2")).toBe(false);
    });

    // an entry can carry rights that come from the base access alone
    it("does not count the base access", () => {
        settingsStore.getConfig.mockReturnValue({ serverSettings: { g1: { baseAccess: { raids: READ } } } });
        expect(mayEnterGuild(viewer({ g1: { access: { raids: READ } } }), "g1")).toBe(false);
    });

    it("lets a full admin in everywhere", () => {
        expect(mayEnterGuild(fullAdmin, "anything")).toBe(true);
    });

    it("needs a person and a server", () => {
        expect(mayEnterGuild(null, "g1")).toBe(false);
        expect(mayEnterGuild(viewer({ g1: { isMember: true } }), "")).toBe(false);
    });

    it("asks only the session and the settings, so it can run on every request", () => {
        mayEnterGuild(viewer({ g1: { isMember: true } }), "g1");
        mayEnterGuild(viewer(), "g2");
        expect(discord.listGuilds).not.toHaveBeenCalled();
    });
});

describe("web/http/guildChoice enterableGuilds (#1074)", () => {
    beforeEach(() => {
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }, { id: "g3" }]);
    });

    it("keeps the bot's servers the person may enter", () => {
        expect(enterableGuilds(viewer({ g2: { isMember: true } }))).toEqual([{ id: "g2" }]);
    });

    it("gives a full admin all of them", () => {
        expect(enterableGuilds(fullAdmin).map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    });

    it("gives someone without a login nothing", () => {
        expect(enterableGuilds(null)).toEqual([]);
    });
});

describe("web/http/guildChoice pickActiveGuild with a person (#1074)", () => {
    const memberOfG2 = viewer({ g2: { isMember: true } });

    beforeEach(() => {
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }, { id: "g3" }]);
    });

    it("keeps a selection the person may enter", () => {
        expect(pickActiveGuild("g2", memberOfG2)).toBe("g2");
    });

    it("keeps it while the bot's list is empty: starting up takes nobody off their server", () => {
        discord.listGuilds.mockReturnValue([]);
        expect(pickActiveGuild("g2", memberOfG2)).toBe("g2");
    });

    it("falls back to an allowed server from a stale selection", () => {
        expect(pickActiveGuild("g3", memberOfG2)).toBe("g2");
    });

    it("prefers the configured server among the allowed ones", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g3" });
        expect(pickActiveGuild(null, viewer({ g2: { isMember: true }, g3: { isMember: true } }))).toBe("g3");
    });

    it("skips a configured server they may not enter", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(pickActiveGuild(null, memberOfG2)).toBe("g2");
    });

    // the bot's only server is no default for someone it is foreign to
    it("has no active server without an allowed one, however few servers the bot has", () => {
        expect(pickActiveGuild("g1", viewer())).toBe("");
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(pickActiveGuild(null, viewer())).toBe("");
        discord.listGuilds.mockReturnValue([{ id: "g1" }]);
        expect(pickActiveGuild(null, viewer())).toBe("");
    });

    it("leaves a full admin's choice as it was", () => {
        expect(pickActiveGuild("elsewhere", fullAdmin)).toBe("elsewhere");
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(pickActiveGuild(null, fullAdmin)).toBe("g1");
    });
});
