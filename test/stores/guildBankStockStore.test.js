const store = require("../../src/stores/guildBankStockStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../helpers/tempStore");
const fs = require("fs");

const NOW = 1_800_000_000_000;
const KEY = "tbc:spineshatter:die gilde";

const FILE = tempStoreFile("guild-bank-stock.json");

beforeAll(() => store.useFile(FILE));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const b of store.listBanks()) store.removeBank(b.key);
});

/** A parsed scan: `items` as [[itemId, count, tab], ...]. */
function scan({ items = [[24027, 14, 1], [22854, 40, 2], [21877, 340, 2]], scannedAt = 1791000000, project = "tbc", guild = "Die Gilde", realm = "Spineshatter" } = {}) {
    const tabs = [1, 2].map((index) => ({
        index,
        name: index === 1 ? "Edelsteine" : "Verbrauch",
        items: items.filter((i) => i[2] === index).map(([itemId, count]) => ({ itemId, count, slot: 1 })),
    }));
    return parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project }, guild: { name: guild, realm, faction: "Horde" },
        scannedBy: "Gemli", scannedAt, money: 5000000, tabs,
    });
}

describe("stores/guildBankStockStore", () => {
    it("creates an unknown bank waiting for assignment, every item new", () => {
        const result = store.recordScan(scan(), { now: NOW, uploadedBy: "Raidlead-PC" });
        expect(result.status).toBe("created");
        expect(result.newItems.sort()).toEqual([21877, 22854, 24027]);
        expect(result.bank).toMatchObject({
            key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Horde",
            guildId: "", pending: true, firstSeenAt: NOW, updatedAt: NOW, scannedAt: 1791000000000,
            scannedBy: "Gemli", money: 5000000, receivedAt: NOW, uploadedBy: "Raidlead-PC",
            counts: { items: 3, inStock: 3, new: 3, hide: 0, show: 0, give: 0 },
        });
        expect(result.bank.tabs).toEqual([
            { index: 1, name: "Edelsteine", inScan: true, hidden: false },
            { index: 2, name: "Verbrauch", inScan: true, hidden: false },
        ]);
        expect(result.bank.items).toBeUndefined();

        const bank = store.getBank(KEY);
        expect(bank.items.find((i) => i.itemId === 21877)).toMatchObject({
            itemId: 21877, count: 340, tabs: { 2: 340 }, status: "new", reserve: 0, maxPerRequest: 0, category: "",
            name: "", icon: "", iconUrl: "", quality: null, metaSource: "", firstSeenAt: NOW,
        });
    });

    it("assigns a new bank to the server it was uploaded for", () => {
        const { bank } = store.recordScan(scan(), { now: NOW, guildId: "g1" });
        expect(bank).toMatchObject({ guildId: "g1", pending: false });
        // A later upload with another server does not move it.
        store.recordScan(scan({ scannedAt: 1791000100 }), { now: NOW + 1, guildId: "g2" });
        expect(store.getBank(KEY).guildId).toBe("g1");
    });

    it("keeps the settings over a new scan: new ids are new, gone ones read 0", () => {
        store.recordScan(scan(), { now: NOW });
        expect(store.setItemSettings(KEY, 22854, { status: "give", reserve: 10, maxPerRequest: "2", category: "  Fläschchen " }).item)
            .toMatchObject({ itemId: 22854, count: 40, status: "give", reserve: 10, maxPerRequest: 2, category: "Fläschchen" });
        store.setItemSettings(KEY, 24027, { status: "hide" });

        const next = store.recordScan(scan({ scannedAt: 1791003600, items: [[22854, 25, 2], [13444, 5, 1]] }), { now: NOW + 1000 });
        expect(next.status).toBe("updated");
        expect(next.newItems).toEqual([13444]);

        const items = Object.fromEntries(store.getBank(KEY).items.map((i) => [i.itemId, i]));
        expect(items[22854]).toMatchObject({ count: 25, status: "give", reserve: 10, maxPerRequest: 2, category: "Fläschchen" });
        expect(items[24027]).toMatchObject({ count: 0, tabs: {}, status: "hide" });
        expect(items[21877]).toMatchObject({ count: 0, status: "new" });
        expect(items[13444]).toMatchObject({ count: 5, status: "new", firstSeenAt: NOW + 1000 });
        expect(store.getBank(KEY).counts).toEqual({ items: 4, inStock: 2, new: 2, hide: 1, show: 0, give: 1 });
    });

    it("ignores a scan older than the stored one", () => {
        store.recordScan(scan({ scannedAt: 1791003600 }), { now: NOW });
        const late = store.recordScan(scan({ scannedAt: 1791000000, items: [[1, 1, 1]] }), { now: NOW + 1 });
        expect(late.status).toBe("stale");
        expect(late.newItems).toEqual([]);
        expect(store.getBank(KEY).items.map((i) => i.itemId)).not.toContain(1);
        expect(store.getBank(KEY).scannedAt).toBe(1791003600000);
    });

    it("keeps the same guild on another client or realm as a bank of its own", () => {
        store.recordScan(scan(), { now: NOW });
        store.recordScan(scan({ project: "forever" }), { now: NOW });
        store.recordScan(scan({ realm: "Thunderstrike" }), { now: NOW });
        expect(store.listBanks().map((b) => b.key).sort()).toEqual([
            "forever:spineshatter:die gilde", "tbc:spineshatter:die gilde", "tbc:thunderstrike:die gilde",
        ]);
    });

    it("lists waiting banks first and the banks of one server with their items", () => {
        store.recordScan(scan({ guild: "Alpha" }), { now: NOW, guildId: "g1" });
        store.recordScan(scan({ guild: "Beta" }), { now: NOW });
        expect(store.listBanks().map((b) => [b.guild, b.pending])).toEqual([["Beta", true], ["Alpha", false]]);
        const mine = store.listForServer("g1");
        expect(mine.map((b) => b.guild)).toEqual(["Alpha"]);
        expect(mine[0].items).toHaveLength(3);
        expect(store.listForServer("")).toEqual([]);
        expect(store.listForServer("g9")).toEqual([]);
    });

    it("assigns, takes back and removes a bank", () => {
        store.recordScan(scan(), { now: NOW });
        expect(store.assignBank(KEY, "g1")).toMatchObject({ guildId: "g1", pending: false });
        expect(store.assignBank(KEY, "")).toMatchObject({ guildId: "", pending: true });
        expect(store.assignBank("nope", "g1")).toBeNull();
        expect(store.removeBank(KEY)).toBe(true);
        expect(store.removeBank(KEY)).toBe(false);
        expect(store.getBank(KEY)).toBeNull();
    });

    it("validates item settings and writes nothing on a bad field", () => {
        store.recordScan(scan(), { now: NOW });
        expect(store.setItemSettings("nope", 22854, { status: "give" })).toEqual({ error: "Gildenbank nicht gefunden." });
        expect(store.setItemSettings(KEY, 999, { status: "give" })).toEqual({ error: "Gegenstand nicht in dieser Gildenbank." });
        expect(store.setItemSettings(KEY, 22854, { status: "new" })).toEqual({ error: "Unbekannte Einordnung." });
        expect(store.setItemSettings(KEY, 22854, { status: "give", reserve: -1 }).error).toMatch(/Reserve/);
        expect(store.setItemSettings(KEY, 22854, { reserve: "1.5" }).error).toMatch(/Reserve/);
        expect(store.setItemSettings(KEY, 22854, { maxPerRequest: 10000 }).error).toMatch(/Höchstmenge/);
        expect(store.getBank(KEY).items.find((i) => i.itemId === 22854)).toMatchObject({ status: "new", reserve: 0 });
        expect(store.setItemSettings(KEY, "22854", { status: "show", maxPerRequest: 0, unknown: 1 }).item)
            .toMatchObject({ status: "show", maxPerRequest: 0 });
    });

    it("hides a whole tab, also one that is gone from the bank", () => {
        store.recordScan(scan(), { now: NOW });
        expect(store.setTabHidden(KEY, 2, true).bank.tabs.find((t) => t.index === 2).hidden).toBe(true);
        expect(store.setTabHidden(KEY, 5, true).bank.tabs.find((t) => t.index === 5)).toEqual({ index: 5, name: "", inScan: false, hidden: true });
        store.recordScan(scan({ scannedAt: 1791003600 }), { now: NOW + 1 });
        expect(store.getBank(KEY).tabs.filter((t) => t.hidden).map((t) => t.index)).toEqual([2, 5]);
        expect(store.setTabHidden(KEY, 2, false).bank.tabs.find((t) => t.index === 2).hidden).toBe(false);
        expect(store.setTabHidden(KEY, 0, true)).toEqual({ error: "Unbekannter Bank-Tab." });
        expect(store.setTabHidden("nope", 1, true)).toEqual({ error: "Gildenbank nicht gefunden." });
    });

    it("keeps item meta per version: Wowhead replaces, local only fills, the store serves as the cache", () => {
        store.recordScan(scan(), { now: NOW });
        store.recordScan(scan({ guild: "Andere" }), { now: NOW });
        store.recordScan(scan({ project: "classic" }), { now: NOW });

        expect(store.setItemMeta("tbc", 22854, { name: "Flask", icon: "inv_potion_117", quality: 1 }, { source: "local", now: NOW })).toBe(2);
        expect(store.knownMeta("tbc", 22854)).toBeNull();
        expect(store.itemsWithoutWowheadMeta(KEY).sort()).toEqual([21877, 22854, 24027]);

        const meta = { name: "Fläschchen des unerbittlichen Angriffs", icon: "inv_potion_117", quality: 1, classId: 0, subclassId: 3, className: "Verbrauchbar", subclassName: "Fläschchen" };
        expect(store.setItemMeta("tbc", 22854, meta, { source: "wowhead", now: NOW + 5 })).toBe(2);
        expect(store.setItemMeta("tbc", 22854, { name: "Flask" }, { source: "local" })).toBe(0);
        expect(store.knownMeta("tbc", 22854)).toEqual(meta);
        expect(store.knownMeta("classic", 22854)).toBeNull();
        expect(store.itemsWithoutWowheadMeta(KEY).sort()).toEqual([21877, 24027]);
        expect(store.getBank(KEY).items.find((i) => i.itemId === 22854)).toMatchObject({
            ...meta, metaSource: "wowhead", metaAt: NOW + 5,
            iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_potion_117.jpg",
        });
        // Sorted by name: the named item before the unnamed ones.
        expect(store.getBank(KEY).items[0].itemId).toBe(22854);

        expect(store.setItemMeta("tbc", 22854, { name: "" }, { source: "wowhead" })).toBe(0);
        expect(store.setItemMeta("tbc", 22854, meta, { source: "other" })).toBe(0);
        expect(store.setItemMeta("tbc", 4242, meta, { source: "wowhead" })).toBe(0);
        expect(store.itemsWithoutWowheadMeta("nope")).toEqual([]);
    });

    it("reads a damaged file as empty and completes broken entries", () => {
        fs.writeFileSync(FILE, "{nope");
        expect(store.listBanks()).toEqual([]);
        fs.writeFileSync(FILE, JSON.stringify({ banks: [null, { key: "" }, {
            key: KEY, gameVersion: "tbc", items: { 1: { status: "weird", quality: "x", reserve: "abc" } },
            lastScan: { tabs: [{ index: 0 }, null], items: "bad" }, tabSettings: { 3: { hidden: false } },
        }] }));
        const bank = store.getBank(KEY);
        expect(bank).toMatchObject({ key: KEY, pending: true, tabs: [], scannedAt: 0 });
        expect(bank.items).toEqual([expect.objectContaining({ itemId: 1, count: 0, status: "new", quality: null, reserve: 0 })]);
        expect(store.listBanks()).toHaveLength(1);
    });

    it("knows which offered items have an icon, over every bank, and keeps their emojis (#633)", () => {
        store.recordScan(scan(), { now: NOW, guildId: "g1" });
        store.recordScan(scan({ project: "forever", items: [[24027, 3, 1]] }), { now: NOW, guildId: "g1" });
        const forever = store.listBanks().find((b) => b.gameVersion === "forever").key;
        store.setItemMeta("tbc", 24027, { name: "Rubin", icon: "inv_ruby" }, { source: "wowhead" });
        store.setItemMeta("tbc", 22854, { name: "Flask", icon: "inv_flask" }, { source: "wowhead" });
        store.setItemMeta("forever", 24027, { name: "Rubin", icon: "inv_ruby" }, { source: "wowhead" });
        expect(store.offeredIcons()).toEqual({});
        store.setItemSettings(KEY, 24027, { status: "give" });
        store.setItemSettings(forever, 24027, { status: "give" });
        store.setItemSettings(KEY, 22854, { status: "show" });
        store.setItemSettings(KEY, 21877, { status: "give" }); // no icon yet
        expect(store.offeredIcons()).toEqual({ 24027: "inv_ruby" });

        expect(store.itemEmojis()).toEqual({});
        store.setItemEmoji(24027, { id: "e1", name: "gb_24027", icon: "inv_ruby", createdAt: NOW });
        expect(store.itemEmojis()).toEqual({ 24027: { id: "e1", name: "gb_24027", icon: "inv_ruby", createdAt: NOW } });
        expect(store.getBank(KEY).items.find((it) => it.itemId === 24027).emojiId).toBe("e1");
        expect(store.getBank(forever).items[0].emojiId).toBe("e1");
        expect(store.listForServer("g1")[0].items.find((it) => it.itemId === 22854).emojiId).toBe("");
        expect(store.setItemSettings(KEY, 24027, { reserve: 1 }).item.emojiId).toBe("e1");
        // a scan keeps them
        store.recordScan(scan({ scannedAt: 1791000500 }), { now: NOW + 1 });
        expect(store.itemEmojis()[24027].id).toBe("e1");
        store.setItemEmoji(24027, null);
        store.setItemEmoji(0, { id: "x" });
        expect(store.itemEmojis()).toEqual({});
    });

    it("reads a hand-edited emoji list defensively", () => {
        fs.writeFileSync(FILE, JSON.stringify({ banks: [], emojis: { 0: { id: "x" }, 5: {}, 6: { id: "e6", name: "gb_6" }, 7: null } }));
        expect(store.itemEmojis()).toEqual({ 6: { id: "e6", name: "gb_6", icon: "", createdAt: 0 } });
        fs.writeFileSync(FILE, JSON.stringify({ banks: [], emojis: ["e1"] }));
        expect(store.itemEmojis()).toEqual({});
        expect(store.offeredIcons()).toEqual({});
    });
});
