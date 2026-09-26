// Das Kanal-Archiv (Issue #259). Schreibt auf Platte, deshalb läuft der Test
// gegen die echte Datei und räumt sie danach wieder weg.
const store = require("../../src/stores/channelArchiveStore");

const DAY = 86400000;

afterEach(() => store.reset());

describe("stores/channelArchiveStore", () => {
    it("starts with no archive and a 14-day deadline", () => {
        expect(store.getChannelConfig("g1")).toEqual({ archiveCategoryId: "", schemas: {}, archiveDeleteHintDays: 14 });
    });

    it("keeps the archive category per server and the deadline for all", () => {
        store.saveChannelConfig("g1", { archiveCategoryId: "arch1", archiveDeleteHintDays: 7 });
        store.saveChannelConfig("g2", { archiveCategoryId: "arch2" });
        expect(store.getChannelConfig("g1")).toMatchObject({ archiveCategoryId: "arch1", archiveDeleteHintDays: 7 });
        expect(store.getChannelConfig("g2")).toMatchObject({ archiveCategoryId: "arch2", archiveDeleteHintDays: 7 });
    });

    it("clamps a deadline nobody could mean", () => {
        expect(store.normalizeHintDays("abc")).toBe(14);
        expect(store.normalizeHintDays(0)).toBe(14);
        expect(store.normalizeHintDays(9999)).toBe(365);
    });

    it("remembers a naming schema per category", () => {
        store.saveCategorySchema("g1", "cat-mi", { schema: "{tag}-{raid}", raid: "ssc-tk", templateChannelId: "tpl" });
        expect(store.getChannelConfig("g1").schemas["cat-mi"]).toEqual({ schema: "{tag}-{raid}", raid: "ssc-tk", templateChannelId: "tpl" });
        expect(store.saveCategorySchema("g1", "", {})).toBeNull();
    });

    it("remembers the event time of a category and keeps it when a save leaves it out", () => {
        store.saveCategorySchema("g1", "cat-do", { schema: "{tag}", raid: "", templateChannelId: "", time: "19:30" });
        expect(store.getChannelConfig("g1").schemas["cat-do"].time).toBe("19:30");
        store.saveCategorySchema("g1", "cat-do", { schema: "{tag}-{raid}", raid: "bt" });
        expect(store.getChannelConfig("g1").schemas["cat-do"]).toEqual({ schema: "{tag}-{raid}", raid: "bt", templateChannelId: "", time: "19:30" });
    });

    it("logs who archived what, and forgets it again", () => {
        store.recordArchived({ channelId: "c1", guildId: "g1", name: "mi-kara", fromCategory: "Mittwoch", by: "u1", byName: "Nerathil", at: 1000 });
        store.recordArchived({ channelId: "c2", guildId: "g2", name: "other", at: 2000 });
        expect(store.listArchived("g1")).toEqual([expect.objectContaining({ channelId: "c1", byName: "Nerathil", fromCategory: "Mittwoch" })]);
        expect(store.forgetArchived(["c1", "nope"])).toBe(1);
        expect(store.listArchived("g1")).toEqual([]);
    });

    describe("archiveHint", () => {
        const now = 100 * DAY;

        it("counts what waits in the archive and flags it after the deadline", () => {
            const hint = store.archiveHint({
                archived: [{ id: "old", name: "alt" }, { id: "new", name: "neu" }, { id: "hand", name: "von-hand" }],
                entries: [{ channelId: "old", at: now - 20 * DAY, byName: "Nerathil" }, { channelId: "new", at: now - 2 * DAY }],
                hintDays: 14,
                now,
            });
            expect(hint).toMatchObject({ count: 3, overdue: 1, hintDays: 14 });
            expect(hint.rows.map((r) => [r.id, r.waitingDays, r.overdue])).toEqual([["old", 20, true], ["new", 2, false], ["hand", null, false]]);
            expect(hint.rows[0].by).toBe("Nerathil");
        });

        it("counts nothing when the archive is empty — an entry alone is not a waiting channel", () => {
            expect(store.archiveHint({ archived: [], entries: [{ channelId: "gone", at: 0 }], now })).toMatchObject({ count: 0, overdue: 0 });
        });
    });
});
