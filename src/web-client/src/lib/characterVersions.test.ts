// Characters per game version (#543): grouping for the profile, filtering for the signup.
import { describe, expect, it } from "vitest";
import { charactersOfVersion, groupByVersion, moveInVersion, versionOf } from "./characterVersions";
import { missingVersionLabel, profileForRows } from "./signups";

describe("moveInVersion — the raider's order, there is no main", () => {
    const list = [
        { key: "a", versionId: "tbc" }, { key: "x", versionId: "forever" }, { key: "b", versionId: "tbc" }, { key: "y", versionId: "forever" },
    ];
    const keys = (l: { key: string }[] | null) => (l ? l.map((c) => c.key) : null);

    it("moves a character one place within its own version, the others keep their places", () => {
        expect(keys(moveInVersion(list, "b", -1))).toEqual(["b", "x", "a", "y"]);
        expect(keys(moveInVersion(list, "x", 1))).toEqual(["a", "y", "b", "x"]);
    });

    it("cannot move past the first or last of its version, nor an unknown key", () => {
        expect(moveInVersion(list, "a", -1)).toBeNull();
        expect(moveInVersion(list, "y", 1)).toBeNull();
        expect(moveInVersion(list, "nope", 1)).toBeNull();
    });
});
import type { SignupProfile } from "../api";

const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "classic", label: "Classic", short: "Classic" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];
const chars = [
    { key: "devi", versionId: "tbc" },
    { key: "forever~devi res", versionId: "forever" },
    { key: "alt" },
];

describe("lib/characterVersions", () => {
    it("reads a character without a version as TBC", () => {
        expect(versionOf({})).toBe("tbc");
        expect(versionOf({ versionId: "forever" })).toBe("forever");
    });

    it("groups by version, the main version first, empty groups left out", () => {
        const groups = groupByVersion(chars, VERSIONS, "forever");
        expect(groups.map((g) => [g.id, g.label, g.characters.map((c) => c.key)])).toEqual([
            ["forever", "Forever", ["forever~devi res"]],
            ["tbc", "TBC", ["devi", "alt"]],
        ]);
        expect(groupByVersion(chars, VERSIONS).map((g) => g.id)).toEqual(["tbc", "forever"]);
        // a version the server did not name still gets a group, named by its id
        expect(groupByVersion([{ versionId: "sod" }], VERSIONS).map((g) => g.label)).toEqual(["sod"]);
    });

    it("filters to one version, \"\" keeps all", () => {
        expect(charactersOfVersion(chars, "tbc").map((c) => c.key)).toEqual(["devi", "alt"]);
        expect(charactersOfVersion(chars, "")).toHaveLength(3);
    });
});

describe("lib/signups je Spielversion", () => {
    const profile = {
        canOfftank: false, canHeal: false,
        characters: [
            { key: "devi", name: "Devi", versionId: "tbc", className: "Priest", main: true, specs: [], canOfftank: false, canHeal: true },
        ],
    } as SignupProfile;

    it("offers only the characters of the rows' version, all for mixed rows", () => {
        expect(profileForRows(profile, [{ versionId: "tbc" }]).characters).toHaveLength(1);
        expect(profileForRows(profile, [{ versionId: "forever" }]).characters).toEqual([]);
        expect(profileForRows(profile, [{ versionId: "tbc" }, { versionId: "forever" }]).characters).toHaveLength(1);
        expect(profileForRows(profile, [])).toBe(profile);
    });

    it("names the version a member lacks a character of", () => {
        expect(missingVersionLabel(profile, [{ versionId: "forever" }], VERSIONS)).toBe("Forever");
        expect(missingVersionLabel(profile, [{ versionId: "tbc" }], VERSIONS)).toBe("");
        expect(missingVersionLabel({ ...profile, characters: [] }, [{ versionId: "forever" }], VERSIONS)).toBe("");
        expect(missingVersionLabel(profile, [{ versionId: "sod" }])).toBe("sod");
    });
});
