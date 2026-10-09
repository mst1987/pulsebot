// Von Hand gesetzte Anwesenheit (#677): je Event und Discord-Konto ein Status mit Grund, wer und wann.
const { tempStoreFile, removeTempStores } = require("../helpers/tempStore");
const store = require("../../src/stores/attendanceOverridesStore");

beforeAll(() => store.useFile(tempStoreFile("attendance-overrides.json")));
afterAll(() => {
    store.useFile(null);
    removeTempStores();
});
beforeEach(() => {
    for (const [eventId, users] of Object.entries(store.listOverrides())) {
        for (const userId of Object.keys(users)) store.clearOverride(eventId, userId);
    }
});

describe("stores/attendanceOverridesStore", () => {
    it("merkt sich Status, Grund, wer und wann je Event und Konto", () => {
        const entry = store.setOverride("e1", "u1", { status: "bench", reason: "  hat gewartet ", by: "m1", byName: "Marc" }, { now: 42 });
        expect(entry).toEqual({ status: "bench", reason: "hat gewartet", by: "m1", byName: "Marc", at: 42 });
        expect(store.getOverride("e1", "u1")).toEqual(entry);
        expect(store.overridesForEvent("e1")).toEqual({ u1: entry });
        expect(store.getOverride("e1", "u2")).toBeNull();
        expect(store.overridesForEvent("nope")).toEqual({});
    });

    it("überschreibt einen zweiten Eintrag und setzt mit clearOverride auf Automatisch zurück", () => {
        store.setOverride("e1", "u1", { status: "bench" });
        store.setOverride("e1", "u1", { status: "noShow", reason: "doch nicht" });
        store.setOverride("e1", "u2", { status: "present" });
        expect(store.getOverride("e1", "u1")).toMatchObject({ status: "noShow", reason: "doch nicht" });
        expect(store.clearOverride("e1", "u1")).toBe(true);
        expect(store.clearOverride("e1", "u1")).toBe(false);
        expect(store.clearOverride("e1", "u2")).toBe(true);
        expect(store.listOverrides()).toEqual({});
    });

    it("lehnt unbekannte Status, fehlende Ids und zu lange Gründe ab", () => {
        expect(store.setOverride("e1", "u1", { status: "maybe" })).toEqual({ error: "invalid_status" });
        expect(store.setOverride("", "u1", { status: "bench" })).toEqual({ error: "bad_request" });
        expect(store.setOverride("e1", "", { status: "bench" })).toEqual({ error: "bad_request" });
        expect(store.setOverride("e1", "u1", { status: "bench", reason: "x".repeat(store.REASON_MAX + 1) })).toEqual({ error: "reason_too_long" });
        expect(store.setOverride("e1", "u1", { status: "bench", reason: "x".repeat(store.REASON_MAX) }).reason).toHaveLength(store.REASON_MAX);
        expect(store.STATUSES).toEqual(["present", "bench", "vacation", "absence", "noSignup", "noShow"]);
    });

    it("lässt beim Lesen kaputte Einträge weg", () => {
        const fs = require("fs");
        const file = tempStoreFile("broken.json");
        fs.writeFileSync(file, JSON.stringify({ overrides: { e1: { u1: { status: "bench" }, u2: { status: "??" }, u3: null }, e2: "x", e3: {} } }));
        store.useFile(file);
        try {
            expect(store.listOverrides()).toEqual({ e1: { u1: { status: "bench", reason: "", by: "", byName: "", at: 0 } } });
        } finally {
            store.useFile(tempStoreFile("attendance-overrides.json"));
        }
    });
});
