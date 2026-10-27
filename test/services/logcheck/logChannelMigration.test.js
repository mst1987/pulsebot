jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const configStore = require("../../../src/stores/configStore");
const { migrateLogChannels, runLogChannelMigration, lookupWithClient } = require("../../../src/services/logcheck/logChannelMigration");

const FILE = settingsPath("config.json");
const A = "111111111111111111";
const B = "222222222222222222";
const STRANGER = "999999999999999999";
const CAT_FOREVER = "333333333333333333";

const writeFile = (value) => fs.__store.set(FILE, JSON.stringify(value));
const readFile = () => JSON.parse(fs.__store.get(FILE));

function base(extra = {}) {
    return {
        discordServers: { servers: [{ guildId: A, label: "A" }, { guildId: B, label: "B" }] },
        mainVersion: "tbc",
        categoryVersion: { [CAT_FOREVER]: "forever" },
        ...extra,
    };
}

// channel id -> where it lies (null: the bot no longer sees it)
const lookupFrom = (map) => jest.fn(async (id) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null));

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

describe("services/logcheck/logChannelMigration migrateLogChannels (#921)", () => {
    it("hands every channel to the server it lies on, with its category's version", async () => {
        writeFile(base({ logChannelIds: ["c1", "c2", "c3"] }));
        const lines = await migrateLogChannels({ lookup: lookupFrom({
            c1: { guildId: A, parentId: CAT_FOREVER },
            c2: { guildId: B, parentId: "" },
            c3: { guildId: A, parentId: "unknowncat" },
        }) });

        const stored = readFile();
        expect(stored.logChannelIds).toBeUndefined();
        expect(stored.serverSettings[A].logChannels).toEqual([
            { channelId: "c1", versionId: "forever" },
            { channelId: "c3", versionId: "tbc" },
        ]);
        expect(stored.serverSettings[B].logChannels).toEqual([{ channelId: "c2", versionId: "tbc" }]);
        expect(lines[0]).toContain("3 Log-Kanal");
        expect(lines[0]).toContain(`${A}: 2`);
        expect(lines[0]).toContain(`${B}: 1`);
    });

    it("gives a channel the bot no longer sees to the first server", async () => {
        writeFile(base({ logChannelIds: ["gone"] }));
        const lines = await migrateLogChannels({ lookup: lookupFrom({}) });

        expect(readFile().serverSettings[A].logChannels).toEqual([{ channelId: "gone", versionId: "tbc" }]);
        expect(readFile().serverSettings[B]).toBeUndefined();
        expect(lines.some((l) => l.includes("gone") && l.includes("nicht mehr sichtbar"))).toBe(true);
    });

    it("gives a channel on a server without settings to the first server, with a warning", async () => {
        writeFile(base({ logChannelIds: ["far"] }));
        const lines = await migrateLogChannels({ lookup: lookupFrom({ far: { guildId: STRANGER, parentId: "" } }) });

        expect(readFile().serverSettings[A].logChannels).toEqual([{ channelId: "far", versionId: "tbc" }]);
        expect(readFile().serverSettings[STRANGER]).toBeUndefined();
        expect(lines.some((l) => l.includes("WARNUNG") && l.includes(STRANGER))).toBe(true);
    });

    it("keeps a server's list first and adds no channel twice", async () => {
        writeFile(base({
            logChannelIds: ["c1", "c2", "c2"],
            serverSettings: { [A]: { logChannels: [{ channelId: "c1", versionId: "classic" }] } },
        }));
        await migrateLogChannels({ lookup: lookupFrom({ c1: { guildId: A }, c2: { guildId: A } }) });
        expect(readFile().serverSettings[A].logChannels).toEqual([
            { channelId: "c1", versionId: "classic" },
            { channelId: "c2", versionId: "tbc" },
        ]);
    });

    it("drops an empty global list without writing any server list", async () => {
        writeFile(base({ logChannelIds: [] }));
        const lines = await migrateLogChannels({ lookup: lookupFrom({}) });
        expect(readFile().logChannelIds).toBeUndefined();
        expect(readFile().serverSettings).toEqual({});
        expect(lines[0]).toContain("0 Log-Kanal");
    });

    it("is idempotent: without logChannelIds nothing happens", async () => {
        writeFile(base());
        const lookup = lookupFrom({});
        expect(await migrateLogChannels({ lookup })).toEqual([]);
        expect(lookup).not.toHaveBeenCalled();
        expect(readFile().serverSettings).toBeUndefined();
    });

    it("writes nothing when a lookup fails for another reason", async () => {
        writeFile(base({ logChannelIds: ["c1", "c2"] }));
        const lookup = jest.fn(async (id) => {
            if (id === "c2") throw new Error("rate limited");
            return { guildId: A };
        });
        const lines = await migrateLogChannels({ lookup });
        expect(readFile().logChannelIds).toEqual(["c1", "c2"]);
        expect(readFile().serverSettings).toBeUndefined();
        expect(lines[0]).toContain("fehlgeschlagen");
    });

    it("writes nothing without any server", async () => {
        writeFile({ logChannelIds: ["c1"] });
        const lookup = lookupFrom({});
        // the env's home guild would count as the first server
        const spy = jest.spyOn(configStore, "getConfig").mockReturnValue({ guildId: "", discordServers: { servers: [] } });
        const lines = await migrateLogChannels({ lookup });
        spy.mockRestore();
        expect(readFile()).toEqual({ logChannelIds: ["c1"] });
        expect(lookup).not.toHaveBeenCalled();
        expect(lines[0]).toContain("WARNUNG");
    });

    it("writes the old file back when a channel does not arrive", async () => {
        writeFile(base({ logChannelIds: ["c1"] }));
        const realGet = configStore.getConfig;
        const spy = jest.spyOn(configStore, "getConfig")
            .mockImplementationOnce(() => realGet())            // the run's own read
            .mockImplementationOnce(() => ({ serverSettings: {} })); // the read back
        const lines = await migrateLogChannels({ lookup: lookupFrom({ c1: { guildId: A } }) });
        spy.mockRestore();

        expect(readFile().logChannelIds).toEqual(["c1"]);
        expect(readFile().serverSettings).toBeUndefined();
        expect(lines[0]).toContain("kam nicht an");
    });

    // #921 review: the web server runs while the lookups wait
    it("keeps what is saved while a lookup waits", async () => {
        writeFile(base({ logChannelIds: ["c1"], officerRoleId: "old" }));
        const lookup = jest.fn(async () => {
            writeFile({ ...readFile(), officerRoleId: "new", serverSettings: { [B]: { logChannels: [{ channelId: "b1", versionId: "" }] } } });
            return { guildId: A };
        });
        await migrateLogChannels({ lookup });

        const stored = readFile();
        expect(stored.officerRoleId).toBe("new");
        expect(stored.serverSettings[B].logChannels).toEqual([{ channelId: "b1", versionId: "" }]);
        expect(stored.serverSettings[A].logChannels).toEqual([{ channelId: "c1", versionId: "tbc" }]);
        expect(stored.logChannelIds).toBeUndefined();
    });

    it("does nothing when another run moved the list while a lookup waited", async () => {
        writeFile(base({ logChannelIds: ["c1"] }));
        const lookup = jest.fn(async () => {
            const rest = { ...readFile() };
            delete rest.logChannelIds;
            writeFile({ ...rest, serverSettings: { [A]: { logChannels: [{ channelId: "c1", versionId: "classic" }] } } });
            return { guildId: A };
        });
        expect(await migrateLogChannels({ lookup })).toEqual([]);
        expect(readFile().serverSettings[A].logChannels).toEqual([{ channelId: "c1", versionId: "classic" }]);
    });

    it("on a failed read-back only puts logChannelIds back and takes the moved channels out", async () => {
        writeFile(base({
            logChannelIds: ["c1", "c2"],
            serverSettings: { [A]: { logChannels: [{ channelId: "c1", versionId: "classic" }] } },
        }));
        const realGet = configStore.getConfig;
        const realWrite = configStore.writeStored;
        const writeSpy = jest.spyOn(configStore, "writeStored").mockImplementationOnce((value) => {
            realWrite(value);
            // saved by the web between the write and the read back
            writeFile({ ...readFile(), officerRoleId: "saved" });
        });
        const spy = jest.spyOn(configStore, "getConfig")
            .mockImplementationOnce(() => realGet())
            .mockImplementationOnce(() => ({ serverSettings: {} }));
        await migrateLogChannels({ lookup: lookupFrom({ c1: { guildId: A }, c2: { guildId: A } }) });
        spy.mockRestore();
        writeSpy.mockRestore();

        const stored = readFile();
        expect(stored.logChannelIds).toEqual(["c1", "c2"]);
        expect(stored.officerRoleId).toBe("saved");
        expect(stored.serverSettings[A].logChannels).toEqual([{ channelId: "c1", versionId: "classic" }]);
    });
});

