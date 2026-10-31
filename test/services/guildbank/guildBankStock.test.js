let mockEvents = [];
let mockChannels = new Map();
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "11111", name: "Event-Server" }, { id: "22222", name: "PvP" }, { id: "33333", name: "Talk" }]),
    getClient: () => ({ channels: { cache: mockChannels } }),
}));
jest.mock("../../../src/stores/events/eventStore", () => ({ listEvents: (gid) => mockEvents.filter((e) => !gid || e.guildId === gid) }));

const fs = require("fs");
const stock = require("../../../src/services/guildbank/guildBankStock");
const store = require("../../../src/stores/loot/guildBankStockStore");
const { GB_FORMAT, GuildBankParseError } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;
const CONFIG = {
    guildId: "11111",
    mainVersion: "tbc",
    discordServers: { eventGuilds: [{ guildId: "11111", label: "PvE" }, { guildId: "22222", label: "" }], talkGuildId: "33333" },
};

const body = (over = {}) => ({
    format: GB_FORMAT, version: 1, client: { project: "tbc", build: "2.5.5" },
    guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
    scannedBy: "Gemli", scannedAt: 1791000000, money: 100,
    tabs: [{ index: 1, name: "Alles", items: [{ itemId: 944, count: 1, slot: 1 }, { itemId: 22854, count: 40, slot: 2 }] }],
    ...over,
});

const FILE = tempStoreFile("guild-bank-stock.json");

beforeAll(() => store.useFile(FILE));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const b of store.listBanks()) store.removeBank(b.key);
    mockEvents = [];
    mockChannels = new Map();
});

