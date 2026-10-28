// The layout of the Einstellungen page (settingsSections.ts): which sections
// exist, how they are grouped, which ones only a full admin opens, which ones
// save themselves, and where an id merged away in the redesign (#224) lands.
import { describe, expect, it } from "vitest";
import {
    LEGACY_SECTIONS, SECTION_PARAM_IDS, SETTINGS_SECTIONS, groupLabel, groupedSections, resolveSection, savesWithForm, sectionCrumb, sectionLabel,
    SCOPE_PATH, sectionElsewhere, sectionParamIds, sectionsFor, visibleSections, type SettingsGroup,
} from "./settingsSections";
import { inLang } from "../../test/i18n";

const ids = () => SETTINGS_SECTIONS.map((s) => s.id);
const byId = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id);

describe("the sections", () => {
    it("keeps the sections in the menu's two blocks, the server first, each with a WoW icon (#918)", () => {
        expect(ids()).toEqual(expect.arrayContaining([
            "berechtigungen", "verbindungen", "discordserver", "kategorien",
            "raids", "raidsheets", "topitems", "logs", "recruitment",
        ]));
        expect(new Set(ids()).size).toBe(ids().length);
        expect(groupedSections(SETTINGS_SECTIONS).map((g) => g.group)).toEqual(["server", "global"]);
        expect(groupedSections(SETTINGS_SECTIONS).map((g) => groupLabel(g.group))).toEqual(["Server", "Alle Server"]);
        for (const s of SETTINGS_SECTIONS) {
            // a missing text would come back as its key
            const label = sectionLabel(s);
            const crumb = sectionCrumb(s);
            expect({ id: s.id, icon: /^[a-z0-9_]+$/.test(s.icon), label: !!label && !label.startsWith("settings."), crumb: !!crumb && !crumb.startsWith("settings.") })
                .toEqual({ id: s.id, icon: true, label: true, crumb: true });
        }
        expect(sectionLabel(SETTINGS_SECTIONS[0])).toBe("Berechtigungen");
    });

    it("names the sections and groups in English once the page is switched", async () => {
        await inLang("en", () => {
            expect(sectionLabel(SETTINGS_SECTIONS[0])).toBe("Permissions");
            expect(groupLabel("global")).toBe("All servers");
        });
    });

    it("puts what belongs to one server in its block and what the bot shares under Alle Server", () => {
        const of = (group: SettingsGroup) => SETTINGS_SECTIONS.filter((s) => s.group === group).map((s) => s.id);
        expect(of("server")).toEqual(["berechtigungen", "kategorien", "raids", "logs", "recruitment", "versionlinks", "raidsheets", "raidhelper", "topitems"]);
        expect(of("global")).toEqual(["discordserver", "vollAdmins", "verbindungen", "spielversion", "dungeons", "addons"]);
    });

    it("keeps the sections of a group together, so every heading prints once", () => {
        // groupedSections() only bundles neighbours: a section listed away from
        // its group would silently print that heading a second time.
        const headings = groupedSections(SETTINGS_SECTIONS).map((g) => g.group);
        expect(headings).toEqual([...new Set(headings)]);
        expect(groupedSections(SETTINGS_SECTIONS).flatMap((g) => g.items)).toEqual(SETTINGS_SECTIONS);
    });

    it("bundles neighbours only", () => {
        const s = (id: string, group: SettingsGroup) => ({ id, group, icon: "x" });
        expect(groupedSections([s("a", "server"), s("b", "server"), s("c", "global"), s("d", "server")]).map((g) => [g.group, g.items.map((i) => i.id)]))
            .toEqual([["server", ["a", "b"]], ["global", ["c"]], ["server", ["d"]]]);
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

describe("two pages: System › Einstellungen and Alle Server › Einstellungen (#957)", () => {
    const idsOf = (list: { id: string }[]) => list.map((s) => s.id);

    it("shows only the active server's sections under System and the shared ones under Alle Server", () => {
        expect(SCOPE_PATH).toEqual({ server: "/settings", all: "/settings/all" });
        expect(idsOf(sectionsFor("server", true))).toEqual(["berechtigungen", "kategorien", "raids", "logs", "recruitment", "versionlinks", "raidsheets", "raidhelper", "topitems"]);
        expect(idsOf(sectionsFor("all", true))).toEqual(["discordserver", "vollAdmins", "verbindungen", "spielversion", "dungeons", "addons"]);
        // a settings writer without full admin: no admin-only section on either page
        expect(idsOf(sectionsFor("server", false))).toEqual(["kategorien", "raids", "logs", "recruitment", "versionlinks", "raidsheets", "topitems"]);
        expect(idsOf(sectionsFor("all", false))).not.toContain("discordserver");
    });

    it("lets each page's url carry its own ids and the old ones that lead there", () => {
        expect(sectionParamIds("server").sort()).toEqual(["berechtigungen", "kategorien", "logs", "loot", "raidchars", "raidhelper", "raids", "raidsheets", "recruitment", "topitems", "versionlinks", "zugang"].sort());
        expect(sectionParamIds("all")).toEqual(expect.arrayContaining(["discordserver", "verbindungen", "discord", "warcraftlogs", "spielversion", "dungeons"]));
        expect(sectionParamIds("all")).not.toContain("kategorien");
        expect(sectionParamIds("all")).not.toContain("topitems");
    });

    it("sends an old /settings?section= link to the page that holds the section now", () => {
        expect(sectionElsewhere("discordserver", "server")).toBe("all");
        expect(sectionElsewhere("battlenet", "server")).toBe("all"); // old id -> verbindungen
        expect(sectionElsewhere("kategorien", "all")).toBe("server");
        expect(sectionElsewhere("raidchars", "all")).toBe("server");
        // top items stay with the server (#952 makes them per server and version)
        expect(sectionElsewhere("topitems", "all")).toBe("server");
        expect(sectionElsewhere("loot", "all")).toBe("server");
        expect(sectionElsewhere("topitems", "server")).toBeNull();
        expect(sectionElsewhere("kategorien", "server")).toBeNull();
        expect(sectionElsewhere("discordserver", "all")).toBeNull();
        expect(sectionElsewhere("gibtsnicht", "server")).toBeNull();
        expect(sectionElsewhere(null, "server")).toBeNull();
    });
});

describe("the save bar", () => {
    it("leaves out the sections that save themselves", () => {
        for (const id of ["verbindungen", "discordserver", "raidsheets", "versionlinks"]) {
            expect({ id, standalone: byId(id)?.standalone, inForm: savesWithForm(id) }).toEqual({ id, standalone: true, inForm: false });
        }
        for (const id of ["berechtigungen", "kategorien", "raids", "topitems", "logs", "recruitment"]) {
            expect({ id, inForm: savesWithForm(id) }).toEqual({ id, inForm: true });
        }
        expect(savesWithForm("gibtsnicht")).toBe(false);
    });
});
