// The sidebar (components/shell/Shell.tsx) draws the one shared menu
// (src/config/menu.json via lib/app/menu.ts): every entry the account may open as a
// link with its WoW icon, grouped under its heading, and the logout always in
// the foot (#435: formerly source scans in test/web-client/menuAccess.test.js).
//
// The menu is short and flat (design "C · Schmale Icon-Leiste"): no entry folds
// out. The sub pages of an entry — the raid plan's templates and catalog under
// Raid-Events, the settings sections — live in the page's icon rail
// (SectionRail.test.tsx), and the entry stays active on all of them.
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { SessionUser } from "../../api";
import { t, tOr } from "../../i18n";
import { MENU } from "../../lib/app/menu";
import { adminUser, renderPage } from "../../test/render";
import Shell from "./Shell";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getVersion: vi.fn(),
}));

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getVersion).mockReturnValue(new Promise(() => undefined));
});

function showShell(user: SessionUser, route = "/") {
    return renderPage(<Shell user={user} guilds={[]} activeGuildId="" />, { user, route });
}

const nav = () => screen.getByRole("navigation");
const hrefs = () => within(nav()).getAllByRole("link").map((a) => a.getAttribute("href"));
const entry = (name: string) => within(nav()).getByRole("link", { name });

describe("the sidebar", () => {
    it("is rendered from the shared menu file, every top-level entry with its WoW icon", () => {
        showShell(adminUser());
        expect(hrefs()).toEqual(MENU.filter((e) => !e.sub).map((e) => e.href));
        for (const e of MENU.filter((m) => !m.sub)) {
            const link = entry(tOr(`shell.menu.${e.id}`, e.label));
            expect(link).toHaveAttribute("href", e.href);
            expect(link.querySelector("img")?.getAttribute("src")).toContain(e.wowIcon);
        }
    });

    it("prints each group heading once, above its entries", () => {
        showShell(adminUser());
        const groups = [...new Set(MENU.map((e) => e.group))];
        for (const group of groups) expect(within(nav()).getAllByText(tOr(`shell.group.${group}`, group))).toHaveLength(1);
    });

    it("shows only the entries the account's areas open", () => {
        showShell({ id: "u5", name: "Rai", isAdmin: false, access: { raids: { read: true, write: false }, loot: { read: true, write: false } } });
        // the guild bank (#632) is read with "raids"
        expect(hrefs()).toEqual(["/raids", "/history", "/guildbank"]);
    });

    it("folds nothing out: no chevron, no sub entries, no settings sections", () => {
        showShell(adminUser(), "/settings?section=verbindungen");
        expect(within(nav()).queryByRole("button")).not.toBeInTheDocument();
        expect(hrefs()).not.toContain("/raids/plan-templates");
        expect(hrefs().some((h) => h?.includes("?section="))).toBe(false);
    });

    it("puts the logout in the foot for every account, as a plain link to the server", () => {
        for (const user of [adminUser(), { id: "u2", name: "Mia", isAdmin: false, access: {} }]) {
            const view = showShell(user);
            const logout = screen.getByRole("link", { name: t("shell.logout") });
            expect(logout).toHaveAttribute("href", "/auth/logout");
            expect(logout).toHaveAttribute("data-tip", t("shell.logout"));
            view.unmount();
        }
    });
});

describe("the active entry", () => {
    it.each([
        ["/raids", "Raid-Events"],
        ["/raids/new", "Raid-Events"],
        ["/raids/plan-templates", "Raid-Events"],
        ["/raids/plan-catalog", "Raid-Events"],
        ["/settings", "Einstellungen"],
        ["/settings?section=kategorien", "Einstellungen"],
    ])("%s keeps %s active", (route, name) => {
        showShell(adminUser(), route);
        expect(entry(name)).toHaveClass("nav-item", "active");
        expect(entry(name)).toHaveAttribute("aria-current", "page");
        expect(within(nav()).getAllByRole("link", { current: "page" })).toHaveLength(1);
    });

    it("marks the start page only on its own path", () => {
        showShell(adminUser(), "/raids");
        expect(entry("Übersicht")).not.toHaveClass("active");
    });

    it("stands in with the raid plan's first page for an account without the raid events", () => {
        showShell({ id: "u7", name: "Tik", isAdmin: false, access: { raidplan: { read: true, write: false } } }, "/raids/plan-catalog");
        // one line for the family, not one per page — the rail offers the catalog
        expect(hrefs()).toEqual(["/raids/plan-templates"]);
        expect(entry("Raidplan-Vorlagen")).toHaveClass("nav-item", "area-raids", "active");
    });
});
