jest.mock("../../src/utils/wowhead");
const wowhead = require("../../src/utils/wowhead");
const {
    parseLoot, parseRclc, parseGargul, parseEventHelper, parseEventHelperSessions,
    detectImportDate, enrichItemNames,
    splitPlayer, characterKey, itemLink, LootParseError, EH_FORMAT, EH_VERSION,
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

    describe("enrichItemNames", () => {
        afterEach(() => jest.clearAllMocks());

        it("fills name/icon for Gargul items missing both, looking up each id once", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 29992, name: "Sunhawk Leggings", iconUrl: "https://example/icon.jpg" });
            const items = parseGargul(GARGUL_CSV); // three rows, three distinct item ids
            await enrichItemNames(items);
            expect(items[0]).toMatchObject({ itemName: "Sunhawk Leggings", itemIconUrl: "https://example/icon.jpg" });
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(3); // three distinct item ids in the fixture
        });

        it("only looks up icons for RCLootcouncil items (name already known)", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 29920, name: "ignored", iconUrl: "https://example/ring.jpg" });
            const items = parseRclc(RCLC_JSON);
            await enrichItemNames(items);
            expect(items[0]).toMatchObject({ itemName: "Phoenix-Ring of Rebirth", itemIconUrl: "https://example/ring.jpg" });
        });

        it("dedupes lookups for repeated item ids", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 1, name: "X", iconUrl: "https://example/x.jpg" });
            const items = [
                { itemId: 1, itemName: "", itemIconUrl: "" },
                { itemId: 1, itemName: "", itemIconUrl: "" },
            ];
            await enrichItemNames(items);
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(1);
            expect(items[1]).toMatchObject({ itemName: "X", itemIconUrl: "https://example/x.jpg" });
        });

        it("leaves items untouched when the lookup fails (best-effort)", async () => {
            wowhead.lookupItem.mockResolvedValue(null);
            const items = [{ itemId: 5, itemName: "", itemIconUrl: "" }];
            await enrichItemNames(items);
            expect(items[0]).toMatchObject({ itemName: "", itemIconUrl: "" });
        });

        it("skips items that already have a name, an icon and a quality", async () => {
            const items = [{ itemId: 1, itemName: "Known", itemIconUrl: "https://example/known.jpg", itemQuality: 4 }];
            await enrichItemNames(items);
            expect(wowhead.lookupItem).not.toHaveBeenCalled();
        });

        it("looks a complete item up again when only its quality is missing", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 1, name: "ignored", iconUrl: "ignored", quality: 4 });
            const items = [{ itemId: 1, itemName: "Known", itemIconUrl: "https://example/known.jpg" }];
            await enrichItemNames(items);
            // name/icon stay as they were, only the missing quality is filled in
            expect(items[0]).toMatchObject({ itemName: "Known", itemIconUrl: "https://example/known.jpg", itemQuality: 4 });
        });

        it("fills the quality alongside name and icon", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 1, name: "X", iconUrl: "https://example/x.jpg", quality: 5 });
            const items = [{ itemId: 1, itemName: "", itemIconUrl: "" }];
            await enrichItemNames(items);
            expect(items[0].itemQuality).toBe(5);
        });

        it("keeps a resolved quality of 0 (poor) instead of re-looking it up", async () => {
            const items = [{ itemId: 1, itemName: "Grey", itemIconUrl: "https://example/g.jpg", itemQuality: 0 }];
            await enrichItemNames(items);
            expect(wowhead.lookupItem).not.toHaveBeenCalled();
        });

        it("leaves the quality unset when Wowhead reports none", async () => {
            wowhead.lookupItem.mockResolvedValue({ id: 1, name: "X", iconUrl: "https://example/x.jpg", quality: null });
            const items = [{ itemId: 1, itemName: "", itemIconUrl: "" }];
            await enrichItemNames(items);
            expect(items[0].itemQuality).toBeUndefined();
        });
    });

    describe("parseEventHelperSessions", () => {
        // Shaped exactly like what the addon writes: RCLootcouncil and Gargul
        // rows side by side in one session, both with a real unix timestamp.
        const payload = (over = {}) => ({
            format: EH_FORMAT,
            version: EH_VERSION,
            generatedAt: 1784580000,
            realm: "Thunderstrike",
            reporter: "Gemli-Thunderstrike",
            client: { addon: "1.0.0", sync: "1.0.0" },
            sessions: [{
                sessionId: "eh-1784574000-ssc",
                startedAt: 1784574000,
                endedAt: 1784581200,
                instance: "Serpentshrine Cavern",
                items: [
                    {
                        source: "rclc", rawId: "1784574268-1", itemId: 29920,
                        itemName: "Phoenix-Ring of Rebirth", player: "Naphfß-Thunderstrike",
                        class: "SHAMAN", response: "Off Spec", offspec: true,
                        boss: "Lady Vashj", instance: "Serpentshrine Cavern",
                        note: "for pvp", replacedGear: ["[Ancestral Ring of Conquest]", ""],
                        awardedAt: 1784574268, awardedBy: "Gemli-Thunderstrike",
                    },
                    {
                        source: "gargul", rawId: "abc123checksum", itemId: 30242,
                        itemName: "", player: "Keslight", class: "paladin",
                        response: "Main Spec", offspec: false, awardedAt: 1784574375,
                        awardedBy: "Gemli-Thunderstrike", gdkpCost: 15000,
                    },
                ],
            }],
            ...over,
        });

        it("reads the envelope's metadata", () => {
            const { meta } = parseEventHelperSessions(JSON.stringify(payload()));
            expect(meta).toMatchObject({
                version: 1, realm: "Thunderstrike", reporter: "Gemli-Thunderstrike",
                addonVersion: "1.0.0", syncVersion: "1.0.0",
            });
            expect(meta.generatedAt).toBe(1784580000 * 1000);
        });

        it("accepts an already-parsed object as well as a JSON string", () => {
            expect(parseEventHelperSessions(payload()).sessions).toHaveLength(1);
        });

        it("converts session times from unix seconds to ms", () => {
            const [s] = parseEventHelperSessions(payload()).sessions;
            expect(s).toMatchObject({
                sessionId: "eh-1784574000-ssc",
                startedAt: 1784574000 * 1000,
                endedAt: 1784581200 * 1000,
                instance: "Serpentshrine Cavern",
            });
        });

        it("normalizes an RCLootcouncil row to the shared loot shape", () => {
            const [s] = parseEventHelperSessions(payload()).sessions;
            expect(s.items[0]).toEqual({
                source: "rclc", rawId: "1784574268-1", itemId: 29920,
                itemName: "Phoenix-Ring of Rebirth", itemIconUrl: "",
                itemLink: "https://www.wowhead.com/tbc/item=29920",
                player: "Naphfß-Thunderstrike", character: "Naphfß", characterKey: "naphfß",
                realm: "Thunderstrike", class: "SHAMAN", response: "Off Spec", offspec: true,
                boss: "Lady Vashj", instance: "Serpentshrine Cavern", note: "for pvp",
                replacedGear: ["[Ancestral Ring of Conquest]"],
                awardedAt: 1784574268 * 1000, awardedBy: "Gemli-Thunderstrike",
            });
        });

        // The whole reason the addon exists: Gargul's own CSV has a date but no
        // time of day, which makes matching a raid night guesswork.
        it("gives a Gargul row a real timestamp and a resolvable character", () => {
            const [s] = parseEventHelperSessions(payload()).sessions;
            expect(s.items[1]).toMatchObject({
                source: "gargul", rawId: "abc123checksum", itemId: 30242,
                character: "Keslight", characterKey: "keslight", realm: "",
                class: "paladin", offspec: false, awardedAt: 1784574375 * 1000,
            });
        });

        // The source is kept so an addon upload and a hand-pasted export of the
        // same award collapse into one item instead of appearing twice.
        it("keeps the originating addon as the item's source", () => {
            const [s] = parseEventHelperSessions(payload()).sessions;
            expect(s.items.map((i) => i.source)).toEqual(["rclc", "gargul"]);
        });

        it("marks a row from an unknown addon rather than trusting the label", () => {
            const data = payload();
            data.sessions[0].items = [{ ...data.sessions[0].items[0], source: "somethingelse" }];
            expect(parseEventHelper(data)[0].source).toBe("eventhelper");
        });

        it("carries fields the app does not use yet without choking", () => {
            // gdkpCost rides along in the wire format; the parser simply drops it.
            expect(parseEventHelper(payload())[1]).not.toHaveProperty("gdkpCost");
        });

        it("falls back to the response text when the offspec flag is missing", () => {
            const data = payload();
            data.sessions[0].items = [{
                source: "rclc", rawId: "x", itemId: 1, player: "Foo", response: "Off Spec",
            }];
            expect(parseEventHelper(data)[0].offspec).toBe(true);
        });

        it("synthesizes a rawId when a row has none, so dedup still works", () => {
            const data = payload();
            data.sessions[0].items = [{ source: "rclc", itemId: 7, player: "Foo", awardedAt: 42 }];
            expect(parseEventHelper(data)[0].rawId).toBe("7-42-Foo");
        });

        it("drops rows without an item id or a player instead of storing junk", () => {
            const data = payload();
            data.sessions[0].items = [
                { source: "rclc", rawId: "a", player: "Foo" },
                { source: "rclc", rawId: "b", itemId: 5, player: "" },
                { source: "rclc", rawId: "c", itemId: 5, player: "Ok" },
                null,
            ];
            expect(parseEventHelper(data).map((i) => i.rawId)).toEqual(["c"]);
        });

        it("tolerates a session without items", () => {
            const data = payload();
            data.sessions[0].items = undefined;
            expect(parseEventHelperSessions(data).sessions[0].items).toEqual([]);
        });

        describe("rejects what it cannot trust", () => {
            it("refuses text that is not JSON", () => {
                expect(() => parseEventHelperSessions("nope")).toThrow(LootParseError);
            });

            it("refuses another tool's JSON", () => {
                expect(() => parseEventHelperSessions(RCLC_JSON)).toThrow(/Kein EventHelper-Addon-Export/);
            });

            // Silently importing half a payload would lose loot without saying so.
            it("refuses a payload from a newer addon than it understands", () => {
                expect(() => parseEventHelperSessions(payload({ version: EH_VERSION + 1 })))
                    .toThrow(/neueren Addon-Version/);
            });

            it("accepts an older version", () => {
                expect(parseEventHelperSessions(payload({ version: 1 })).sessions).toHaveLength(1);
            });

            it("refuses a payload without a session list", () => {
                expect(() => parseEventHelperSessions(payload({ sessions: "nope" })))
                    .toThrow(/sessions/);
            });
        });

        describe("via parseLoot", () => {
            it("auto-detects the envelope and flattens it", () => {
                const items = parseLoot(JSON.stringify(payload()));
                expect(items).toHaveLength(2);
                expect(items[0].itemId).toBe(29920);
            });

            it("still auto-detects RCLootcouncil's array and Gargul's csv", () => {
                expect(parseLoot(RCLC_JSON)).toHaveLength(2);
                expect(parseLoot(GARGUL_CSV).length).toBeGreaterThan(0);
            });

            it("can be asked for the format explicitly", () => {
                expect(parseLoot(JSON.stringify(payload()), "eventhelper")).toHaveLength(2);
            });
        });

        // detectImportDate drives the date match, so it must see the addon's
        // precise timestamps rather than a midnight-rounded Gargul date.
        it("feeds detectImportDate a real award time", () => {
            expect(detectImportDate(parseEventHelper(payload()))).toBe(1784574268 * 1000);
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
