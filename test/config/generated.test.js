const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Golden master, captured from the modules BEFORE their data moved into
// src/config/generated/ (#428): the loaders must answer exactly what the old
// JavaScript tables answered.
const golden = require("../fixtures/golden/configData.json");

const GENERATED = path.join(__dirname, "..", "..", "src", "config", "generated");

function jsonFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsonFiles(full));
        else if (entry.name.endsWith(".json")) out.push(full);
    }
    return out;
}

const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("src/config/generated", () => {
    const files = jsonFiles(GENERATED);

    it("holds the generated data files", () => {
        const rel = files.map((f) => path.relative(GENERATED, f).split(path.sep).join("/"));
        for (const name of [
            "tbcRaidLoot.json", "tbcLootNames.json", "claData.json", "rpbData.json", "bossIcons.json",
            "mobIcons.json", "wowhead/bisSets.json", "wowsims/items.json", "wowsims/bisSets.json",
        ]) {
            expect(rel).toContain(name);
        }
        expect(rel.filter((f) => f.startsWith("wowsims/apls/")).length).toBeGreaterThan(0);
    });

    it.each(files.map((f) => [path.relative(GENERATED, f), f]))("%s is valid JSON", (_name, file) => {
        expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    });

    it("contains nothing but JSON and its README", () => {
        const all = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else all.push(entry.name);
            }
        };
        walk(GENERATED);
        expect(all.filter((name) => !name.endsWith(".json") && name !== "README.md")).toEqual([]);
    });

    it("documents every generated file in the README", () => {
        const readme = fs.readFileSync(path.join(GENERATED, "README.md"), "utf8");
        for (const file of files) {
            const rel = path.relative(GENERATED, file).split(path.sep).join("/");
            const listed = rel.startsWith("wowsims/apls/") ? "wowsims/apls/*.apl.json" : rel;
            expect(readme).toContain(`\`${listed}\``);
        }
    });
});

describe("golden master: the loaders answer what the old tables answered", () => {
    const names = require("../../src/config/tbcLootNames");
    const tbc = require("../../src/config/tbcContent");
    const cla = require("../../src/config/claData");
    const rpb = require("../../src/config/rpbData");
    const bosses = require("../../src/config/bosses");
    const wowsims = require("../../src/config/wowsims");
    const bis = require("../../src/config/bisSets");
    const ids = Object.keys(golden.itemMeta);

    it("tbcLootNames: itemMeta/itemName per sample id, same table", () => {
        for (const id of ids) {
            expect(names.itemMeta(Number(id))).toEqual(golden.itemMeta[id]);
            expect(names.itemName(id)).toBe(golden.itemName[id]);
        }
        expect(Object.keys(names.RAID_ITEMS)).toHaveLength(golden.raidItemsCount);
        expect(hash(names.RAID_ITEMS)).toBe(golden.hashes.RAID_ITEMS);
    });

    it("tbcContent: RAID_LOOT and the lookups on it", () => {
        for (const id of ids) expect(tbc.sourceForItem(Number(id))).toEqual(golden.sourceForItem[id]);
        expect(Object.fromEntries(Object.entries(tbc.RAID_LOOT).map(([c, b]) => [c, Object.keys(b).length]))).toEqual(golden.raidLootBosses);
        expect(tbc.encountersFor("bt")).toEqual(golden.encountersBt);
        expect(tbc.contentForBoss("Lady Vashj")).toEqual(golden.contentForBoss);
        expect(hash(tbc.RAID_LOOT)).toBe(golden.hashes.RAID_LOOT);
        // item ids stay numbers, as the old JavaScript table had them
        expect(typeof tbc.RAID_LOOT.bt["Illidan Stormrage"][0]).toBe("number");
    });

    it("claData and rpbData: same keys, same values", () => {
        expect(Object.keys(cla)).toEqual(golden.claKeys);
        expect({ ENCHANTABLE_SLOTS: cla.ENCHANTABLE_SLOTS, GEM_QUALITY: cla.GEM_QUALITY, META_GEM_IDS: cla.META_GEM_IDS }).toEqual(golden.claSamples);
        expect(hash(cla)).toBe(golden.hashes.claData);
        expect(Object.keys(rpb)).toEqual(golden.rpbKeys);
        expect({ EXCLUDED_ENCOUNTER_ID: rpb.EXCLUDED_ENCOUNTER_ID, HASTE_RATING_PER_PERCENT: rpb.HASTE_RATING_PER_PERCENT, HASTE_BUFFS: rpb.HASTE_BUFFS }).toEqual(golden.rpbSamples);
        expect(hash(rpb)).toBe(golden.hashes.rpbData);
    });

    it("bosses, wowsims and the BiS sources read their moved files", () => {
        expect(bosses.bossIconUrl(601)).toBe(golden.bossIcon);
        expect(bosses.bossName(601)).toBe(golden.bossName);
        expect(bosses.ZONES).toHaveLength(golden.zones);
        expect(wowsims.item(28770)).toEqual(golden.wowsimsItem);
        expect([wowsims.ITEM_DB_VERSION, wowsims.BIS_VERSION]).toEqual(golden.wowsimsVersions);
        expect(wowsims.bisFor("Priest-Shadow", "t6")).toEqual(golden.wowsimsBis);
        expect(!!wowsims.aplFor("Priest-Shadow")).toBe(golden.apl);
        expect(bis.bisFor("Priest-Holy", "t6")).toEqual(golden.bisHoly);
        expect(bis.sourceFor("Priest-Holy")).toEqual(golden.bisSource);
        expect(bis.WOWHEAD_FETCHED_AT).toBe(golden.wowheadFetchedAt);
        expect(Object.keys(require("../../src/config/generated/mobIcons.json").choices || {})).toHaveLength(golden.mobChoicesCount);
    });
});
