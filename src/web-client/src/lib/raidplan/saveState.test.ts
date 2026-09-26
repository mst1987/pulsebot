// Unsaved changes stand out in the plan and template editor: which sections differ from the saved plan (lib/raidplan/model.ts dirtyKeys)
// and the wiring of the save button, the strip, the chips, Ctrl+S and the warning on leaving (pages/raid-detail/raidplan/SaveState.tsx).
import { describe, expect, it, vi } from "vitest";
import * as lib from ".";

vi.mock("../../i18n", async (orig) => ({ ...(await orig<typeof import("../../i18n")>()), t: (k: string) => k }));

describe("which sections are unsaved", () => {
    const keys = ["a", "b", "c"];
    it("lists the sections whose board differs, none when equal, a new section counts", () => {
        const saved = { a: { notes: "x" }, b: { notes: "y" } };
        expect(lib.dirtyKeys(saved, saved, keys)).toEqual([]);
        expect(lib.dirtyKeys({ ...saved, b: { notes: "z" } }, saved, keys)).toEqual(["b"]);
        expect(lib.dirtyKeys({ ...saved, c: { notes: "neu" } }, saved, keys)).toEqual(["c"]);
        expect(lib.dirtyKeys({ a: { notes: "x" } }, saved, keys)).toEqual(["b"]);
        // a board that only differs in missing default fields is not unsaved
        expect(lib.dirtyKeys({ a: { notes: "x", steps: [] } }, { a: { notes: "x" } }, ["a"])).toEqual([]);
    });
});
