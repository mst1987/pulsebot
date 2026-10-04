// Die Discord-Bausteine der Ab-/Anwesenheiten (src/utils/signup/availabilityDialog.js):
// customIds, Panel, Modal, Auswahl, Liste, Sitzungen.
const profiles = require("../../../src/stores/raiderProfileStore");
const dialog = require("../../../src/utils/signup/availabilityDialog");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const embedOf = (payload) => payload.embeds[0].data || payload.embeds[0];
const ids = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data.custom_id));

beforeAll(() => profiles.useFile(tempStoreFile("eh-availability-dialog.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => profiles.reset());

describe("customIds", () => {
    it("trennt Panel-Knöpfe und Auswahl-Schritte", () => {
        expect(dialog.parseId("availability:a:cat1")).toEqual({ token: "", action: "a", categoryId: "cat1" });
        expect(dialog.parseId("availability:l:")).toEqual({ token: "", action: "l", categoryId: "" });
        expect(dialog.parseId("availability:0a1b2c3d:save")).toEqual({ token: "0a1b2c3d", action: "save", categoryId: "" });
    });

    it("hält Sitzungen nur für den Raider, der sie begonnen hat, und nur 30 Minuten", () => {
        const token = dialog.createSession(ANNA, { kind: "absence" }, 1000);
        expect(dialog.getSession(token, "someone", 1000)).toBeNull();
        expect(dialog.getSession(token, ANNA, 2000)).toMatchObject({ kind: "absence", selected: null });
        expect(dialog.getSession(token, ANNA, 2000 + 31 * 60 * 1000)).toBeNull();
        dialog.endSession(token);
        expect(dialog.getSession(token, ANNA, 2000)).toBeNull();
    });
});

describe("Panel und Modal", () => {
    it("das Panel nennt die Kategorie und trägt drei Knöpfe", () => {
        const payload = dialog.panelPayload({ categoryId: "cat1", categoryName: "Raids TBC" });
        expect(embedOf(payload).title).toBe("Absence & attendance · Raids TBC");
        expect(embedOf(payload).description).toContain("every **Raids TBC** raid");
        expect(ids(payload)).toEqual(["availability:a:cat1", "availability:p:cat1", "availability:l:cat1"]);
        expect(embedOf(dialog.panelPayload()).title).toBe("Absence & attendance");
    });

    it("das Modal fragt den Zeitraum, bei der Abwesenheit auch den Grund", () => {
        const absence = dialog.periodModal("absence", "cat1").toJSON();
        expect(absence.custom_id).toBe("availability:ma:cat1");
        expect(absence.components.map((r) => r.components[0].custom_id)).toEqual(["from", "to", "reason"]);
        const presence = dialog.periodModal("presence").toJSON();
        expect(presence.custom_id).toBe("availability:mp:");
        expect(presence.components.map((r) => r.components[0].custom_id)).toEqual(["from", "to"]);
    });
});

describe("Charaktere", () => {
    beforeEach(() => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }, { key: "Priest-Shadow", gear: "none" }] });
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Mage", versionId: "forever", specs: [{ key: "Mage-Arcane", gear: "usable" }] });
    });

    it("bietet jede Spec mit brauchbarem Gear an, auf Versionen beschränkbar", () => {
        const profile = profiles.getProfile(ANNA);
        expect(dialog.characterOptions(profile).map((o) => o.label)).toEqual(["Zibbo · Holy", "Devi Res · Arcane"]);
        expect(dialog.characterOptions(profile, ["forever"]).map((o) => o.key)).toEqual(["forever~devi res"]);
    });

    it("schlägt den ersten Charakter der Version vor", () => {
        const profile = profiles.getProfile(ANNA);
        expect(dialog.defaultCharacter(profile, "forever").character).toBe("Devi Res");
        expect(dialog.defaultCharacter(profile, "tbc", ["tbc"]).character).toBe("Zibbo");
        expect(dialog.defaultCharacter(profiles.getProfile("nobody"), "tbc")).toBeNull();
    });
});

