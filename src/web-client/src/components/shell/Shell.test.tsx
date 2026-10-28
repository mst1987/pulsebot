// The sidebar (components/shell/Shell.tsx) draws the one shared menu
// (src/config/menu.json via lib/app/menu.ts): every entry the account may open as a
// link with its WoW icon, grouped under its heading, and the logout always in
// the foot (#435: formerly source scans in test/web-client/menuAccess.test.js).
//
// The menu is short and flat (design "C · Schmale Icon-Leiste"): no entry folds
// out. The sub pages of an entry — the raid plan's templates and catalog under
// Raid-Events, the settings sections — live in the page's icon rail
// (SectionRail.test.tsx), and the entry stays active on all of them.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { SessionUser } from "../../api";
import { t, tOr } from "../../i18n";
import { MENU, isAllServers } from "../../lib/app/menu";
import { adminUser, renderPage } from "../../test/render";
import Shell from "./Shell";
import { JobsProvider } from "./Jobs";
import { ConfirmProvider } from "../ui/Modal";
import { usePageCrumb } from "../../hooks/usePageCrumb";

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
// "Einstellungen" stands twice (System and Alle Server, #957): those lines are found by their href
const entryAt = (href: string) => within(nav()).getAllByRole("link").find((a) => a.getAttribute("href") === href)!;

