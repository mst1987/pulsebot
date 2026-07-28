jest.mock("axios");
const axios = require("axios");
const softres = require("../../src/utils/softres");

afterEach(() => jest.clearAllMocks());

describe("utils/softres", () => {
    describe("parseInstancesFromTitle", () => {
        it("derives TBC instances from a compound title", () => {
            expect(softres.parseInstancesFromTitle("Kara + Gruul").map((i) => i.code)).toEqual(["kara", "gruul"]);
            expect(softres.parseInstancesFromTitle("SSC/TK Progress").map((i) => i.code)).toEqual(["ssc", "tempestkeep"]);
            expect(softres.parseInstancesFromTitle("BT & Hyjal").map((i) => i.code)).toEqual(["blacktemple", "hyjal"]);
        });

        it("matches classic raids and keeps a single edition", () => {
            expect(softres.parseInstancesFromTitle("MC BWL Ony", "classic").map((i) => i.code)).toEqual(["mc", "bwl", "onyxia"]);
        });

        it("does not false-match abbreviations inside longer words", () => {
            // "mc" must not match inside "Mechanar"
            expect(softres.parseInstancesFromTitle("Mechanar Heroic")).toEqual([]);
        });

        it("returns [] for an empty or unknown title", () => {
            expect(softres.parseInstancesFromTitle("")).toEqual([]);
            expect(softres.parseInstancesFromTitle("Random Dungeon Night")).toEqual([]);
        });

        it("restricts to a single edition when a preference is given", () => {
            const out = softres.parseInstancesFromTitle("Naxx run", "classic");
            expect(out.every((i) => i.edition === "classic")).toBe(true);
        });
    });

    describe("instancesForEdition", () => {
        it("no longer lists the combined dungeons — multi-select checkboxes cover that", () => {
            const codes = softres.instancesForEdition("tbc").map((i) => i.code);
            expect(codes).not.toContain("gruulmag");
            expect(codes).not.toContain("ssctempestkeep");
            expect(codes).not.toContain("bthyjal");
            // the standalone instances are still there individually
            expect(codes).toEqual(expect.arrayContaining(["gruul", "magtheridon", "ssc", "tempestkeep", "blacktemple", "hyjal"]));
        });
    });

    describe("editionOf / nameOf", () => {
        it("resolves known codes", () => {
            expect(softres.editionOf("kara")).toBe("tbc");
            expect(softres.editionOf("mc")).toBe("classic");
            expect(softres.nameOf("kara")).toBe("Karazhan");
        });
        it("degrades gracefully for unknown codes", () => {
            expect(softres.editionOf("nope")).toBe("");
            expect(softres.nameOf("nope")).toBe("nope");
        });
        it("uses the short form for the long-named TBC raids", () => {
            expect(softres.nameOf("ssc")).toBe("SSC");
            expect(softres.nameOf("tempestkeep")).toBe("TK");
        });
    });

    describe("targetSizeForInstances", () => {
        it("takes the largest slot count among the chosen instances, not the sum", () => {
            expect(softres.targetSizeForInstances(["gruul", "magtheridon"])).toBe(25);
            expect(softres.targetSizeForInstances(["kara"])).toBe(10);
        });
        it("ignores unknown codes and returns 0 when nothing is known", () => {
            expect(softres.targetSizeForInstances(["nope"])).toBe(0);
            expect(softres.targetSizeForInstances([])).toBe(0);
            expect(softres.targetSizeForInstances()).toBe(0);
        });
    });

    describe("buildItemNotes", () => {
        it("maps hard reserves to softres itemNotes and drops invalid ids", () => {
            const notes = softres.buildItemNotes([
                { id: 28830, raider: "Tank" },
                { id: "0" },
                { id: "abc" },
                { id: 12345, note: "Guild bank" },
            ]);
            expect(notes).toEqual([
                { id: 28830, hardReserved: true, raider: "Tank", note: "", roles: [], specs: [], ignoreClassRestrict: false },
                { id: 12345, hardReserved: true, raider: "", note: "Guild bank", roles: [], specs: [], ignoreClassRestrict: false },
            ]);
        });
    });

    describe("buildCreatePayload", () => {
        it("clamps amount to 1..6 and normalises instances", () => {
            const p = softres.buildCreatePayload({ instances: ["kara", "kara", " gruul "], edition: "tbc", amount: 99, faction: "Alliance" });
            expect(p.instances).toEqual(["kara", "gruul"]);
            expect(p.amount).toBe(6);
            expect(p.faction).toBe("Alliance");
            expect(p.reserved).toEqual([]);
        });

        it("defaults amount to 1 when missing", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde" }).amount).toBe(1);
        });

        it("requires Discord authentication by default and lets the caller opt out", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde" }).discord).toBe(true);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", discord: true }).discord).toBe(true);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", discord: false }).discord).toBe(false);
        });

        it("rejects an empty instance list", () => {
            expect(() => softres.buildCreatePayload({ instances: [], faction: "Alliance" })).toThrow("Instanz");
        });

        it("rejects an invalid faction", () => {
            expect(() => softres.buildCreatePayload({ instances: ["kara"], faction: "alliance" })).toThrow("Fraktion");
            expect(() => softres.buildCreatePayload({ instances: ["kara"], faction: "" })).toThrow("Fraktion");
        });
    });

    describe("createRaid", () => {
        it("posts the payload and returns view + edit URLs", async () => {
            axios.post.mockResolvedValue({ data: { raidId: "abc123", token: "secret9" } });
            const res = await softres.createRaid({ instances: ["kara"], edition: "tbc", amount: 2, faction: "Alliance" });
            expect(axios.post).toHaveBeenCalledWith(
                "https://softres.it/api/raid/create",
                expect.objectContaining({ instances: ["kara"], amount: 2, faction: "Alliance" }),
                expect.objectContaining({ timeout: 45000 })
            );
            expect(res).toEqual({
                raidId: "abc123",
                token: "secret9",
                url: "https://softres.it/raid/abc123",
                editUrl: "https://softres.it/raid/abc123/secret9",
            });
        });

        it("throws with the validation detail when softres rejects the request", async () => {
            axios.post.mockResolvedValue({ data: { code: 4, error: { details: [{ message: "\"faction\" must be a string" }] } } });
            await expect(softres.createRaid({ instances: ["kara"], faction: "Alliance" }))
                .rejects.toThrow("faction");
        });
    });
});
