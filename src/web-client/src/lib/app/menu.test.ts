// The adminOnly menu entry (Systemstatus, docs/system-status.md): only a full
// admin gets its line, whatever areas a role holds.
import { describe, expect, it } from "vitest";
import { MENU, firstAllowedTab, mayOpen, menuLines } from "./menu";
import type { SessionUser } from "../../api";

const system = MENU.find((e) => e.id === "system")!;
const everyArea: SessionUser = {
    id: "u9", name: "Viel", isAdmin: false,
    access: Object.fromEntries(["dashboard", "signup", "raids", "raidplan", "cla", "history", "loot", "lootcouncil", "roster", "kader", "recruitment", "channels", "settings"].map((a) => [a, { read: true, write: true }])),
};

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
