// The menu is always there (App.tsx + components/Shell.tsx; #435: formerly
// source scans in test/web-client/menuAccess.test.js):
//   * only a visitor who is not logged in gets no shell,
//   * a logged-in account with nothing granted still gets the sidebar with its
//     logout, a line saying nothing is open, and a notice instead of the dashboard,
//   * tabs and routes ask for a list of areas, so the read-only "loot" area opens
//     the loot views of "Historie & Loot" but not its addon inbox,
//   * an unknown path renders a page of its own instead of a blank one.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { SessionUser } from "./api";
import { t } from "./i18n";
import { MENU, firstAllowedTab } from "./lib/menu";
import App from "./App";

vi.mock("./api", async (orig) => ({
    ...(await orig<typeof import("./api")>()),
    getSession: vi.fn(),
    getDashboard: vi.fn(),
}));

// Pages load their data through fetch; nothing answers in a test, so each
// stays at its loader — enough to tell a page from the guard's refusal.
beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    vi.mocked(api.getDashboard).mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const SLOW = { timeout: 8000 };

const nobody: SessionUser = { id: "u2", name: "Mia", isAdmin: false, access: {} };
const lootOnly: SessionUser = { id: "u3", name: "Lou", isAdmin: false, access: { loot: { read: true, write: false } } };

function showApp(user: SessionUser | null, route = "/") {
    vi.mocked(api.getSession).mockResolvedValue({ user, csrfToken: null, areas: [], guilds: [], activeGuildId: "" });
    return render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);
}

const sidebar = () => screen.getByRole("complementary");

describe("menu access", () => {
    it("shows only the way in to a visitor who is not logged in", async () => {
        showApp(null);
        expect(await screen.findByRole("link", { name: t("shell.app.loginButton") })).toHaveAttribute("href", "/auth/login");
        expect(screen.queryByRole("link", { name: t("shell.logout") })).not.toBeInTheDocument();
        expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    });

    it("keeps the shell for a logged-in account with nothing granted", async () => {
        showApp(nobody);
        expect(await screen.findByRole("link", { name: t("shell.logout") }, SLOW)).toHaveAttribute("href", "/auth/logout");
        expect(within(sidebar()).getByText("Mia")).toBeInTheDocument();
    });

    it("says something in the menu when no tab is allowed", async () => {
        showApp(nobody);
        const nav = await screen.findByRole("navigation", {}, SLOW);
        expect(within(nav).getByText("Kein Bereich freigegeben")).toBeInTheDocument();
        expect(within(nav).queryAllByRole("link")).toEqual([]);
    });

    it("sends an account with no area to a notice rather than the dashboard", async () => {
        showApp(nobody);
        expect(await screen.findByText(t("shell.app.noAccess"), {}, SLOW)).toBeInTheDocument();
        // Rendering the dashboard would ask /api/dashboard and show its 403.
        expect(api.getDashboard).not.toHaveBeenCalled();
    });

    it("checks tabs against a list of areas: the loot area alone opens Historie & Loot", async () => {
        expect(firstAllowedTab(lootOnly)?.id).toBe("history");
        expect(MENU.find((e) => e.id === "history")?.areas).toEqual(["history", "loot"]);
        showApp(lootOnly, "/history");
        const nav = await screen.findByRole("navigation", {}, SLOW);
        expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/history"]);
    });

    it.each([
        ["/history", "Historie wird geladen"],
        ["/history/event?event=e1", "Raid wird geladen"],
        ["/history/char?name=Ahri", "Charakter wird geladen"],
    ])("opens %s for the read-only loot area", async (route, pageLoader) => {
        showApp(lootOnly, route);
        // the page itself (waiting for its data), not the guard's refusal
        expect(await screen.findByText(pageLoader, {}, SLOW)).toBeInTheDocument();
        expect(screen.queryByText(t("shell.app.noRead"))).not.toBeInTheDocument();
    });

    it("keeps the addon inbox closed to the read-only loot area", async () => {
        showApp(lootOnly, "/history/inbox");
        expect(await screen.findByText(t("shell.app.noRead"), {}, SLOW)).toBeInTheDocument();
    });
});

describe("served from the root", () => {
    it("catches an unknown path in the client instead of leaving it blank", async () => {
        showApp({ id: "u1", name: "Admin", isAdmin: true, access: {} }, "/gibt-es-nicht");
        expect(await screen.findByText(t("shell.app.notFound"), {}, SLOW)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("shell.app.backHome") })).toHaveAttribute("href", "/");
        // inside the shell: the menu and the way back stay
        expect(screen.getByRole("navigation")).toBeInTheDocument();
    });
});
