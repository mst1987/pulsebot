// Wer nicht mehr im Roster steht. Schreibt auf Platte, deshalb läuft der Test
// gegen ein echtes, danach wieder geleertes Verzeichnis.
const store = require("../../src/web/rosterHiddenStore");

afterEach(() => store.reset());

describe("web/rosterHiddenStore", () => {
    it("merkt sich Grund, Zeitpunkt und Urheber, damit die Entscheidung lesbar bleibt", () => {
        const entry = store.hide("Devihra", { reason: "Gilde verlassen", by: "Raidlead" });
        expect(entry).toMatchObject({ character: "Devihra", reason: "Gilde verlassen", by: "Raidlead" });
        expect(entry.at).toBeGreaterThan(0);
        expect(store.isHidden("Devihra")).toBe(true);
    });

    it("erkennt denselben Charakter mit und ohne Realm", () => {
        store.hide("Devihra-Thunderstrike");
        expect(store.isHidden("devihra")).toBe(true);
        expect([...store.hiddenKeys()]).toEqual(["devihra"]);
    });

    it("blendet jemanden wieder ein", () => {
        store.hide("Devihra");
        expect(store.unhide("Devihra")).toBe(true);
        expect(store.isHidden("Devihra")).toBe(false);
        // Zweimal einblenden ist kein Fehler, ändert aber nichts.
        expect(store.unhide("Devihra")).toBe(false);
    });

    it("frischt einen zweiten Aufruf auf, statt zu meckern", () => {
        store.hide("Devihra", { reason: "Pause" });
        const again = store.hide("Devihra", { reason: "Gilde verlassen" });
        expect(again.reason).toBe("Gilde verlassen");
        expect(Object.keys(store.listHidden())).toHaveLength(1);
    });

    it("ignoriert einen leeren Namen", () => {
        expect(store.hide("   ")).toBeNull();
        expect(store.unhide("")).toBe(false);
        expect(store.listHidden()).toEqual({});
    });

    it("liefert ein leeres Ergebnis, wenn noch nie jemand ausgeblendet wurde", () => {
        expect(store.listHidden()).toEqual({});
        expect(store.isHidden("Devihra")).toBe(false);
    });
});
