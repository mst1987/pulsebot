// Umstieg von Raid-Helper (#291) in Einstellungen → Verbindungen: the card's
// rules (lib/raidhelperRetirement.ts) run for real. The card's structure is
// checked on the source in test/web-client/raidhelperRetirement.test.js.
import { describe, expect, it } from "vitest";
import * as mod from "./raidhelperRetirement";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests hand the lib loose fixtures, as the Jest version did
const lib: any = mod;
const item = (over: Record<string, unknown> = {}) => ({ id: "categories", label: "Alle Event-Kategorien auf EventHelper", status: "ok", value: "2 / 2", why: "Weil.", detail: [], required: true, ...over });
const checklist = (over: Record<string, unknown> = {}) => ({ disabled: false, disabledAt: 0, disabledBy: "", items: [item()], done: 1, total: 1, ready: true, blockers: [], ...over });

describe("the checklist's rules", () => {
    it("gives every status a badge", () => {
        expect(lib.statusLook("ok")).toEqual({ tone: "ok", label: "erledigt" });
        expect(lib.statusLook("bad")).toEqual({ tone: "bad", label: "offen" });
        expect(lib.statusLook("mid").tone).toBe("mid");
        expect(lib.statusLook("unknown")).toEqual({ tone: "", label: "nicht prüfbar" });
        expect(lib.statusLook("info").label).toBe("Hinweis");
    });

    it("puts why, what is open, the command and Pflicht/Empfehlung into the tooltip", () => {
        const tip = lib.itemTip(item({ detail: ["Sonntag – noch Raid-Helper"], hint: "npm run register" }));
        expect(tip).toMatch(/^Weil\./);
        expect(tip).toMatch(/Sonntag – noch Raid-Helper/);
        expect(tip).toMatch(/Befehl: npm run register/);
        expect(tip).toMatch(/Pflicht vor dem Abschalten/);
        expect(lib.itemTip(item({ required: false }))).toMatch(/Empfehlung/);
    });

    it("opens the switch only when ready and names what blocks it", () => {
        expect(lib.switchState(checklist())).toMatchObject({ checked: false, enabled: true });
        const blocked = lib.switchState(checklist({ ready: false, blockers: ["categories"] }));
        expect(blocked.enabled).toBe(false);
        expect(blocked.reason).toBe("Erst erledigen: Alle Event-Kategorien auf EventHelper.");
        // switching back on is always possible
        expect(lib.switchState(checklist({ disabled: true, ready: false, blockers: ["categories"] }))).toMatchObject({ checked: true, enabled: true });
    });

    it("reads the head and the disabled state", () => {
        expect(lib.headLook(checklist())).toEqual({ tone: "ok", label: "1 von 1 erledigt" });
        expect(lib.headLook(checklist({ done: 2, total: 5, ready: false }))).toEqual({ tone: "bad", label: "2 von 5 erledigt" });
        expect(lib.headLook(checklist({ done: 2, total: 5 })).tone).toBe("mid");
        expect(lib.headLook(checklist({ disabled: true }))).toEqual({ tone: "accent", label: "abgeschaltet" });
        const now = Date.UTC(2026, 8, 16);
        expect(lib.disabledSince(checklist({ disabled: true, disabledAt: now - 3 * 86400000, disabledBy: "Orga" }), now)).toBe("vor 3 Tagen von Orga");
        expect(lib.disabledSince(checklist({ disabled: true, disabledAt: now }), now)).toBe("heute");
        expect(lib.disabledSince(checklist(), now)).toBe("");
    });

    it("words the import result for a dry run, a stored run and nothing new", () => {
        const base = { dryRun: true, stored: null, summary: { events: 4, skippedEvents: 0, entries: 60, users: 18, unmapped: { Unholy_DPS: 2 } } };
        expect(lib.importSummary(base)).toBe("4 Events · 60 Einträge für 18 Raider würden gespeichert.");
        expect(lib.importSummary({ ...base, dryRun: false, stored: { events: 4, entries: 60, users: 18 } })).toBe("4 Events · 60 Einträge für 18 Raider gespeichert.");
        expect(lib.importSummary({ ...base, summary: { ...base.summary, events: 0, skippedEvents: 4 } })).toMatch(/Nichts Neues – 4 Events/);
        expect(lib.importSummary({ ...base, summary: { ...base.summary, events: 0 } })).toBe("Keine Raid-Helper-Events gefunden.");
        expect(lib.unmappedText(base)).toBe("Nicht zuordenbar: Unholy_DPS (2×)");
        expect(lib.unmappedText({ ...base, summary: { ...base.summary, unmapped: {} } })).toBe("");
    });
});

describe("the profile's suggestion from Raid-Helper", () => {
    it("takes the most played spec's class, its specs by count and the latest name", () => {
        expect(lib.specSuggestion([
            { spec: "Priest-Holy", count: 2, lastAt: 50, character: "Heiler" },
            { spec: "Priest-Shadow", count: 7, lastAt: 40, character: "Schatten" },
            { spec: "Mage-Fire", count: 3, lastAt: 90, character: "Twink" },
        ])).toEqual({ className: "Priest", specs: ["Priest-Shadow", "Priest-Holy"], name: "Heiler" });
        expect(lib.specSuggestion([])).toBeNull();
        expect(lib.specSuggestion(undefined)).toBeNull();
    });
});
