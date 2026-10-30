// The adminOnly menu entry (Systemstatus, docs/system-status.md): only a full
// admin gets its line, whatever areas a role holds.
import { describe, expect, it } from "vitest";
import { MENU, entryHref, firstAllowedTab, isNeutralPage, mayOpen, menuLines, ownsPath } from "./menu";
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

describe("Alle Server › Einstellungen (#957)", () => {
    const settingsAll = MENU.find((e) => e.id === "settingsAll")!;

    it("is a full-admin-only line of the block Alle Server, with its own WoW icon", () => {
        expect(settingsAll).toMatchObject({ href: "/settings/all", scope: "all", adminOnly: true, areas: [], icon: "settings" });
        expect(menuLines({ id: "1", name: "A", isAdmin: true, access: {} }).map((l) => l.top.id)).toEqual(expect.arrayContaining(["settings", "settingsAll"]));
        // a settings writer keeps System › Einstellungen but never gets the shared page
        expect(menuLines(everyArea).map((l) => l.top.id)).toContain("settings");
        expect(menuLines(everyArea).map((l) => l.top.id)).not.toContain("settingsAll");
    });

    it("leaves /settings/all to its own line, so System › Einstellungen is not lit there too", () => {
        expect(ownsPath("/settings", "/settings")).toBe(true);
        expect(ownsPath("/settings", "/settings/all")).toBe(false);
        expect(ownsPath("/settings/all", "/settings/all")).toBe(true);
        expect(ownsPath("/settings/all", "/settings")).toBe(false);
        // sub routes of other entries are still owned by their parent
        expect(ownsPath("/raids", "/raids/new")).toBe(true);
    });
});

describe("version-neutral pages (#742)", () => {
    it("are Kanaele, Rollen, Rollen-Nachrichten, both Einstellungen, Systemstatus and Vermerke - the one list; every other page follows the version", () => {
        expect(MENU.filter((e) => e.neutral).map((e) => e.id).sort()).toEqual(["channels", "discordOverview", "members", "roleMessages", "serverRoles", "settings", "settingsAll", "system", "vermerke"]);
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

describe("where a limited account lands", () => {
    const channelsOnly: SessionUser = { id: "3", name: "C", isAdmin: false, access: { channels: { read: true, write: false } } };

    it("follows an entry's landing page: the channels area alone opens the Discord overview", () => {
        const start = firstAllowedTab(channelsOnly)!;
        expect(start.id).toBe("channels");
        expect(entryHref(channelsOnly, start)).toBe("/channels/overview");
    });

    it("keeps the entry's own href when it has no landing page", () => {
        const settings = MENU.find((e) => e.id === "settings")!;
        expect(entryHref(everyArea, settings)).toBe("/settings");
    });
});
