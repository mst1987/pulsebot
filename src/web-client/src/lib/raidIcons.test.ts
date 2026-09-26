// The boss icon of every raid the server can recognise (src/config/tbcContent.js),
// with the icon names the zamimg CDN really has.
import { describe, expect, it } from "vitest";
import { requireBackend } from "../test/backend";
import { wowIconUrl } from "./wowIcon";
import { RAID_CONTENTS, RAID_ICON_FALLBACK, knownContents, raidIconName } from "./raidIcons";

const { CONTENTS } = requireBackend<{ CONTENTS: { id: string }[] }>("config/tbcContent");

describe("raid icons", () => {
    it("has an icon for every content the server can recognise", () => {
        const missing = CONTENTS.map((c) => c.id).filter((id) => !RAID_CONTENTS[id]?.icon);
        expect(missing).toEqual([]);
        expect(knownContents(CONTENTS.map((c) => c.id))).toHaveLength(CONTENTS.length);
    });

    it("uses the icon names that exist on the CDN", () => {
        // checked by download: Kael'thas only with the apostrophe, Archimonde only with the dash
        expect(raidIconName("tk")).toBe("achievement_boss_kael'thassunstrider_01");
        expect(wowIconUrl(raidIconName("tk"))).toContain("achievement_boss_kael%27thassunstrider_01.jpg");
        expect(raidIconName("hyjal")).toBe("achievement_boss_archimonde-");
        expect(wowIconUrl(raidIconName("hyjal"))).toContain("achievement_boss_archimonde-.jpg");
        // anything unknown shows the plain note, never a guessed boss
        expect(RAID_ICON_FALLBACK).toBe("inv_misc_note_02");
        expect(raidIconName("naxx")).toBe(RAID_ICON_FALLBACK);
        expect(raidIconName(undefined)).toBe(RAID_ICON_FALLBACK);
    });
});
