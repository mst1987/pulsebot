// The sidebar (components/Shell.tsx) draws the one shared menu
// (src/config/menu.json via lib/menu.ts): every entry the account may open as a
// link with its WoW icon, grouped under its heading, and the logout always in
// the foot (#435: formerly source scans in test/web-client/menuAccess.test.js).
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { SessionUser } from "../api";
import { t, tOr } from "../i18n";
import { MENU } from "../lib/menu";
import { adminUser, renderPage } from "../test/render";
import Shell from "./Shell";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getVersion: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(api.getVersion).mockReturnValue(new Promise(() => undefined));
});

function showShell(user: SessionUser) {
    return renderPage(<Shell user={user} guilds={[]} activeGuildId="" />, { user });
}

describe("the sidebar", () => {
    it("is rendered from the shared menu file, every entry with its WoW icon", () => {
        showShell(adminUser());
        const nav = screen.getByRole("navigation");
        const links = within(nav).getAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(MENU.map((e) => e.href));
        for (const entry of MENU) {
            const link = within(nav).getByRole("link", { name: tOr(`shell.menu.${entry.id}`, entry.label) });
            expect(link).toHaveAttribute("href", entry.href);
            expect(link.querySelector("img")?.getAttribute("src")).toContain(entry.wowIcon);
        }
    });

    it("prints each group heading once, above its entries", () => {
        showShell(adminUser());
        const nav = screen.getByRole("navigation");
        const groups = [...new Set(MENU.map((e) => e.group))];
        for (const group of groups) expect(within(nav).getAllByText(tOr(`shell.group.${group}`, group))).toHaveLength(1);
    });

    it("shows only the entries the account's areas open", () => {
        showShell({ id: "u5", name: "Rai", isAdmin: false, access: { raids: { read: true, write: false }, loot: { read: true, write: false } } });
        const hrefs = within(screen.getByRole("navigation")).getAllByRole("link").map((a) => a.getAttribute("href"));
        // the raid plan's pages are their own area ("raidplan"), not a part of the raid events
        expect(hrefs).toEqual(["/raids", "/history"]);
    });

    it("indents the raid plan's entries under Raid-Events only while that is shown too", () => {
        const hrefsAndSub = () => within(screen.getByRole("navigation")).getAllByRole("link").map((a) => [a.getAttribute("href"), a.classList.contains("is-sub")]);
        const both = showShell({ id: "u6", name: "Tak", isAdmin: false, access: { raids: { read: true, write: false }, raidplan: { read: true, write: true } } });
        expect(hrefsAndSub()).toEqual([["/raids", false], ["/raids/plan-templates", true], ["/raids/plan-catalog", true]]);
        both.unmount();
        showShell({ id: "u7", name: "Tik", isAdmin: false, access: { raidplan: { read: true, write: false } } });
        expect(hrefsAndSub()).toEqual([["/raids/plan-templates", false], ["/raids/plan-catalog", false]]);
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
