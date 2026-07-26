const {
    parseLoot, parseRclc, parseGargul, detectImportDate,
    splitPlayer, characterKey, itemLink, LootParseError,
} = require("../../src/utils/lootImport");

// Real rows taken (trimmed) from the actual exports on the server.
const RCLC_JSON = JSON.stringify([
    {
        player: "Naphfß-Thunderstrike", date: "2026/07/20", time: "21:03:00", id: "1784574268-1",
        itemID: 29920, itemString: "item:29920::::::::70", response: "Off Spec", votes: 1, class: "SHAMAN",
        instance: "Coilfang: Serpentshrine Cavern-25 Player", boss: "Lady Vashj",
        gear1: "[Ancestral Ring of Conquest]", gear2: "[Ring of a Thousand Marks]", responseID: "4",
        equipLoc: "Finger", note: "", owner: "Gemli-Thunderstrike", itemName: "Phoenix-Ring of Rebirth",
        servertime: "1784574268",
    },
    {
        player: "Keslight-Thunderstrike", date: "2026/07/20", time: "21:05:00", id: "1784574375-3",
        itemID: 30242, response: "BIS", votes: 0, class: "PALADIN", boss: "Lady Vashj",
        gear1: "", gear2: "", responseID: "1", note: "", owner: "Gemli-Thunderstrike",
        itemName: "Helm of the Vanquished Champion", servertime: "1784574375",
    },
]);

const GARGUL_CSV = `dateTime,character,itemID,offspec,id
2026-07-12,Bultros,29992,0,20274180691660901890
2026-07-12,Cosma,32267,1,12851790643566350554
2026-07-12,Talisíen,30236,0,41708589713375484164`;

describe("utils/lootImport", () => {
    describe("splitPlayer", () => {
        it("splits a realm-qualified name on the first dash", () => {
            expect(splitPlayer("Naphfß-Thunderstrike")).toEqual({
                player: "Naphfß-Thunderstrike", character: "Naphfß", realm: "Thunderstrike",
            });
        });
        it("leaves a bare Gargul name without a realm", () => {
            expect(splitPlayer("Bultros")).toEqual({ player: "Bultros", character: "Bultros", realm: "" });
        });
    });

    describe("characterKey", () => {
        it("lowercases for case-insensitive grouping", () => {
            expect(characterKey("Naphfß")).toBe(characterKey("naphfß"));
        });
    });

    describe("itemLink", () => {
        it("builds a TBC wowhead link from an item id", () => {
            expect(itemLink(29920)).toBe("https://www.wowhead.com/tbc/item=29920");
            expect(itemLink(null)).toBe("");
        });
    });

    describe("parseRclc", () => {
        it("parses the RCLootcouncil JSON into normalized loot items", () => {
            const items = parseRclc(RCLC_JSON);
            expect(items).toHaveLength(2);
            const first = items[0];
            expect(first).toMatchObject({
                source: "rclc",
                rawId: "1784574268-1",
                itemId: 29920,
                itemName: "Phoenix-Ring of Rebirth",
                itemLink: "https://www.wowhead.com/tbc/item=29920",
                player: "Naphfß-Thunderstrike",
                character: "Naphfß",
                characterKey: "naphfß",
                realm: "Thunderstrike",
                class: "SHAMAN",
                response: "Off Spec",
                offspec: true,
                boss: "Lady Vashj",
                awardedBy: "Gemli-Thunderstrike",
            });
            // servertime (seconds) → ms
            expect(first.awardedAt).toBe(1784574268 * 1000);
            // gear brackets stripped
            expect(first.replacedGear).toEqual(["Ancestral Ring of Conquest", "Ring of a Thousand Marks"]);
        });

        it("treats responseID 1 (BIS) as main spec", () => {
            const items = parseRclc(RCLC_JSON);
            expect(items[1]).toMatchObject({ character: "Keslight", offspec: false, response: "BIS" });
        });

        it("throws a friendly error on non-JSON input", () => {
            expect(() => parseRclc("not json at all")).toThrow(LootParseError);
        });

        it("throws when the JSON is not a list of entries", () => {
            expect(() => parseRclc("{\"foo\":1}")).toThrow(LootParseError);
        });
    });

    describe("parseGargul", () => {
        it("parses the Gargul CSV into normalized loot items", () => {
            const items = parseGargul(GARGUL_CSV);
            expect(items).toHaveLength(3);
            expect(items[0]).toMatchObject({
                source: "gargul",
                rawId: "20274180691660901890",
                itemId: 29992,
                itemName: "",
                player: "Bultros",
                character: "Bultros",
                characterKey: "bultros",
                realm: "",
                offspec: false,
                response: "Main Spec",
                awardedBy: "",
            });
            // date-only → UTC midnight ms
            expect(items[0].awardedAt).toBe(Date.parse("2026-07-12T00:00:00Z"));
        });

        it("maps the offspec flag to Off Spec / Main Spec", () => {
            const items = parseGargul(GARGUL_CSV);
            expect(items.find((i) => i.character === "Cosma")).toMatchObject({ offspec: true, response: "Off Spec" });
            expect(items.find((i) => i.character === "Talisíen")).toMatchObject({ offspec: false, response: "Main Spec" });
        });

        it("is robust to column order and skips rows without item/char", () => {
            const csv = "id,offspec,character,itemID,dateTime\nX1,1,Foo,123,2026-07-12\n,,,, \nX2,0,,555,2026-07-12";
            const items = parseGargul(csv);
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({ rawId: "X1", character: "Foo", itemId: 123, offspec: true });
        });

        it("throws when a required column is missing", () => {
            expect(() => parseGargul("date,item\n2026-07-12,123")).toThrow(LootParseError);
        });

        it("throws on an empty export", () => {
            expect(() => parseGargul("   ")).toThrow(LootParseError);
        });
    });

    describe("parseLoot (dispatch / auto-detect)", () => {
        it("routes explicitly by tool", () => {
            expect(parseLoot(RCLC_JSON, "rclc")).toHaveLength(2);
            expect(parseLoot(GARGUL_CSV, "gargul")).toHaveLength(3);
        });
        it("auto-detects JSON as rclc and CSV as gargul", () => {
            expect(parseLoot(RCLC_JSON, "auto")[0].source).toBe("rclc");
            expect(parseLoot(GARGUL_CSV)[0].source).toBe("gargul");
        });
    });

    describe("detectImportDate", () => {
        it("picks the earliest awarded timestamp", () => {
            const items = parseRclc(RCLC_JSON);
            expect(detectImportDate(items)).toBe(1784574268 * 1000);
        });

        it("ignores items without a usable timestamp", () => {
            const items = [{ awardedAt: 0 }, { awardedAt: 5000 }, {}];
            expect(detectImportDate(items)).toBe(5000);
        });

        it("returns null when nothing has a timestamp", () => {
            expect(detectImportDate([{ awardedAt: 0 }, {}])).toBeNull();
            expect(detectImportDate([])).toBeNull();
            expect(detectImportDate(null)).toBeNull();
        });
    });
});
