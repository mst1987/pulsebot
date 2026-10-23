// The adminOnly menu entry (Systemstatus, docs/system-status.md): only a full
// admin gets its line, whatever areas a role holds.
import { describe, expect, it } from "vitest";
import { MENU, firstAllowedTab, isNeutralPage, mayOpen, menuLines } from "./menu";
import type { SessionUser } from "../../api";

const system = MENU.find((e) => e.id === "system")!;
const everyArea: SessionUser = {
    id: "u9", name: "Viel", isAdmin: false,
    access: Object.fromEntries(["dashboard", "signup", "raids", "raidplan", "cla", "history", "loot", "lootcouncil", "roster", "kader", "recruitment", "channels", "settings"].map((a) => [a, { read: true, write: true }])),
};

describe("menu line landing page", () => {
    it("leads the Discord line to its overview and stays active on the whole family", () => {
        const line = menuLines(everyArea).find((l) => l.top.id === "channels")!;
        expect(line.href).toBe("/channels/overview");
        expect(line.hrefs).toEqual(expect.arrayContaining(["/channels", "/channels/overview", "/channels/server-roles"]));
    });

    it("leads a line without landing page to its own href", () => {
        expect(menuLines(everyArea).find((l) => l.top.id === "roster")!.href).toBe("/roster");
    });
});

describe("adminOnly menu entries", () => {
    it("has the system status as one, with no area", () => {
        expect(system).toMatchObject({ href: "/system", group: "System", areas: [], adminOnly: true });
    });

    it("opens it for a full admin only", () => {
        expect(mayOpen({ id: "1", name: "A", isAdmin: true, access: {} }, system)).toBe(true);
        expect(mayOpen(everyArea, system)).toBe(false);
        expect(mayOpen(null, system)).toBe(false);
    });

    it("gives the line to admins and keeps it out of everyone else's menu", () => {
        expect(menuLines({ id: "1", name: "A", isAdmin: true, access: {} }).map((l) => l.top.id)).toContain("system");
        expect(menuLines(everyArea).map((l) => l.top.id)).not.toContain("system");
    });

    it("never lands a limited account on it", () => {
        expect(firstAllowedTab({ id: "2", name: "B", isAdmin: false, access: {} })).toBeNull();
    });
});

describe("version-neutral pages (#742)", () => {
    it("are Kanaele, Rollen, Rollen-Nachrichten, Einstellungen and Systemstatus - the one list; every other page follows the version", () => {
        expect(MENU.filter((e) => e.neutral).map((e) => e.id).sort()).toEqual(["channels", "discordOverview", "roleMessages", "serverRoles", "settings", "system"]);
    });

    it("count an addon's detail page as neutral, while the page Addons itself follows the version", () => {
        const addon = MENU.find((e) => e.id === "addon")!;
        const settings = MENU.find((e) => e.id === "settings")!;
        expect(isNeutralPage(addon, "/addon")).toBe(false);
        expect(isNeutralPage(addon, "/addon/levelhelper")).toBe(true);
        expect(isNeutralPage(addon, "/addon/levelhelper/")).toBe(true);
        expect(isNeutralPage(addon, "/addon/a/b")).toBe(false);
        expect(isNeutralPage(settings, "/settings")).toBe(true);
        expect(isNeutralPage(undefined, "/")).toBe(false);
    });
});
