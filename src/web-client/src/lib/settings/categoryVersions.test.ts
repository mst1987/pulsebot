import { describe, expect, it } from "vitest";
import { categoryVersionOf, categoryVersionsToSave, isVersionSwitch, savedCategoryVersion, switchFixesToSend } from "./categoryVersions";

const saved = { categoryIds: ["c1", "c2"], categoryVersion: { c1: "tbc" }, mainVersion: "forever" };

describe("lib/settings/categoryVersions (#738)", () => {
    it("shows a category's own version, else the main version", () => {
        expect(categoryVersionOf({ c1: "tbc" }, "c1", "forever")).toBe("tbc");
        expect(categoryVersionOf({ c1: "" }, "c1", "forever")).toBe("forever");
    });

    it("sends every active category with a version, the rest as they were", () => {
        expect(categoryVersionsToSave({ c1: "tbc", old: "classic", gone: "" }, ["c1", "c3"], "forever"))
            .toEqual({ c1: "tbc", old: "classic", c3: "forever" });
    });

    it("knows the saved version of a category active before, none for a new one", () => {
        expect(savedCategoryVersion(saved, "c1")).toBe("tbc");
        // active before without a stored entry: it played the main version
        expect(savedCategoryVersion(saved, "c2")).toBe("forever");
        expect(savedCategoryVersion(saved, "c3")).toBe("");
        expect(savedCategoryVersion({ categoryIds: ["c1"] }, "c1")).toBe("tbc");
    });

    it("a switch is another version for a category that was active", () => {
        expect(isVersionSwitch(saved, "c1", "forever")).toBe(true);
        expect(isVersionSwitch(saved, "c1", "tbc")).toBe(false);
        expect(isVersionSwitch(saved, "c3", "tbc")).toBe(false);
    });

    it("sends the dialog's choices only for categories the draft switches", () => {
        const fixes = { c1: { series: "pause" }, c2: { series: "t1" }, c3: { series: "pause" } };
        expect(switchFixesToSend(fixes, saved, { c1: "forever", c2: "forever", c3: "tbc" })).toEqual({ c1: { series: "pause" } });
        expect(switchFixesToSend({ c1: { series: "" } }, saved, { c1: "forever" })).toEqual({});
    });
});
