// Which section the plan, the template editor and the sheet open on (lib/raidplan.ts startSection), the section remembered per plan,
// and the switch that plans a boss / trash section without its map (components wiring in BoardWorkspace / PlanPublicPage).
import { describe, expect, it, vi } from "vitest";
import * as lib from "./raidplan";

vi.mock("../i18n", async (orig) => ({ ...(await orig<typeof import("../i18n")>()), t: (k: string) => k }));

const SECTIONS = [
    { key: "general", general: true },
    { key: "defaults" },
    { key: "bt/najentus" },
    { key: "bt/supremus" },
    { key: "bt/trash" },
];

describe("the section a plan opens on", () => {
    it("opens on \"Allgemein\" the first time", () => {
        expect(lib.startSection(SECTIONS, "", "", [])).toBe("general");
    });

    it("a deep link wins, then the section last open, unknown keys are ignored", () => {
        expect(lib.startSection(SECTIONS, "bt/supremus", "bt/trash", [])).toBe("bt/supremus");
        expect(lib.startSection(SECTIONS, "", "bt/trash", [])).toBe("bt/trash");
        expect(lib.startSection(SECTIONS, "bt/gone", "bt/also-gone", [])).toBe("general");
    });

    it("without \"Allgemein\" (the sheet leaves it out when empty) it takes the first shown section", () => {
        const noGeneral = SECTIONS.slice(2);
        expect(lib.startSection(noGeneral, "", "", [])).toBe("bt/najentus");
        expect(lib.startSection(noGeneral, "", "", ["bt/najentus"])).toBe("bt/supremus");
        expect(lib.startSection([], "", "", [])).toBe("");
    });
});

describe("the section remembered per plan", () => {
    // the page's storage, replaced per test (restoreMocks in vitest.config puts the real one back)
    it("stores and reads it per plan id", () => {
        const store: Record<string, string> = {};
        vi.spyOn(Storage.prototype, "getItem").mockImplementation((k) => (k in store ? store[k] : null));
        vi.spyOn(Storage.prototype, "setItem").mockImplementation((k, v) => { store[k] = v; });
        lib.rememberSection("eh_1", "bt/supremus");
        expect(store["eh.raidplan.section.eh_1"]).toBe("bt/supremus");
        expect(lib.rememberedSection("eh_1")).toBe("bt/supremus");
        expect(lib.rememberedSection("eh_2")).toBe("");
    });

    it("answers \"\" and does not throw when the storage is blocked", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        expect(lib.rememberedSection("eh_1")).toBe("");
        expect(() => lib.rememberSection("eh_1", "general")).not.toThrow();
    });
});

describe("a section planned without its map", () => {
    it("an old board shows its map, only an explicit false hides it", () => {
        expect(lib.boardOf({}, "bt/supremus").showMap).toBe(true);
        expect(lib.boardOf({ "bt/supremus": { notes: "x" } }, "bt/supremus").showMap).toBe(true);
        expect(lib.boardOf({ "bt/supremus": { showMap: false } }, "bt/supremus").showMap).toBe(false);
    });
});
