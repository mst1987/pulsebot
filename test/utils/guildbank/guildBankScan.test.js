const {
    parseGuildBankScan, versionOfClient, normalizeFaction, bankKeyOf, realmKey, guildKey,
    GuildBankParseError, GB_FORMAT, GB_VERSION,
} = require("../../../src/utils/guildbank/guildBankScan");

const scan = (over = {}) => ({
    format: GB_FORMAT,
    version: GB_VERSION,
    generatedAt: 1791000100,
    client: { project: "tbc", build: "2.5.5" },
    guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
    scannedBy: "Gemli",
    scannedAt: 1791000000,
    money: 12345678,
    tabs: [
        { index: 1, name: "Mats", items: [
            { itemId: 21877, count: 20, slot: 1 },
            { itemId: 21877, count: 20, slot: 2 },
            { itemId: 24027, count: 14, slot: 3 },
        ] },
        { index: 2, name: "Tränke", items: [
            { itemId: 22854, count: 40, slot: 1 },
            { itemId: 21877, count: 300, slot: 5 },
        ] },
    ],
    ...over,
});

describe("utils/guildbank/guildBankScan", () => {
    it("reads a scan: identity, facts in ms, items summed per id with their count per tab", () => {
        const parsed = parseGuildBankScan(scan());
        expect(parsed).toMatchObject({
            format: GB_FORMAT, version: 1, gameVersion: "tbc", versionGuessed: false, project: "tbc", build: "2.5.5",
            guild: "Die Gilde", realm: "Spineshatter", faction: "Alliance", key: "tbc:spineshatter:die gilde",
            scannedBy: "Gemli", scannedAt: 1791000000000, generatedAt: 1791000100000, money: 12345678,
            tabs: [{ index: 1, name: "Mats" }, { index: 2, name: "Tränke" }],
        });
        expect(parsed.items).toEqual({
            21877: { count: 340, tabs: { 1: 40, 2: 300 } },
            24027: { count: 14, tabs: { 1: 14 } },
            22854: { count: 40, tabs: { 2: 40 } },
        });
    });

    it("reads the JSON text as well", () => {
        expect(parseGuildBankScan(JSON.stringify(scan())).key).toBe("tbc:spineshatter:die gilde");
        expect(() => parseGuildBankScan("{nope")).toThrow(GuildBankParseError);
    });

    it("refuses what is no scan, a newer format and a scan without guild or realm", () => {
        expect(() => parseGuildBankScan(null)).toThrow("Kein Gildenbank-Scan");
        expect(() => parseGuildBankScan({ format: "eventhelper-loot" })).toThrow("Kein Gildenbank-Scan");
        expect(() => parseGuildBankScan(scan({ version: 2 }))).toThrow(/neueren Addon-Version \(Format v2, unterstützt wird v1\)/);
        expect(() => parseGuildBankScan(scan({ guild: { name: "", realm: "Spineshatter" } }))).toThrow("keine Gilde");
        expect(() => parseGuildBankScan(scan({ guild: "Die Gilde" }))).toThrow("keine Gilde");
        expect(() => parseGuildBankScan(scan({ tabs: "x" }))).toThrow("keine Liste");
    });

    it("tolerates extra fields and a missing version (read as v1 shape)", () => {
        const parsed = parseGuildBankScan(scan({ version: undefined, extra: { a: 1 }, client: { project: "tbc", build: "2.5.5", addon: "1.9.0" } }));
        expect(parsed.version).toBe(0);
        expect(parsed.key).toBe("tbc:spineshatter:die gilde");
    });

    it("drops junk rows and tabs instead of failing", () => {
        const parsed = parseGuildBankScan(scan({ tabs: [
            null,
            { index: 0, name: "kein Index", items: [{ itemId: 1, count: 1 }] },
            { index: 3, name: "  Rest   Tab  ", items: [
                null, "x", { itemId: 0, count: 5 }, { itemId: 25, count: 0 }, { itemId: -3, count: 2 },
                { itemId: 1.5, count: 2 }, { itemId: "2589", count: "7" }, { itemId: 2589, count: 1e9 },
            ] },
            { index: 3, name: "doppelt", items: [{ itemId: 2589, count: 3 }] },
            { index: 4, name: "leer" },
        ] }));
        expect(parsed.tabs).toEqual([{ index: 3, name: "Rest Tab" }, { index: 4, name: "leer" }]);
        expect(parsed.items).toEqual({ 2589: { count: 10, tabs: { 3: 10 } } });
    });

    it("reads no tabs as an empty bank, and keeps seconds, ms and missing times apart", () => {
        const parsed = parseGuildBankScan(scan({ tabs: undefined, scannedAt: 1791000000123, generatedAt: "x", money: -5 }));
        expect(parsed.tabs).toEqual([]);
        expect(parsed.items).toEqual({});
        expect(parsed.scannedAt).toBe(1791000000123);
        expect(parsed.generatedAt).toBe(0);
        expect(parsed.money).toBe(0);
    });

    it("falls back to the given version when the client names none, and refuses without one", () => {
        const parsed = parseGuildBankScan(scan({ client: {} }), { fallbackVersion: "forever" });
        expect(parsed).toMatchObject({ gameVersion: "forever", versionGuessed: true, key: "forever:spineshatter:die gilde" });
        expect(() => parseGuildBankScan(scan({ client: null }))).toThrow("keine bekannte Client-Version");
    });

    describe("versionOfClient", () => {
        it("knows our ids, WoW's project names and numbers, and the build", () => {
            expect(versionOfClient({ project: "TBC" })).toBe("tbc");
            expect(versionOfClient({ project: "bcc" })).toBe("tbc");
            expect(versionOfClient({ project: 5 })).toBe("tbc");
            expect(versionOfClient({ project: "classic" })).toBe("classic");
            expect(versionOfClient({ project: "era" })).toBe("classic");
            expect(versionOfClient({ project: "forever" })).toBe("forever");
            expect(versionOfClient({ project: "mainline" })).toBe("forever");
            expect(versionOfClient({ project: "", build: "2.5.4" })).toBe("tbc");
            expect(versionOfClient({ project: "?", build: "1.15.7" })).toBe("classic");
            expect(versionOfClient({ build: "11.0.2" })).toBe("");
            expect(versionOfClient(null)).toBe("");
        });
    });

    it("normalises the faction and builds keys that ignore case, blanks and apostrophes", () => {
        expect(normalizeFaction("Allianz")).toBe("Alliance");
        expect(normalizeFaction("HORDE")).toBe("Horde");
        expect(normalizeFaction("Neutral")).toBe("");
        expect(realmKey("Die Aldor")).toBe("diealdor");
        expect(realmKey("Zul'Jin")).toBe("zuljin");
        expect(guildKey("  Die   Gilde ")).toBe("die gilde");
        expect(bankKeyOf("TBC", "Die Aldor", "Die  Gilde")).toBe("tbc:diealdor:die gilde");
        expect(parseGuildBankScan(scan({ guild: { name: "Die Gilde", realm: "Die Aldor", faction: "x" } })).faction).toBe("");
    });
});
