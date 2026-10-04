import { describe, expect, it } from "vitest";
import { DEFAULT_SHEET_LAYOUT, parseSheetLayout } from "./sheetLayout";

describe("parseSheetLayout", () => {
    it("nothing stored: no strip, the tables closed", () => {
        expect(parseSheetLayout(null)).toEqual(DEFAULT_SHEET_LAYOUT);
        expect(DEFAULT_SHEET_LAYOUT).toEqual({ strip: "off", allTasks: false });
    });
    it("takes a known strip mode and the tables' switch", () => {
        expect(parseSheetLayout(JSON.stringify({ strip: "left", allTasks: true }))).toEqual({ strip: "left", allTasks: true });
        expect(parseSheetLayout(JSON.stringify({ strip: "top" })).strip).toBe("top");
    });
    it("broken or unknown values fall back to the default", () => {
        expect(parseSheetLayout("{nope")).toEqual(DEFAULT_SHEET_LAYOUT);
        expect(parseSheetLayout(JSON.stringify({ strip: "right", allTasks: "yes" }))).toEqual(DEFAULT_SHEET_LAYOUT);
    });
});