describe("services/logcheck/logChannelMigration lookupWithClient", () => {
    const clientWith = (fetch) => ({ channels: { fetch: jest.fn(fetch) } });

    it("returns the server and category of a channel", async () => {
        const client = clientWith(async () => ({ guildId: A, parentId: CAT_FOREVER }));
        expect(await lookupWithClient(client, "c1")).toEqual({ guildId: A, parentId: CAT_FOREVER });
    });

    it("returns an empty category for a channel without one", async () => {
        const client = clientWith(async () => ({ guildId: A, parentId: null }));
        expect(await lookupWithClient(client, "c1")).toEqual({ guildId: A, parentId: "" });
    });

    it("returns null for a channel outside any server", async () => {
        expect(await lookupWithClient(clientWith(async () => ({ guildId: null })), "dm")).toBeNull();
        expect(await lookupWithClient(clientWith(async () => null), "x")).toBeNull();
    });

    it.each([10003, 50001, 50013])("returns null for Discord code %s (gone, no access)", async (code) => {
        const client = clientWith(async () => { throw Object.assign(new Error("gone"), { code }); });
        expect(await lookupWithClient(client, "c1")).toBeNull();
    });

    it("throws any other error on", async () => {
        const client = clientWith(async () => { throw Object.assign(new Error("boom"), { code: 500 }); });
        await expect(lookupWithClient(client, "c1")).rejects.toThrow("boom");
    });
});

describe("services/logcheck/logChannelMigration runLogChannelMigration", () => {
    it("logs every line and the warnings also as warnings", async () => {
        writeFile(base({ logChannelIds: ["c1", "far"] }));
        const client = { channels: { fetch: jest.fn(async (id) => ({ guildId: id === "far" ? STRANGER : A, parentId: "" })) } };
        const log = jest.fn();
        const warn = jest.fn();
        const lines = await runLogChannelMigration(client, { log, warn });

        expect(lines).toHaveLength(2);
        expect(log).toHaveBeenCalledTimes(2);
        expect(log.mock.calls[0][0]).toMatch(/^\[settings\] Migration: config\.json: 2 Log-Kanal/);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("WARNUNG");
    });

    it("never throws", async () => {
        const warn = jest.fn();
        const spy = jest.spyOn(configStore, "readStored").mockImplementation(() => { throw new Error("disk"); });
        expect(await runLogChannelMigration({}, { log: jest.fn(), warn })).toEqual([]);
        spy.mockRestore();
        expect(warn.mock.calls[0][0]).toContain("disk");
    });
});
