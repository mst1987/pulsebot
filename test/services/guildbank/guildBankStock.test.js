jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Event-Server" }, { id: "g2", name: "PvP" }, { id: "talk", name: "Talk" }]),
}));

const stock = require("../../../src/services/guildbank/guildBankStock");
const store = require("../../../src/stores/guildBankStockStore");
const { GB_FORMAT, GuildBankParseError } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;
const CONFIG = {
    guildId: "g1",
    mainVersion: "tbc",
    discordServers: { eventGuilds: [{ guildId: "g1", label: "PvE" }, { guildId: "g2", label: "" }], talkGuildId: "talk" },
};

const body = (over = {}) => ({
    format: GB_FORMAT, version: 1, client: { project: "tbc", build: "2.5.5" },
    guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
    scannedBy: "Gemli", scannedAt: 1791000000, money: 100,
    tabs: [{ index: 1, name: "Alles", items: [{ itemId: 944, count: 1, slot: 1 }, { itemId: 22854, count: 40, slot: 2 }] }],
    ...over,
});

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
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

    it("assigns right away with a token bound to a server", () => {
        const result = stock.ingestScan(body(), { token: { id: "t1", guildId: "g2" }, now: NOW, config: CONFIG });
        expect(result.bank).toMatchObject({ guildId: "g2", pending: false });
        expect(stock.serverOfToken(null)).toBe("");
    });

    it("gives a new bank to the one event server when exactly one is configured", () => {
        const single = { ...CONFIG, discordServers: { eventGuilds: [{ guildId: "g1", label: "PvE" }] } };
        const result = stock.ingestScan(body(), { now: NOW, config: single });
        expect(result.bank).toMatchObject({ guildId: "g1", pending: false });
        expect(stock.onlyEventServer({ guildId: "g7" })).toBe("g7");
        expect(stock.onlyEventServer(CONFIG)).toBe("");
    });

    it("leaves a known bank's assignment alone, also one taken back on purpose", () => {
        const single = { ...CONFIG, discordServers: { eventGuilds: [{ guildId: "g1", label: "PvE" }] } };
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(bank.pending).toBe(true);
        const again = stock.ingestScan(body({ scannedAt: 1791003600 }), { now: NOW + 1, config: single });
        expect(again.bank).toMatchObject({ guildId: "", pending: true });
    });

    it("takes the main version for a client that names none", () => {
        const result = stock.ingestScan(body({ client: {} }), { now: NOW, config: { ...CONFIG, mainVersion: "forever" } });
        expect(result.bank.key).toBe("forever:spineshatter:die gilde");
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
            { guildId: "g1", name: "Event-Server", label: "PvE" },
            { guildId: "g2", name: "PvP", label: "" },
        ]);
        expect(stock.bankServers({ guildId: "g9" })).toEqual([{ guildId: "g9", name: "", label: "" }]);
    });

    it("assigns only to an event server, and takes an assignment back", () => {
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(stock.assignBank(bank.key, "talk", { config: CONFIG })).toEqual({ code: "invalid", error: "Nur ein Event-Server kann eine Gildenbank bekommen." });
        expect(stock.assignBank("nope", "g1", { config: CONFIG })).toEqual({ code: "not_found", error: "Gildenbank nicht gefunden." });
        expect(stock.assignBank(bank.key, " g2 ", { config: CONFIG }).bank).toMatchObject({ guildId: "g2", pending: false });
        expect(stock.assignBank(bank.key, "", { config: CONFIG }).bank).toMatchObject({ guildId: "", pending: true });
    });

    it("removes a bank", () => {
        const { bank } = stock.ingestScan(body(), { now: NOW, config: CONFIG });
        expect(stock.removeBank(bank.key)).toEqual({ ok: true });
        expect(stock.removeBank(bank.key)).toEqual({ code: "not_found", error: "Gildenbank nicht gefunden." });
    });
});
