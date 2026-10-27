jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "11111", name: "Event-Server" }, { id: "22222", name: "PvP" }, { id: "33333", name: "Talk" }]),
}));

const fs = require("fs");
const stock = require("../../../src/services/guildbank/guildBankStock");
const store = require("../../../src/stores/guildBankStockStore");
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
});

describe("services/guildbank/guildBankStock", () => {
    it("stores a scan as a bank waiting for its server, local names filled, the rest to look up", () => {
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

    it("gives a new bank to the one event server when exactly one is configured", () => {
        const single = { ...CONFIG, discordServers: { eventGuilds: [{ guildId: "11111", label: "PvE" }] } };
        const result = stock.ingestScan(body(), { now: NOW, config: single });
        expect(result.bank).toMatchObject({ guildId: "11111", pending: false });
        expect(stock.onlyEventServer({ guildId: "77777" })).toBe("77777");
        expect(stock.onlyEventServer(CONFIG)).toBe("");
        // one raid server plus the talk server (#890): still the one raid server
        expect(stock.onlyEventServer({ discordServers: { servers: [{ guildId: "11111" }, { guildId: "33333" }], links: [], talkGuildId: "33333" } })).toBe("11111");
    });

    it("leaves a known bank's assignment alone, also one taken back on purpose", () => {
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
        expect(stock.assignBank(bank.key, "44444", { config: CONFIG })).toEqual({ code: "invalid", error: "Nur ein Event-Server kann eine Gildenbank bekommen." });
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
