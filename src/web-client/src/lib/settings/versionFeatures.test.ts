// "Funktionen je Version" (#761): the cell states, the draft's lists and what the save bar sends.
import { describe, expect, it } from "vitest";
import { cellState, changedFeatureVersions, disabledFromConfig, reasonKeys, setFeature, withDisabled, type FeatureCell } from "./versionFeatures";
import { emptyBlock } from "./versionLinks";

const ORDER = ["logcheck", "lootCouncilBis", "simulation", "raidSheet", "softres", "armory", "wowheadLinks", "raidplanCatalog"];
const cell = (over: Partial<FeatureCell> = {}): FeatureCell => ({ possible: true, enabled: true, on: true, reason: "", message: "", missing: [], ...over });

describe("versionFeatures", () => {
    it("reads the stored lists, a version without one has none", () => {
        expect(disabledFromConfig({ tbc: { disabled: ["softres"] }, forever: {}, classic: undefined })).toEqual({ tbc: ["softres"], forever: [], classic: [] });
        expect(disabledFromConfig(undefined)).toEqual({});
    });

    it("shows on / off where possible and 'not possible' everywhere else", () => {
        expect(cellState(cell(), "softres", [])).toBe("on");
        expect(cellState(cell(), "softres", ["softres"])).toBe("off");
        expect(cellState(cell({ possible: false, reason: "no_softres_edition" }), "softres", [])).toBe("impossible");
        expect(cellState(undefined, "softres")).toBe("impossible");
    });

    it("switches a feature in the matrix order and keeps what it does not know", () => {
        expect(setFeature([], "softres", false, ORDER)).toEqual(["softres"]);
        expect(setFeature(["softres"], "logcheck", false, ORDER)).toEqual(["logcheck", "softres"]);
        expect(setFeature(["logcheck", "softres"], "logcheck", true, ORDER)).toEqual(["softres"]);
        expect(setFeature(["future"], "armory", false, ORDER)).toEqual(["armory", "future"]);
    });

    it("names the versions whose switches changed, whatever the order", () => {
        expect(changedFeatureVersions({ tbc: ["softres", "logcheck"], forever: [] }, { tbc: ["logcheck", "softres"], forever: [] })).toEqual([]);
        expect(changedFeatureVersions({ tbc: [] }, { tbc: ["armory"], forever: [] })).toEqual(["tbc"]);
        expect(changedFeatureVersions(undefined, undefined)).toEqual([]);
    });

    it("sends every block with its whole list", () => {
        const blocks = { tbc: { ...emptyBlock(), wowheadPath: "tbc" }, forever: emptyBlock() };
        const out = withDisabled(blocks, { tbc: ["softres"] });
        expect(out.tbc).toEqual({ ...blocks.tbc, disabled: ["softres"] });
        expect(out.forever.disabled).toEqual([]);
    });

    it("gives the reason keys of a cell: switched off, or why not possible with what else is missing", () => {
        expect(reasonKeys(cell(), "on")).toEqual([]);
        expect(reasonKeys(cell(), "off")).toEqual(["settings.versionFeatures.reason.disabled"]);
        expect(reasonKeys(cell({ possible: false, reason: "rules_not_ready", also: ["no_site"] }), "impossible")).toEqual([
            "settings.versionFeatures.reason.rules_not_ready", "settings.versionFeatures.reason.no_site",
        ]);
    });
});
