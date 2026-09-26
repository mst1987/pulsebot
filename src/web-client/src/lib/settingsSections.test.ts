// The layout of the Einstellungen page (settingsSections.ts): which sections
// exist, how they are grouped, which ones only a full admin opens, which ones
// save themselves, and where an id merged away in the redesign (#224) lands.
import { describe, expect, it } from "vitest";
import {
    LEGACY_SECTIONS, SECTION_PARAM_IDS, SETTINGS_SECTIONS, groupedSections, resolveSection, savesWithForm, visibleSections,
} from "./settingsSections";

const ids = () => SETTINGS_SECTIONS.map((s) => s.id);
const byId = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id);

describe("the sections", () => {
    it("keeps the sections in four groups, in this order, each with a WoW icon", () => {
        expect(ids()).toEqual(expect.arrayContaining([
            "berechtigungen", "verbindungen", "discordserver", "kategorien",
            "raids", "raidsheets", "topitems", "logs", "recruitment",
        ]));
        expect(new Set(ids()).size).toBe(ids().length);
        expect(groupedSections(SETTINGS_SECTIONS).map((g) => g.group)).toEqual(["Zugang", "Verbindungen", "Raid-Kategorien", "Module"]);
        for (const s of SETTINGS_SECTIONS) {
            expect({ id: s.id, icon: /^[a-z0-9_]+$/.test(s.icon), label: !!s.label, crumb: !!s.crumb })
                .toEqual({ id: s.id, icon: true, label: true, crumb: true });
        }
    });

    it("keeps the sections of a group together, so every heading prints once", () => {
        // groupedSections() only bundles neighbours: a section listed away from
        // its group would silently print that heading a second time.
        const headings = groupedSections(SETTINGS_SECTIONS).map((g) => g.group);
        expect(headings).toEqual([...new Set(headings)]);
        expect(groupedSections(SETTINGS_SECTIONS).flatMap((g) => g.items)).toEqual(SETTINGS_SECTIONS);
    });

    it("bundles neighbours only", () => {
        const s = (id: string, group: string) => ({ id, group, label: id, icon: "x", crumb: "" });
        expect(groupedSections([s("a", "A"), s("b", "A"), s("c", "B"), s("d", "A")]).map((g) => [g.group, g.items.map((i) => i.id)]))
            .toEqual([["A", ["a", "b"]], ["B", ["c"]], ["A", ["d"]]]);
    });
});

describe("who sees which section", () => {
    it("marks the permission and the Discord-Server section full-admin-only", () => {
        // The API is the real gate (ACCESS_KEYS / GUILD_KEYS with requireFullAdmin),
        // but a field shown to someone who cannot save it is a trap.
        expect(byId("berechtigungen")?.adminOnly).toBe(true);
        expect(byId("discordserver")?.adminOnly).toBe(true);
        expect(visibleSections(true)).toEqual(SETTINGS_SECTIONS);
        const limited = visibleSections(false).map((s) => s.id);
        expect(limited).not.toContain("berechtigungen");
        expect(limited).not.toContain("discordserver");
        expect(limited).toEqual(expect.arrayContaining(["verbindungen", "kategorien", "raids", "recruitment"]));
    });

    it("opens the first section the user may see when the remembered one is out of reach", () => {
        const limited = visibleSections(false);
        expect(resolveSection("berechtigungen", limited)).toBe(limited[0].id);
        expect(resolveSection("gibtsnicht", SETTINGS_SECTIONS)).toBe("berechtigungen");
        expect(resolveSection("logs", limited)).toBe("logs");
    });
});

describe("merged-away section ids", () => {
    it("redirects every old id to a section that exists", () => {
        // Links such as ?section=raidchars and ids remembered from older builds
        // have to land where the setting lives now.
        expect(Object.keys(LEGACY_SECTIONS).sort()).toEqual(["anthropic", "battlenet", "discord", "loot", "lootsync", "raidchars", "warcraftlogs", "zugang"]);
        for (const [from, to] of Object.entries(LEGACY_SECTIONS)) {
            expect({ from, exists: ids().includes(to), resolved: resolveSection(from, SETTINGS_SECTIONS) }).toEqual({ from, exists: true, resolved: to });
        }
        expect(resolveSection("raidchars", SETTINGS_SECTIONS)).toBe("kategorien");
        expect(resolveSection("loot", SETTINGS_SECTIONS)).toBe("topitems");
    });

    it("lets the url carry the current and the old ids", () => {
        expect([...SECTION_PARAM_IDS].sort()).toEqual([...ids(), ...Object.keys(LEGACY_SECTIONS)].sort());
    });
});

describe("the save bar", () => {
    it("leaves out the sections that save themselves", () => {
        for (const id of ["verbindungen", "discordserver", "raidsheets"]) {
            expect({ id, standalone: byId(id)?.standalone, inForm: savesWithForm(id) }).toEqual({ id, standalone: true, inForm: false });
        }
        for (const id of ["berechtigungen", "kategorien", "raids", "topitems", "logs", "recruitment"]) {
            expect({ id, inForm: savesWithForm(id) }).toEqual({ id, inForm: true });
        }
        expect(savesWithForm("gibtsnicht")).toBe(false);
    });
});