describe("the sidebar", () => {
    it("is rendered from the shared menu file, every top-level entry with its WoW icon", () => {
        showShell(adminUser());
        // a line with a landing page (Discord → its overview) leads there; the server's
        // pages come first, the pages without a server below "Alle Server" (#918)
        const top = MENU.filter((e) => !e.sub);
        const ordered = [...top.filter((e) => !isAllServers(e)), ...top.filter((e) => isAllServers(e))];
        expect(hrefs()).toEqual(ordered.map((e) => e.landing ?? e.href));
        for (const e of MENU.filter((m) => !m.sub)) {
            const link = entryAt(e.landing ?? e.href);
            expect(link).toHaveAccessibleName(tOr(`shell.menu.${e.id}`, e.label));
            expect(link.querySelector("img")?.getAttribute("src")).toContain(e.wowIcon);
        }
    });

    it("prints each group heading once, above its entries", () => {
        showShell(adminUser());
        const groups = [...new Set(MENU.map((e) => e.group))];
        for (const group of groups) expect(within(nav()).getAllByText(tOr(`shell.group.${group}`, group))).toHaveLength(1);
    });

    it("splits the menu into the server's block and one block \"Alle Server\" below it (#918)", () => {
        showShell(adminUser());
        const heading = within(nav()).getByText(t("shell.group.allServers"));
        expect(heading).toHaveClass("menu-label", "menu-all");
        const below = (href: string) => Boolean(heading.compareDocumentPosition(entryAt(href)) & Node.DOCUMENT_POSITION_FOLLOWING);
        // pages without a server: below the heading - the shared settings too (#957)
        for (const href of ["/profile", "/addon", "/settings/all", "/system"]) expect(below(href)).toBe(true);
        // the server's pages, its own settings included: above it
        for (const href of ["/", "/raids", "/roster", "/settings"]) expect(below(href)).toBe(false);
    });

    it("prints no \"Alle Server\" heading for an account that opens none of those pages", () => {
        showShell({ id: "u5", name: "Rai", isAdmin: false, access: { raids: { read: true, write: false } } });
        expect(within(nav()).queryByText(t("shell.group.allServers"))).not.toBeInTheDocument();
    });

    it("gives Alle Server › Einstellungen to full admins only; a settings writer keeps System › Einstellungen (#957)", () => {
        showShell({ id: "u6", name: "Orga", isAdmin: false, access: { settings: { read: true, write: true } } });
        expect(hrefs()).toContain("/settings");
        expect(hrefs()).not.toContain("/settings/all");
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

    it("shows the account's Discord picture in the user circle, else its initial", () => {
        const view = showShell({ ...adminUser(), name: "Devihra", avatarUrl: "https://cdn/me.png" });
        const circle = view.container.querySelector(".side-foot .avatar");
        expect(circle?.querySelector("img")).toHaveAttribute("src", "https://cdn/me.png");
        view.unmount();
        const plain = showShell({ ...adminUser(), name: "Devihra" });
        expect(plain.container.querySelector(".side-foot .avatar")).toHaveTextContent("D");
        expect(plain.container.querySelector(".side-foot .avatar img")).toBeNull();
    });
});

describe("the orga mark in the top bar", () => {
    const audience = {
        signup: { everyone: true, roles: [], writers: [], accounts: 0 },
        channels: { everyone: false, roles: ["Raidleitung"], writers: [], accounts: 0 },
    };
    const header = () => screen.getByRole("banner");

    it("sits in the top bar after the breadcrumbs on an orga page, naming who sees it, and is gone from the content", () => {
        showShell(adminUser({ audience, canViewAs: true }), "/channels");
        const chip = within(header()).getByRole("note");
        expect(chip).toHaveAccessibleName(`${t("shell.orga.label")} · ${t("shell.orga.pageHidden")} · ${t("shell.orga.visibleFor", { who: "Admins · @Raidleitung" })}`);
        expect(chip.previousElementSibling).toHaveClass("crumbs");
        expect(header()).toHaveClass("is-orga");
        expect(within(header()).getByRole("button", { name: t("shell.orga.asRaider") })).toBeInTheDocument();
        expect(document.querySelector(".content .orga-chip, .orga-bar")).toBeNull();
    });

    it("marks nothing on a page every raider may open", () => {
        showShell(adminUser({ audience, canViewAs: true }), "/signups");
        expect(screen.queryByRole("note")).not.toBeInTheDocument();
        expect(header()).not.toHaveClass("is-orga");
    });
});

describe("the active entry", () => {
    it.each([
        ["/raids", "Raid-Events"],
        ["/raids/new", "Raid-Events"],
        ["/raids/plan-templates", "Raid-Events"],
        ["/raids/plan-catalog", "Raid-Events"],
        ["/settings", "/settings"],
        ["/settings?section=kategorien", "/settings"],
        // #957: the shared settings light their own line, not System › Einstellungen as well
        ["/settings/all", "/settings/all"],
        ["/settings/all?section=discordserver", "/settings/all"],
    ])("%s keeps %s active", (route, line) => {
        showShell(adminUser(), route);
        const active = line.startsWith("/") ? entryAt(line) : entry(line);
        expect(active).toHaveClass("nav-item", "active");
        expect(active).toHaveAttribute("aria-current", "page");
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

describe("the roster's sub pages (#654)", () => {
    function NamedPage() {
        usePageCrumb("Raid Mo / Do");
        return <p>page</p>;
    }

    function showWithPage(route: string) {
        const user = adminUser();
        return render(
            <JobsProvider>
                <ConfirmProvider>
                    <MemoryRouter initialEntries={[route]}>
                        <Routes>
                            <Route element={<Shell user={user} guilds={[]} activeGuildId="" />}>
                                <Route path="roster/r/:rosterId" element={<NamedPage />} />
                                <Route path="roster/chars" element={<p>chars</p>} />
                            </Route>
                        </Routes>
                    </MemoryRouter>
                </ConfirmProvider>
            </JobsProvider>,
        );
    }

    it.each([["/roster/r/raid-mo-do"], ["/roster/chars"]])("%s keeps Roster active", (route) => {
        showShell(adminUser(), route);
        expect(entry("Roster")).toHaveClass("active");
    });

    it("shows the name a page sets as the third crumb, with Roster as a link back", async () => {
        showWithPage("/roster/r/raid-mo-do");
        const crumbs = document.querySelector(".crumbs") as HTMLElement;
        expect(await within(crumbs).findByText("Raid Mo / Do")).toBeInTheDocument();
        expect(within(crumbs).getByRole("link", { name: "Roster" })).toHaveAttribute("href", "/roster");
    });

    it("names the character list in the crumbs", () => {
        showWithPage("/roster/chars");
        expect(within(document.querySelector(".crumbs") as HTMLElement).getByText("Alle Charaktere")).toBeInTheDocument();
    });
});