describe("services/guildbank/guildBankStock", () => {
    it("stores a scan as a bank waiting for its server, local names filled, the rest to look up", () => {
        mockEvents = [{ guildId: "22222", categoryId: "c2" }];
        const result = stock.ingestScan(body(), { token: { id: "t1", name: "Raidlead-PC" }, now: NOW, config: CONFIG });
        expect(result.status).toBe("created");
        expect(result.bank).toMatchObject({ key: "tbc:spineshatter:die gilde", pending: true, uploadedBy: "Raidlead-PC" });
        expect(result.newItems.sort()).toEqual([22854, 944]);
        expect(result.lookups.sort()).toEqual([22854, 944]);
        expect(store.getBank(result.bank.key).items.find((i) => i.itemId === 944)).toMatchObject({ name: "Elemental Mage Staff", metaSource: "local" });
    });

    // German names stored before the names turned English (no metaVersion):
    // the next scan names the items the local tables know in English at once.
    it("gives an item with a stale German name its local English name on the next scan", () => {
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        store.setItemMeta("tbc", 944, { name: "Elemental Mage Staff", classId: 2, subclassId: 10 }, { source: "wowhead", now: NOW });
        const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
        Object.assign(data.banks[0].items["944"], { name: "Elementarmagierstab" });
        delete data.banks[0].items["944"].metaVersion;
        fs.writeFileSync(FILE, JSON.stringify(data));
        store.useFile(FILE);

        const again = stock.ingestScan(body({ scannedAt: 1791003600 }), { now: NOW + 1, config: CONFIG });
        expect(again.lookups.sort()).toEqual([22854, 944]);
        expect(store.getBank(bank.key).items.find((i) => i.itemId === 944)).toMatchObject({ name: "Elemental Mage Staff", metaSource: "local", classId: 2 });
    });

    it("assigns right away with a token bound to a server", () => {
        const result = stock.ingestScan(body(), { token: { id: "t1", guildId: "22222" }, now: NOW, config: CONFIG });
        expect(result.bank).toMatchObject({ guildId: "22222", pending: false });
        expect(stock.serverOfToken(null)).toBe("");
    });

    // #994: a server key never writes into another server's bank.
    it("refuses a scan of a server key for a bank of another server, the stock unchanged", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const { bank } = stock.ingestScan(body(), { token: { id: "t1", guildId: "22222" }, now: NOW, config: CONFIG });
        const before = store.getBank(bank.key);
        const result = stock.ingestScan(body({ scannedAt: 1791003600, money: 999 }), { token: { id: "t2", guildId: "11111" }, now: NOW + 1, config: CONFIG });
        expect(result).toMatchObject({ code: "other_server" });
        expect(result.bank).toBeUndefined();
        expect(store.getBank(bank.key)).toEqual(before);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("anderen Server"));
        warn.mockRestore();
    });

    it("keeps a known bank without server without one on a scan of a server key", () => {
        mockEvents = [{ guildId: "22222", categoryId: "c2" }];
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(bank).toMatchObject({ guildId: "", pending: true });
        const again = stock.ingestScan(body({ scannedAt: 1791003600 }), { token: { id: "t1", guildId: "22222" }, now: NOW + 1, config: CONFIG });
        expect(again.status).toBe("updated");
        expect(again.bank).toMatchObject({ guildId: "", pending: true });
    });

    // #1000: a personal key counts for its owner's orga servers (the route passes `servers`).
    it("gives a new bank of a personal key a server only when the key counts for exactly one", () => {
        const person = { id: "p1", ownerId: "u1" };
        const one = stock.ingestScan(body(), { token: person, servers: ["22222"], now: NOW, config: CONFIG });
        expect(one.bank).toMatchObject({ guildId: "22222", pending: false });
        const two = stock.ingestScan(body({ client: { project: "forever" } }), { token: person, servers: ["11111", "22222"], now: NOW, config: CONFIG });
        expect(two.bank).toMatchObject({ guildId: "", pending: true });
    });

    // #1002: version, realm and guild decide between the key's servers; else the bank waits for them.
    describe("a new bank of a personal key with several servers", () => {
        const person = { id: "p1", ownerId: "u1" };
        const wcl = (guildName, realm, versionId = "tbc") => ({ wclGuilds: [{ versionId, guildName, realm, region: "EU" }] });
        const withGuilds = (settings) => ({ ...CONFIG, serverSettings: settings });

        it("goes to the one server whose WCL guild is the bank's guild", () => {
            const config = withGuilds({ 11111: wcl("Andere Gilde", "Spineshatter"), 22222: wcl("Die Gilde", "Spineshatter") });
            const result = stock.ingestScan(body(), { token: person, servers: ["11111", "22222"], now: NOW, config });
            expect(result.bank).toMatchObject({ guildId: "22222", pending: false, waitingFor: [] });
        });

        it("waits for both servers when the guild fits two of them", () => {
            const config = withGuilds({ 11111: wcl("Die Gilde", "Spineshatter"), 22222: wcl("die gilde", "Spineshatter") });
            const result = stock.ingestScan(body(), { token: person, servers: ["11111", "22222"], now: NOW, config });
            expect(result.bank).toMatchObject({ guildId: "", pending: true, waitingFor: ["11111", "22222"] });
        });

        it("waits when no server's guild fits in version and realm, and any assignment ends the wait", () => {
            const config = withGuilds({ 11111: wcl("Die Gilde", "Thunderstrike"), 22222: wcl("Die Gilde", "Spineshatter", "forever") });
            const result = stock.ingestScan(body(), { token: person, servers: ["11111", "22222"], now: NOW, config });
            // only the server that plays the bank's version (TBC) comes into question
            expect(result.bank.waitingFor).toEqual(["11111"]);
            expect(store.assignBank(result.bank.key, "22222")).toMatchObject({ guildId: "22222", pending: false, waitingFor: [] });
            expect(store.getBank(result.bank.key).waitingFor).toEqual([]);
        });

        it("waits only for the fitting servers, not every server of the key", () => {
            const config = withGuilds({ 11111: wcl("Die Gilde", "Spineshatter"), 22222: wcl("Die Gilde", "Spineshatter"), 33333: wcl("Andere", "Spineshatter") });
            const result = stock.ingestScan(body(), { token: person, servers: ["11111", "22222", "33333"], now: NOW, config });
            expect(result.bank.waitingFor).toEqual(["11111", "22222"]);
        });

        it("waits for every server of the key when none names a guild of the version", () => {
            const result = stock.ingestScan(body(), { token: person, servers: ["11111", "22222"], now: NOW, config: CONFIG });
            expect(result.bank.waitingFor).toEqual(["11111", "22222"]);
        });
    });

    it("lets a personal key scan known banks of its servers and refuses one of another", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const person = { id: "p1", ownerId: "u1" };
        stock.ingestScan(body(), { token: { id: "t1", guildId: "22222" }, now: NOW, config: CONFIG });
        const mine = stock.ingestScan(body({ scannedAt: 1791003600 }), { token: person, servers: ["11111", "22222"], now: NOW + 1, config: CONFIG });
        expect(mine).toMatchObject({ status: "updated", bank: { guildId: "22222" } });
        const foreign = stock.ingestScan(body({ scannedAt: 1791007200 }), { token: person, servers: ["11111"], now: NOW + 2, config: CONFIG });
        expect(foreign).toMatchObject({ code: "other_server" });
        expect(stock.serverListOf({ guildId: "22222" })).toEqual(["22222"]);
        expect(stock.serverListOf({})).toBeNull();
        // fail closed: a personal key without its list gets no server, never every one
        expect(stock.serverListOf(person)).toEqual([]);
        expect(stock.serverListOf({ ownerId: "u1", guildId: "22222" })).toEqual([]);
        warn.mockRestore();
    });

    // One server has a bank per game version (key version:realm:guild).
    it("gives two new banks of different versions to the same server key", () => {
        const token = { id: "t1", guildId: "22222" };
        const tbc = stock.ingestScan(body(), { token, now: NOW, config: CONFIG });
        const forever = stock.ingestScan(body({ client: { project: "forever" } }), { token, now: NOW, config: CONFIG });
        const other = stock.ingestScan(body({ client: { project: "forever" }, guild: { name: "Zweite Gilde", realm: "Everlook" } }), { token, now: NOW, config: CONFIG });
        for (const r of [tbc, forever, other]) expect(r).toMatchObject({ status: "created", bank: { guildId: "22222", pending: false } });
        expect(store.listBanks().map((b) => b.key).sort()).toEqual(["forever:everlook:zweite gilde", "forever:spineshatter:die gilde", "tbc:spineshatter:die gilde"]);
        // the own server's bank of the other version is no conflict on the next scan
        const again = stock.ingestScan(body({ scannedAt: 1791003600 }), { token, now: NOW + 1, config: CONFIG });
        expect(again).toMatchObject({ status: "updated", bank: { guildId: "22222" } });
    });

    it("gives a new bank to the one event server when exactly one is configured", () => {
        const single = { ...CONFIG, discordServers: { eventGuilds: [{ guildId: "11111", label: "PvE" }] } };
        const result = stock.ingestScan(body(), { now: NOW, config: single });
        expect(result.bank).toMatchObject({ guildId: "11111", pending: false });
        expect(stock.onlyEventServer({ guildId: "77777" })).toBe("77777");
        expect(stock.onlyEventServer({ discordServers: { servers: [{ guildId: "11111" }], links: [] } })).toBe("11111");
        // no config given: the stored one counts, null the same as left out
        expect(stock.onlyEventServer(null)).toBe(stock.onlyEventServer());
    });

    // #897: after the migration prod has [raid server, old talk server]. The
    // talk server without raids must not send new banks to the assignment queue.
    const PAIR = { discordServers: { servers: [{ guildId: "11111" }, { guildId: "33333" }], links: [] } };

    it("gives a new bank to the raid server when the other server has no raids", () => {
        mockEvents = [{ guildId: "33333", categoryId: "" }]; // an event without category is no raid source
        expect(stock.onlyEventServer(PAIR)).toBe("11111");
        expect(stock.onlyEventServer(CONFIG)).toBe("11111");
        const result = stock.ingestScan(body(), { now: NOW, config: PAIR });
        expect(result.bank).toMatchObject({ guildId: "11111", pending: false });
    });

    it("leaves a new bank to the orga with two raid servers", () => {
        mockEvents = [{ guildId: "33333", categoryId: "c3" }];
        expect(stock.onlyEventServer(PAIR)).toBe("");
        mockEvents = [];
        mockChannels = new Map([["c9", { guildId: "33333" }]]);
        expect(stock.onlyEventServer({ ...PAIR, categoryIds: ["c9"] })).toBe("");
        const result = stock.ingestScan(body(), { now: NOW, config: { ...PAIR, categoryIds: ["c9"] } });
        expect(result.bank).toMatchObject({ guildId: "", pending: true });
    });

    it("leaves a known bank's assignment alone, also one taken back on purpose", () => {
        mockEvents = [{ guildId: "22222", categoryId: "c2" }];
        const single = { ...CONFIG, discordServers: { eventGuilds: [{ guildId: "11111", label: "PvE" }] } };
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(bank.pending).toBe(true);
        const again = stock.ingestScan(body({ scannedAt: 1791003600 }), { now: NOW + 1, config: single });
        expect(again.bank).toMatchObject({ guildId: "", pending: true });
    });

    // #737: a scan without client version is never filed under the main version.
    it("gives a scan without client version to the known bank of its realm and guild", () => {
        stock.ingestScan(body({ client: { project: "forever" } }), { now: NOW, config: CONFIG });
        const result = stock.ingestScan(body({ client: {}, scannedAt: 1791003600 }), { now: NOW + 1, config: { ...CONFIG, mainVersion: "tbc" } });
        expect(result.status).toBe("updated");
        expect(result.bank.key).toBe("forever:spineshatter:die gilde");
        expect(store.listBanks().map((b) => b.key)).toEqual(["forever:spineshatter:die gilde"]);
    });

    it("refuses and reports a scan without client version when no bank of its realm and guild is known", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        stock.ingestScan(body({ guild: { name: "Andere Gilde", realm: "Spineshatter" } }), { now: NOW, config: CONFIG });
        expect(() => stock.ingestScan(body({ client: {} }), { now: NOW, config: { ...CONFIG, mainVersion: "forever" } }))
            .toThrow(/keine eindeutige Gildenbank für Die Gilde \(Spineshatter\)/);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("[guildbank] Scan abgelehnt"));
        expect(store.listBanks().map((b) => b.key)).toEqual(["tbc:spineshatter:andere gilde"]);
        warn.mockRestore();
    });

    it("refuses a scan without client version when its guild has banks of two versions", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        stock.ingestScan(body(), { now: NOW, config: CONFIG });
        stock.ingestScan(body({ client: { project: "forever" } }), { now: NOW, config: CONFIG });
        expect(() => stock.ingestScan(body({ client: {}, scannedAt: 1791003600 }), { now: NOW + 1, config: CONFIG })).toThrow(GuildBankParseError);
        warn.mockRestore();
    });

    it("answers a stale scan without lookups", () => {
        stock.ingestScan(body({ scannedAt: 1791003600 }), { now: NOW, config: CONFIG });
        const late = stock.ingestScan(body(), { now: NOW + 1, config: CONFIG });
        expect(late).toMatchObject({ status: "stale", lookups: [] });
    });

    it("throws the parse error for an upload that is no scan", () => {
        expect(() => stock.ingestScan({ format: "x" }, { config: CONFIG })).toThrow(GuildBankParseError);
    });

    it("offers every event server with its name and label", () => {
        expect(stock.bankServers(CONFIG)).toEqual([
            { guildId: "11111", name: "Event-Server", label: "PvE" },
            { guildId: "22222", name: "PvP", label: "" },
            { guildId: "33333", name: "Talk", label: "" },
        ]);
        expect(stock.bankServers({ guildId: "99999" })).toEqual([{ guildId: "99999", name: "", label: "" }]);
    });

    it("assigns only to an event server, and takes an assignment back", () => {
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(stock.assignBank(bank.key, "44444", { config: CONFIG })).toEqual({ code: "invalid", error: "Nur ein Server aus der Serverliste kann eine Gildenbank bekommen." });
        expect(stock.assignBank("nope", "11111", { config: CONFIG })).toEqual({ code: "not_found", error: "Gildenbank nicht gefunden." });
        expect(stock.assignBank(bank.key, " 22222 ", { config: CONFIG }).bank).toMatchObject({ guildId: "22222", pending: false });
        expect(stock.assignBank(bank.key, "", { config: CONFIG }).bank).toMatchObject({ guildId: "", pending: true });
    });

    it("removes a bank", () => {
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(stock.removeBank(bank.key)).toEqual({ ok: true });
        expect(stock.removeBank(bank.key)).toEqual({ code: "not_found", error: "Gildenbank nicht gefunden." });
    });
});