describe("Auswahl, Liste, Ergebnis", () => {
    const raids = [{ id: "eh-a", title: "Kara", startTime: 1900000000 }, { id: "eh-b", title: "Gruul", startTime: 1900086400 }];

    it("Abwesenheit: alle Raids gewählt, Grund und Hinweis auf spätere Raids", () => {
        const session = { kind: "absence", from: "2030-03-17", to: "2030-03-20", comment: "Urlaub", selected: null };
        const payload = dialog.pickerPayload("0a1b2c3d", session, raids, {});
        expect(embedOf(payload).description).toContain("Reason: Urlaub");
        expect(embedOf(payload).description).toContain("(2 of 2)");
        expect(embedOf(payload).description).toContain("Raids created later in this period sign you off automatically.");
        const select = payload.components[0].components[0].toJSON();
        expect(select.max_values).toBe(2);
        expect(select.min_values).toBe(0);
        expect(select.options.every((o) => o.default)).toBe(true);
        expect(ids(payload)).toEqual(["availability:0a1b2c3d:r", "availability:0a1b2c3d:save", "availability:0a1b2c3d:x"]);
    });

    it("ohne Raid im Zeitraum nur Speichern, mit Fehlerhinweis auf Englisch", () => {
        const payload = dialog.pickerPayload("0a1b2c3d", { kind: "absence", from: "2030-03-17", to: "2030-03-17" }, [], { notice: "⚠️ Höchstens 180 Tage auf einmal." });
        expect(embedOf(payload).description).toContain("No raid in this period yet.");
        expect(embedOf(payload).description).toContain("⚠️ At most 180 days at once.");
        expect(ids(payload)).toEqual(["availability:0a1b2c3d:save", "availability:0a1b2c3d:x"]);
    });

    it("Anwesenheit: Charakter-Auswahl mit dem gewählten als Vorgabe", () => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const session = { kind: "presence", from: "2030-03-17", to: "2030-03-20", character: "Zibbo", characterKey: "zibbo", spec: "Priest-Holy", versionId: "tbc", selected: ["eh-b"] };
        const payload = dialog.pickerPayload("0a1b2c3d", session, raids, { profile: profiles.getProfile(ANNA) });
        expect(embedOf(payload).description).toContain("Character: **Zibbo** · Holy (TBC Anniversary)");
        const chars = payload.components[0].components[0].toJSON();
        expect(chars.options).toEqual([expect.objectContaining({ value: "zibbo|Priest-Holy", default: true })]);
        const raidSelect = payload.components[1].components[0].toJSON();
        expect(raidSelect.options.map((o) => o.default)).toEqual([false, true]);
    });

    it("die Liste zeigt Einträge, Löschen-Auswahl und die Knöpfe", () => {
        const entries = [
            { id: "e1", kind: "absence", from: "2030-03-17", to: "2030-03-20", comment: "Urlaub" },
            { id: "e2", kind: "presence", from: "2030-04-01", to: "2030-04-01", character: "Zibbo", spec: "Priest-Holy" },
        ];
        const payload = dialog.listPayload(entries, { categoryId: "cat1" });
        expect(embedOf(payload).description).toContain("🏖️ **Away** · Sun 17 Mar 2030 – Wed 20 Mar 2030 · Urlaub");
        expect(embedOf(payload).description).toContain("✅ **There** · Mon 1 Apr 2030 · Zibbo · Holy");
        expect(ids(payload)).toEqual(["availability:del:cat1", "availability:a:cat1", "availability:p:cat1", "availability:l:cat1"]);
        expect(embedOf(dialog.listPayload([])).description).toBe("No absence or attendance entered.");
    });

    it("das Ergebnis sagt, wenn die DM nicht ankam", () => {
        const summary = { title: "Absence saved", description: "x" };
        expect(embedOf(dialog.savedPayload(summary, { kind: "absence", dm: true })).description).toBe("x");
        expect(embedOf(dialog.savedPayload(summary, { kind: "absence", dm: false })).description).toContain("could not send you a DM");
    });
});
