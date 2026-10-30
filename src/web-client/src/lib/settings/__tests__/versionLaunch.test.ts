import { describe, expect, it } from "vitest";
import type { LaunchChecklist, LaunchItem } from "../../../api";
import { headLook, itemDetails, itemLink, itemTip, itemValue, statusLook } from "../versionLaunch";

const list = (items: LaunchItem[] = [], done = 0, total = 10): LaunchChecklist => ({ versionId: "forever", label: "WoW Forever", short: "Forever", items, done, total });
const base = { optional: false, mark: null };

describe("versionLaunch wording (#745)", () => {
    it("badges done, open and an open optional item", () => {
        expect(statusLook({ ...base, id: "talk", kind: "manual", status: "done" })).toEqual({ tone: "ok", label: "erledigt" });
        expect(statusLook({ ...base, id: "talk", kind: "manual", status: "open" })).toEqual({ tone: "mid", label: "offen" });
        expect(statusLook({ ...base, id: "mainVersion", kind: "auto", status: "open", optional: true, mainVersion: "tbc", isMain: false, hidden: false }))
            .toEqual({ tone: "", label: "optional" });
    });

    it("counts in the head", () => {
        expect(headLook(list([], 3, 10))).toEqual({ tone: "mid", label: "3 von 10 erledigt" });
        expect(headLook(list([], 10, 10)).tone).toBe("ok");
    });

    it("words the values of the computed items", () => {
        const l = list();
        expect(itemValue({ ...base, id: "categories", kind: "auto", status: "open", total: 3, missing: [{ id: "c3", name: "" }], target: [] }, l)).toBe("2 / 3");
        expect(itemValue({ ...base, id: "categories", kind: "auto", status: "open", total: 0, missing: [], target: [] }, l)).toBe("keine Kategorie");
        expect(itemValue({ ...base, id: "versionSettings", kind: "auto", status: "open", fields: [{ field: "realm", state: "missing", reason: "" }, { field: "softres", state: "missing", reason: "" }] }, l)).toBe("2 fehlen");
        expect(itemValue({ ...base, id: "versionSettings", kind: "auto", status: "done", fields: [] }, l)).toBe("vollständig");
        expect(itemValue({ ...base, id: "templates", kind: "auto", status: "done", count: 1, names: ["Barrow"], incomplete: [] }, l)).toBe("1 Vorlage");
        expect(itemValue({ ...base, id: "series", kind: "auto", status: "done", categories: 0, problems: [] }, l)).toBe("nichts zu prüfen");
        expect(itemValue({ ...base, id: "rosters", kind: "auto", status: "open", categories: 0, problems: [] }, l)).toBe("keine Forever-Kategorie");
        expect(itemValue({ ...base, id: "rosters", kind: "auto", status: "open", categories: 2, problems: [{ categoryId: "c", name: "", rosterId: "", problems: ["missing"] }] }, l)).toBe("1 / 2");
        expect(itemValue({ ...base, id: "guildBank", kind: "auto", status: "open", banks: [{ key: "k", guild: "G", realm: "R", assigned: false }] }, l)).toBe("wartet auf Zuordnung");
        expect(itemValue({ ...base, id: "mainVersion", kind: "auto", status: "open", optional: true, mainVersion: "tbc", isMain: false, hidden: false }, l, { tbc: "TBC" })).toBe("Haupt: TBC");
        expect(itemValue({ ...base, id: "talk", kind: "manual", status: "open" }, l)).toBe("von Hand");
    });

    it("names what is open in the tooltip, and an empty field that is fine with its reason", () => {
        const item: LaunchItem = {
            ...base, id: "versionSettings", kind: "auto", status: "open",
            fields: [
                { field: "realm", state: "missing", reason: "" },
                { field: "wcl", state: "notNeeded", reason: "rules_not_ready" },
                { field: "softres", state: "notNeeded", reason: "disabled" },
                { field: "wowhead", state: "set", reason: "" },
            ],
        };
        expect(itemDetails(item, list())).toEqual([
            "Fehlt: Realm",
            "Leer, nicht nötig: Warcraft Logs (für die Version nicht möglich), Softres (ausgeschaltet)",
        ]);
        const templates: LaunchItem = { ...base, id: "templates", kind: "auto", status: "done", count: 1, names: ["Barrow"], incomplete: ["Barrow Deeps"] };
        expect(itemTip(templates, list())).toContain("Bosse eintragen, sobald bekannt: Barrow Deeps");
        const rosters: LaunchItem = { ...base, id: "rosters", kind: "auto", status: "open", categories: 1, problems: [{ categoryId: "c2", name: "Mittwoch", rosterId: "r", problems: ["noRoles", "noManagers"] }] };
        expect(itemDetails(rosters, list())).toEqual(["Mittwoch: ohne Rollen, ohne Manager"]);
        const series: LaunchItem = { ...base, id: "series", kind: "auto", status: "open", categories: 1, problems: [{ categoryId: "c2", name: "Mittwoch", kind: "default", template: "SSC" }] };
        expect(itemDetails(series, list())).toEqual(["Mittwoch: Standardvorlage „SSC“"]);
    });

    it("says who ticked a manual item off, and that it is ticked by hand", () => {
        const item: LaunchItem = { ...base, id: "talk", kind: "manual", status: "done", mark: { at: Date.UTC(2026, 9, 11, 12), byName: "Orga" } };
        const tip = itemTip(item, list());
        expect(tip).toMatch(/abgehakt am .* von Orga/);
        expect(tip).toContain("selbst abhaken");
    });

    it("links each item to where it is fixed", () => {
        expect(itemLink({ ...base, id: "rosters", kind: "auto", status: "open", categories: 0, problems: [] })).toEqual({ kind: "route", to: "/roster", label: "Roster" });
        expect(itemLink({ ...base, id: "versionSettings", kind: "auto", status: "open", fields: [] })).toEqual({ kind: "jump", target: "gv-links" });
        expect(itemLink({ ...base, id: "export", kind: "manual", status: "open" })).toBeNull();
        expect(itemLink({ ...base, id: "export", kind: "manual", status: "open" }, { canExport: true })).toMatchObject({ kind: "download", href: "/api/settings/archive-export?format=csv" });
        expect(itemLink({ ...base, id: "backup", kind: "manual", status: "open" })).toBeNull();
        expect(itemLink({ ...base, id: "talk", kind: "manual", status: "open" })).toMatchObject({ to: "/settings/all?section=discordserver&tab=links" });
        // #957 review: the categories' versions are the server's, the guild banks are shared
        expect(itemLink({ ...base, id: "categories", kind: "auto", status: "open", total: 1, missing: [], target: [] })).toEqual({ kind: "route", to: "/settings?section=kategorieversion", label: "Spielversion je Kategorie" });
        expect(itemLink({ ...base, id: "guildBank", kind: "auto", status: "open", banks: [] })).toMatchObject({ kind: "route", to: "/settings/all?section=verbindungen" });
    });
});
