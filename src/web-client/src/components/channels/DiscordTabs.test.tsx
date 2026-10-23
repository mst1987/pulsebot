// The tab row of System › Discord: five tabs in order with their counts, the
// short word for the long name (full name stays the accessible name), and on a
// row wider than the screen the active tab scrolled into view plus a chevron at
// the edge with more tabs behind it.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import DiscordTabs from "./DiscordTabs";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordTabCounts: vi.fn(),
}));

const USER = adminUser();

beforeEach(() => {
    vi.mocked(api.getDiscordTabCounts).mockReset().mockResolvedValue({ channels: 31, serverRoles: 5, members: 120, roleMessages: 2 });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("DiscordTabs", () => {
    it("shows five tabs in order, the members count without bots, the long name with its short word", async () => {
        renderPage(<DiscordTabs user={USER} />, { route: "/channels/roles" });
        const nav = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        await waitFor(() => expect(within(nav).getByRole("link", { name: "Mitglieder 120" })).toBeInTheDocument());
        const links = within(nav).getAllByRole("link");
        expect(links.map((l) => l.getAttribute("href"))).toEqual(["/channels/overview", "/channels", "/channels/server-roles", "/channels/members", "/channels/roles"]);
        const active = within(nav).getByRole("link", { name: "Rollen-Nachrichten 2" });
        expect(active).toHaveAttribute("aria-current", "page");
        expect(active).toHaveAttribute("data-tip", "Rollen-Nachrichten: 2");
        expect(within(active).getByText("Nachrichten")).toHaveAttribute("aria-hidden", "true");
        // a short name only where it differs: one text node, no hidden twin
        expect(within(nav).getAllByText("Kanäle")).toHaveLength(1);
    });

    it("scrolls the active tab into view and offers a chevron towards the hidden tabs", async () => {
        // A phone: the bar 358 px wide, its tabs 420 px, each tab 70 px plus 16 gap.
        const proto = HTMLElement.prototype;
        vi.spyOn(proto, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.classList.contains("dtab-bar") ? 358 : 0;
        });
        vi.spyOn(proto, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.classList.contains("dtab-bar") ? 420 : 0;
        });
        vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            const bar = this.closest(".dtab-bar") as HTMLElement | null;
            const scroll = bar?.scrollLeft || 0;
            if (this.classList.contains("dtab-bar")) return { left: 16, width: 358 } as DOMRect;
            const i = bar ? [...bar.children].indexOf(this) : 0;
            return { left: 16 + i * 86 - scroll, width: 70 } as DOMRect;
        });
        const scrollBy = vi.fn();
        proto.scrollBy = scrollBy as unknown as typeof proto.scrollBy;

        renderPage(<DiscordTabs user={USER} />, { route: "/channels/roles" });
        const nav = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        // the last tab (4 * 86 = 344 .. 414) is cut off at 358: scrolled to 414 + 32 - 358
        expect(nav.scrollLeft).toBe(88);
        expect(await screen.findByRole("button", { name: "Weitere Reiter links" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Weitere Reiter rechts" })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Weitere Reiter links" }));
        expect(scrollBy).toHaveBeenCalledWith({ left: -215, behavior: "smooth" });
    });

    it("needs no chevron when every tab fits, and names the tabs in English", async () => {
        await switchLang("en");
        renderPage(<DiscordTabs user={USER} />, { route: "/channels/overview" });
        const nav = screen.getByRole("navigation", { name: "Discord sections" });
        await waitFor(() => expect(within(nav).getByRole("link", { name: "Members 120" })).toBeInTheDocument());
        expect(within(nav).getByText("Messages")).toHaveAttribute("aria-hidden", "true");
        expect(screen.queryByRole("button", { name: /More tabs/ })).not.toBeInTheDocument();
        await switchLang("de");
    });
});
