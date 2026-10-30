// The boss icon of every raid of every game version (src/config/gameVersions),
// with the icon names the zamimg CDN really has.
import { describe, expect, it } from "vitest";
import { requireBackend } from "../../../test/backend";
import { wowIconUrl } from "../wowIcon";
import { RAID_CONTENTS, RAID_ICON_FALLBACK, knownContents, raidIconName } from "../raidIcons";

const { VERSIONS } = requireBackend<{ VERSIONS: { instances: { id: string; icon: string }[] }[] }>("config/gameVersions");
const INSTANCES = VERSIONS.flatMap((v) => v.instances);

describe("raid icons", () => {
    it("has an icon for every instance of every game version, the rule set's own (#749)", () => {
        const missing = INSTANCES.filter((i) => !RAID_CONTENTS[i.id]?.icon).map((i) => i.id);
        expect(missing).toEqual([]);
        expect(INSTANCES.filter((i) => RAID_CONTENTS[i.id].icon !== i.icon).map((i) => i.id)).toEqual([]);
        expect(knownContents(INSTANCES.map((i) => i.id))).toHaveLength(INSTANCES.length);
    });

    it("knows no entry the rule sets do not have", () => {
        expect(Object.keys(RAID_CONTENTS).filter((id) => !INSTANCES.some((i) => i.id === id))).toEqual([]);
    });

    it("does not give Forever's Hyjal the entry of the TBC namesake", () => {
        expect(RAID_CONTENTS["forever-hyjal"]).not.toBe(RAID_CONTENTS.hyjal);
        expect(RAID_CONTENTS["forever-hyjal"].short).toBe("Hyjal F");
    });

    it("uses the icon names that exist on the CDN", () => {
        // checked by download: Kael'thas only with the apostrophe, Archimonde only with the dash
        expect(raidIconName("tk")).toBe("achievement_boss_kael'thassunstrider_01");
        expect(wowIconUrl(raidIconName("tk"))).toContain("achievement_boss_kael%27thassunstrider_01.jpg");
        expect(raidIconName("hyjal")).toBe("achievement_boss_archimonde-");
        expect(wowIconUrl(raidIconName("hyjal"))).toContain("achievement_boss_archimonde-.jpg");
        // anything unknown shows the plain note, never a guessed boss
        expect(RAID_ICON_FALLBACK).toBe("inv_misc_note_02");
        expect(raidIconName("unknown-raid")).toBe(RAID_ICON_FALLBACK);
        expect(raidIconName(undefined)).toBe(RAID_ICON_FALLBACK);
    });
});
