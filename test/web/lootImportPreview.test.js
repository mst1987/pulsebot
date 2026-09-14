jest.mock("../../src/web/lootStore", () => ({ listAll: jest.fn(() => []) }));
jest.mock("../../src/utils/wowhead");

const { listAll } = require("../../src/web/lootStore");
const { previewImport, detectFormat } = require("../../src/web/lootImportPreview");
const { EH_FORMAT } = require("../../src/utils/lootImport");

// 30105 = Serpent Spine Longbow (SSC), so the raid is resolved for real.
const row = (over = {}) => ({
    player: "Veyla-Thunderstrike", date: "2026/07/20", time: "21:03:00", id: "1784574268-1",
    itemID: 30105, response: "BiS", boss: "Lady Vashj", itemName: "Serpent Spine Longbow",
    servertime: "1784574268", ...over,
});
const RCLC = JSON.stringify([row(), row({ id: "1784574300-2", player: "Brokk-Thunderstrike", servertime: "1784574300" })]);

// 2026-07-20 20:00 Europe/Berlin, in seconds like Raid-Helper sends it.
const MONDAY = { id: "ev-mon", title: "Montagsraid – SSC", startTime: 1784570400, categoryId: "c1" };
const OTHER_DAY = { id: "ev-thu", title: "Donnerstag", startTime: 1784829600, categoryId: "c1" };

beforeEach(() => listAll.mockReturnValue([]));

describe("web/lootImportPreview", () => {
    describe("detectFormat", () => {
        it("follows parseLoot's auto-detection", () => {
            expect(detectFormat("[{}]")).toBe("rclc");
            expect(detectFormat(`{"format":"${EH_FORMAT}"}`)).toBe("eventhelper");
            expect(detectFormat("{\"x\":1}")).toBe("rclc");
            expect(detectFormat("dateTime,character,itemID")).toBe("gargul");
        });

        it("takes an explicit tool at its word", () => {
            expect(detectFormat("[{}]", "gargul")).toBe("gargul");
        });
    });

    it("counts the items, names the format and the raid", () => {
        const p = previewImport({ data: RCLC, events: [] });
        expect(p).toMatchObject({ ok: true, count: 2, format: "rclc", formatLabel: "RCLootcouncil" });
        expect(p.content.contentIds).toEqual(["ssc"]);
        expect(p.detectedAt).toBe(1784574268000);
    });

    it("suggests the event on the export's day and ignores the others", () => {
        const p = previewImport({ data: RCLC, events: [MONDAY, OTHER_DAY] });
        expect(p.match).toMatchObject({ ambiguous: false, suggested: { id: "ev-mon", title: "Montagsraid – SSC" } });
        expect(p.match.suggested.startTime).toBe(1784570400000);
        expect(p.targetEventId).toBe("ev-mon");
    });

    it("reports two raids on one day as ambiguous, with both candidates and no target", () => {
        const second = { ...MONDAY, id: "ev-pug", title: "Pug", startTime: 1784577600 };
        const p = previewImport({ data: RCLC, events: [MONDAY, second] });
        expect(p.match.ambiguous).toBe(true);
        expect(p.match.suggested).toBeNull();
        expect(p.match.candidates.map((c) => c.id)).toEqual(["ev-mon", "ev-pug"]);
        expect(p.targetEventId).toBe("");
    });

    it("counts rows the target event already holds, like the import's dedup", () => {
        listAll.mockReturnValue([
            { eventId: "ev-mon", source: "rclc", rawId: "1784574268-1" },
            // same row in another event does not collide
            { eventId: "ev-thu", source: "rclc", rawId: "1784574300-2" },
        ]);
        expect(previewImport({ data: RCLC, events: [MONDAY] }).duplicates).toBe(1);
        // an explicit pick wins over the date match
        expect(previewImport({ data: RCLC, event: "ev-thu", events: [MONDAY] })).toMatchObject({ targetEventId: "ev-thu", duplicates: 1 });
        // a hand-typed title has nothing stored to collide with
        expect(previewImport({ data: RCLC, event: "__manual__", events: [MONDAY] })).toMatchObject({ targetEventId: "", duplicates: 0 });
    });

    it("counts rows repeated inside the export itself", () => {
        const doubled = JSON.stringify([row(), row()]);
        expect(previewImport({ data: doubled, events: [MONDAY] }).duplicates).toBe(1);
    });

    it("answers unreadable or empty input with an error instead of throwing", () => {
        expect(previewImport({ data: "" })).toEqual({ ok: false, error: expect.any(String) });
        expect(previewImport({ data: "not json", tool: "rclc" })).toEqual({ ok: false, error: expect.any(String) });
    });
});
