// Version-aware content recognition (#749): a Forever raid is never claimed by
// the TBC tables, a TBC raid reads exactly as before.
const raidContent = require("../../src/config/raidContent");
const tbcContent = require("../../src/config/tbcContent");
const { VERSIONS, instanceById, iconOf } = require("../../src/config/gameVersions");

describe("config/raidContent", () => {
    describe("contentsForText", () => {
        it("reads Hyjal Summit (Forever) as Forever's Hyjal in a Forever event", () => {
            expect(raidContent.contentsForText("Hyjal Summit (Forever)", { versionId: "forever" })).toEqual(["forever-hyjal"]);
            expect(raidContent.contentsForText("Mittwoch Hyjal", { versionId: "forever" })).toEqual(["forever-hyjal"]);
        });

        it("reads the same text as TBC's Hyjal in a TBC event, exactly like tbcContent", () => {
            for (const t of ["Hyjal + BT", "SSC/TK Farm", "Kara", "Debt collection", "Sunwell"]) {
                expect(raidContent.contentsForText(t, { versionId: "tbc" })).toEqual(tbcContent.contentsForText(t));
                expect(raidContent.contentsForText(t)).toEqual(tbcContent.contentsForText(t));
            }
            expect(raidContent.contentsForText("Hyjal", { versionId: "tbc" })).toEqual(["hyjal"]);
        });

        it("keeps a TBC pattern out of the other versions", () => {
            expect(raidContent.contentsForText("Karazhan", { versionId: "forever" })).toEqual([]);
            expect(raidContent.contentsForText("Hyjal", { versionId: "classic" })).toEqual([]);
        });

        it("treats a text naming Forever as Forever when no version is known", () => {
            expect(raidContent.contentsForText("Hyjal Summit (Forever)")).toEqual(["forever-hyjal"]);
        });

        it("finds Classic raids by zone name and short, only in Classic", () => {
            expect(raidContent.contentsForText("Molten Core", { versionId: "classic" })).toEqual(["mc"]);
            expect(raidContent.contentsForText("MC + BWL", { versionId: "classic" })).toEqual(["mc", "bwl"]);
            expect(raidContent.contentsForText("Molten Core", { versionId: "tbc" })).toEqual([]);
        });

        it("returns [] for empty text and falls back to TBC for an unknown version", () => {
            expect(raidContent.contentsForText("", { versionId: "forever" })).toEqual([]);
            expect(raidContent.contentsForText("Kara", { versionId: "nope" })).toEqual(["kara"]);
        });
    });

    describe("contentForBoss", () => {
        it("places Archimonde per version", () => {
            expect(raidContent.contentForBoss("Archimonde", { versionId: "forever" })).toBe("forever-hyjal");
            expect(raidContent.contentForBoss("Archimonde", { versionId: "tbc" })).toBe("hyjal");
            expect(raidContent.contentForBoss("Archimonde")).toBe("hyjal");
        });

        it("keeps Onyxia in Classic and Forever apart", () => {
            expect(raidContent.contentForBoss("Onyxia", { versionId: "classic" })).toBe("ony");
            expect(raidContent.contentForBoss("Onyxia", { versionId: "forever" })).toBe("forever-ony");
            expect(raidContent.contentForBoss("Onyxia", { versionId: "tbc" })).toBe("");
        });
    });

    describe("contentForInstance", () => {
        it("reads a zone within the version", () => {
            expect(raidContent.contentForInstance("Hyjal Summit (Forever)", { versionId: "forever" })).toBe("forever-hyjal");
            expect(raidContent.contentForInstance("Hyjal Summit", { versionId: "tbc" })).toBe("hyjal");
            expect(raidContent.contentForInstance("Serpentshrine Cavern-25 Player", { versionId: "forever" })).toBe("");
        });
    });

    describe("contentForLoot / sourceForItem", () => {
        it("uses the item table for TBC only", () => {
            const item = { itemId: 30280, instance: "Hyjal Summit" };
            expect(raidContent.contentForLoot(item, { versionId: "tbc" })).toEqual(tbcContent.contentForLoot(item));
            expect(raidContent.contentForLoot(item, { versionId: "forever" }).contentId).toBe("forever-hyjal");
            expect(raidContent.sourceForItem(30280, { versionId: "forever" })).toBeNull();
        });
    });

    describe("content / iconOf / contentsOf", () => {
        it("describes a content of any version", () => {
            expect(raidContent.content("hyjal").short).toBe("Hyjal");
            expect(raidContent.content("forever-hyjal")).toMatchObject({ label: "Hyjal Summit (Forever)", short: "Hyjal F" });
            expect(raidContent.content("nope")).toBeNull();
            expect(raidContent.iconOf("forever-hyjal")).toBe(instanceById("forever-hyjal").icon);
            expect(raidContent.contentsOf("forever").map((c) => c.id)).toEqual(["forever-barrow", "forever-hyjal", "forever-ony"]);
        });
    });

    describe("versionsOfContent — which versions a raid could be from", () => {
        it("knows SSC, TK, Gruul and Magtheridon as TBC only", () => {
            for (const id of ["ssc", "tk", "gruul", "mag", "kara", "bt"]) expect(raidContent.versionsOfContent(id)).toEqual(["tbc"]);
        });

        it("names every version a raid of the same name or bosses exists in, its own first", () => {
            expect(raidContent.versionsOfContent("hyjal")).toEqual(["tbc", "forever"]);
            expect(raidContent.versionsOfContent("forever-hyjal")).toEqual(["forever", "tbc"]);
            expect(raidContent.versionsOfContent("forever-ony")).toEqual(["forever", "classic"]);
            expect(raidContent.versionsOfContent("mc")).toEqual(["classic"]);
            expect(raidContent.versionsOfContent("forever-barrow")).toEqual(["forever"]);
        });

        it("knows no version for an unknown id", () => {
            expect(raidContent.versionsOfContent("nope")).toEqual([]);
            expect(raidContent.versionsOfContent("")).toEqual([]);
        });
    });

    it("gives every instance of every version an icon", () => {
        for (const v of VERSIONS) {
            for (const i of v.instances) {
                expect({ id: i.id, icon: iconOf(i.id) }).toEqual({ id: i.id, icon: expect.stringMatching(/^[\w'-]+$/) });
            }
        }
    });
});
