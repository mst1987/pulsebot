// #544: the raid plan per game version - catalog entries, templates and tactics of one version.
import { describe, expect, it } from "vitest";
import type { CatalogMob, CatalogSpell } from "../../api";
import { catalogOfVersion, inVersion, ofVersion, splitByVersion, versionChips, versionLabel } from "./versions";

const mob = (id: string, versions?: string[]): CatalogMob => ({ id, name: id, kind: "add", instanceId: "", bossKey: "", icon: "", note: "", source: "default", ...(versions ? { versions } : {}) });
const spell = (id: string, versions?: string[]): CatalogSpell => ({ id, name: id, nameEn: "", icon: "", type: "curse", classes: [], note: "", source: "default", ...(versions ? { versions } : {}) });

describe("inVersion / catalogOfVersion", () => {
    it("keeps the entries of the version asked, like the server's catalogView", () => {
        expect(inVersion({ versions: ["tbc"] }, "tbc")).toBe(true);
        expect(inVersion({ versions: ["tbc"] }, "forever")).toBe(false);
        expect(inVersion({ versions: ["tbc", "forever"] }, "forever")).toBe(true);
        // old data without versions: every version; no version asked: everything
        expect(inVersion({}, "forever")).toBe(true);
        expect(inVersion({ versions: ["tbc"] }, "")).toBe(true);
        const c = { mobs: [mob("a", ["tbc"]), mob("b", ["forever"])], spells: [spell("s", ["tbc"]), spell("w", ["wotlk"])] };
        expect(catalogOfVersion(c, "tbc")).toEqual({ mobs: [c.mobs[0]], spells: [c.spells[0]] });
        expect(catalogOfVersion(c, "forever")).toEqual({ mobs: [c.mobs[1]], spells: [] });
    });
});

describe("ofVersion / splitByVersion", () => {
    const list = [{ id: "1", versionId: "tbc" }, { id: "2", versionId: "forever" }, { id: "3" }];
    it("filters templates and tactics by version; a record without one is a TBC one", () => {
        expect(ofVersion(list, "tbc").map((x) => x.id)).toEqual(["1", "3"]);
        expect(ofVersion(list, "forever").map((x) => x.id)).toEqual(["2"]);
        expect(ofVersion(list, "classic")).toEqual([]);
    });
    it("splits what an event is offered: its own version, the others apart", () => {
        expect(splitByVersion(list, "forever")).toEqual({ own: [list[1]], other: [list[0], list[2]] });
        expect(splitByVersion([], "tbc")).toEqual({ own: [], other: [] });
    });
});

describe("versionChips / versionLabel", () => {
    const known = [{ id: "tbc", short: "TBC" }, { id: "classic", short: "Classic" }, { id: "forever", short: "Forever" }];
    it("offers the known versions and keeps a version of the entry the rule sets do not know", () => {
        expect(versionChips(known, ["tbc"]).map((c) => c.id)).toEqual(["tbc", "classic", "forever"]);
        expect(versionChips(known, ["wotlk"])).toEqual([
            { id: "tbc", label: "TBC" }, { id: "classic", label: "Classic" }, { id: "forever", label: "Forever" }, { id: "wotlk", label: "Wotlk" },
        ]);
    });
    it("names a version by its rule set, else from its id", () => {
        expect(versionLabel(known, "forever")).toBe("Forever");
        expect(versionLabel([], "tbc")).toBe("TBC");
        expect(versionLabel([], "forever")).toBe("Forever");
    });
});
