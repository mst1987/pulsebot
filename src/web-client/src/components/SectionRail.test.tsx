// The icon rail of a page with sub sections (SectionRail.tsx): one button per
// section with its WoW icon, the name as tooltip and accessible name, a count on
// the icon for what is open there (its sentence in the tooltip and the name),
// groups apart, the active one marked. MenuRailPage builds it from a menu
// entry's family, only with the pages the account may open.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../api";
import { adminUser, renderPage } from "../test/render";
import { switchLang } from "../test/i18n";
import SectionRail, { MenuRailPage, type RailGroup } from "./SectionRail";

const GROUPS: RailGroup[] = [
    { group: "Verbindungen", items: [
        { id: "verbindungen", label: "Verbindungen", icon: "inv_misc_horn_01", badge: { count: 2, tone: "mid", tip: "2 Verbindungen nicht eingerichtet" } },
        { id: "discordserver", label: "Discord-Server", icon: "inv_letter_15", badge: { count: 0, tone: "mid" } },
    ] },
    { group: "Module", items: [{ id: "logs", label: "Log-Auswertung", icon: "inv_misc_pocketwatch_01", badge: null }] },
];

function showRail(onSelect = vi.fn()) {
    renderPage(<SectionRail groups={GROUPS} active="logs" onSelect={onSelect} ariaLabel="Bereiche" />);
    return within(screen.getByRole("navigation", { name: "Bereiche" }));
}

describe("SectionRail", () => {
    it("draws one button per section, in groups, each with its WoW icon at 24 px", () => {
        const rail = showRail();
        expect(rail.getAllByRole("button").map((b) => b.getAttribute("aria-label")))
            .toEqual(["Verbindungen · 2 Verbindungen nicht eingerichtet", "Discord-Server", "Log-Auswertung"]);
        expect(document.querySelectorAll(".srail-group")).toHaveLength(2);
        const icon = rail.getByRole("button", { name: "Log-Auswertung" }).querySelector("img")!;
        expect(icon.getAttribute("src")).toContain("/inv_misc_pocketwatch_01.jpg");
        expect(icon).toHaveAttribute("width", "24");
    });

    it("names each section in a tooltip to the right that only repeats a hidden label", () => {
        const rail = showRail();
        const btn = rail.getByRole("button", { name: "Log-Auswertung" });
        expect(btn).toHaveAttribute("data-tip", "Log-Auswertung");
        expect(btn).toHaveAttribute("data-tip-side", "right");
        expect(btn).toHaveAttribute("data-tip-repeats");
        expect(btn.querySelector("[data-tip-label]")).toHaveTextContent("Log-Auswertung");
    });

    it("puts the count on the icon and its sentence into the tooltip, only when something is open", () => {
        const rail = showRail();
        const btn = rail.getByRole("button", { name: /^Verbindungen/ });
        const badge = within(btn).getByText("2");
        expect(badge).toHaveClass("badge", "count", "mid", "srail-badge");
        // the button carries the sentence; the badge has no tooltip of its own
        expect(badge).not.toHaveAttribute("data-tip");
        expect(btn).toHaveAttribute("data-tip-sub", "2 Verbindungen nicht eingerichtet");
        expect(rail.getByRole("button", { name: "Discord-Server" }).querySelector(".badge")).toBeNull();
    });

    it("prints the group headings for the chip row below the breakpoint", () => {
        const rail = showRail();
        expect(rail.getByText("Module", { selector: ".srail-label" })).toBeInTheDocument();
    });

    it("marks the active section and reports a click and a key press", async () => {
        const onSelect = vi.fn();
        const rail = showRail(onSelect);
        expect(rail.getByRole("button", { name: "Log-Auswertung" })).toHaveAttribute("aria-current", "true");
        expect(rail.getByRole("button", { name: "Log-Auswertung" })).toHaveClass("active");
        expect(rail.getByRole("button", { name: "Discord-Server" })).not.toHaveAttribute("aria-current");
        await userEvent.click(rail.getByRole("button", { name: "Discord-Server" }));
        expect(onSelect).toHaveBeenCalledWith("discordserver");
        rail.getByRole("button", { name: /^Verbindungen/ }).focus();
        await userEvent.keyboard("{Enter}");
        expect(onSelect).toHaveBeenCalledWith("verbindungen");
    });
});

describe("MenuRailPage (Raid-Events)", () => {
    const page = (user: SessionUser, route: string) => renderPage(
        <MenuRailPage user={user} parent="raids"><p>Seite</p></MenuRailPage>, { user, route },
    );
    const railLinks = () => within(screen.getByRole("navigation", { name: "Seiten von Raid-Events" })).getAllByRole("link");

    it("links the raid list and the raid plan's pages, the open one current", () => {
        page(adminUser(), "/raids/plan-catalog");
        expect(railLinks().map((a) => [a.getAttribute("href"), a.getAttribute("aria-label")])).toEqual([
            ["/raids", "Raid-Events"],
            ["/raids/plan-templates", "Raidplan-Vorlagen"],
            ["/raids/plan-catalog", "Raidplan-Katalog"],
        ]);
        expect(screen.getByRole("link", { current: "page" })).toHaveAttribute("href", "/raids/plan-catalog");
        expect(screen.getByRole("navigation", { name: "Seiten von Raid-Events" })).toHaveClass("srail", "area-raids");
        expect(screen.getByText("Seite").closest(".srail-main")).not.toBeNull();
    });

    it("counts the create dialog's route as the raid list", () => {
        page(adminUser(), "/raids/new");
        expect(screen.getByRole("link", { current: "page" })).toHaveAttribute("href", "/raids");
    });

    it("offers only the pages the account may open", () => {
        page({ id: "u7", name: "Tik", isAdmin: false, access: { raidplan: { read: true, write: false } } }, "/raids/plan-templates");
        expect(railLinks().map((a) => a.getAttribute("href"))).toEqual(["/raids/plan-templates", "/raids/plan-catalog"]);
    });

    it("leaves the rail out when the account may open one page alone", () => {
        page({ id: "u5", name: "Rai", isAdmin: false, access: { raids: { read: true, write: false } } }, "/raids");
        expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
        expect(screen.getByText("Seite")).toBeInTheDocument();
        expect(document.querySelector(".srail-layout")).toBeNull();
    });

    it("speaks English", async () => {
        await switchLang("en");
        page(adminUser(), "/raids");
        const rail = screen.getByRole("navigation", { name: "Pages of Raid events" });
        expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["Raid events", "Raid plan templates", "Raid plan catalog"]);
        await switchLang("de");
    });
});
