// The section column of a page with many sections (Einstellungen): a heading
// per group, each entry with its WoW icon, a round count badge for what is open
// there, and the active entry marked for the screen reader too.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SectionNav, { type NavGroup } from "./SectionNav";

const GROUPS: NavGroup[] = [
    { group: "Verbindungen", items: [
        { id: "verbindungen", label: "Verbindungen", icon: "inv_misc_horn_01", badge: { count: 2, tone: "mid", tip: "2 Verbindungen nicht eingerichtet" } },
        { id: "discordserver", label: "Discord-Server", icon: "inv_letter_15", badge: { count: 0, tone: "mid" } },
    ] },
    { group: "Module", items: [{ id: "logs", label: "Log-Auswertung", icon: "inv_misc_pocketwatch_01", badge: null }] },
];

describe("SectionNav", () => {
    it("prints each group heading once, over its entries", () => {
        render(<SectionNav groups={GROUPS} active="logs" onSelect={() => undefined} ariaLabel="Bereiche" />);
        const nav = screen.getByRole("navigation", { name: "Bereiche" });
        expect(within(nav).getAllByText("Verbindungen")).toHaveLength(2); // heading + entry
        expect(within(nav).getAllByText("Module")).toHaveLength(1);
        expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Verbindungen2", "Discord-Server", "Log-Auswertung"]);
    });

    it("leads each entry with its WoW icon", () => {
        render(<SectionNav groups={GROUPS} active="logs" onSelect={() => undefined} ariaLabel="Bereiche" />);
        const entry = screen.getByRole("button", { name: /Log-Auswertung/ });
        const icon = entry.querySelector("img")!;
        expect(icon.getAttribute("src")).toContain("/inv_misc_pocketwatch_01.jpg");
        expect(icon).toHaveAttribute("width", "24");
    });

    it("shows a count badge with its tooltip only when something is open there", () => {
        render(<SectionNav groups={GROUPS} active="logs" onSelect={() => undefined} ariaLabel="Bereiche" />);
        const badge = within(screen.getByRole("button", { name: /Verbindungen/ })).getByText("2");
        expect(badge).toHaveClass("badge", "count", "mid");
        expect(badge).toHaveAttribute("data-tip", "2 Verbindungen nicht eingerichtet");
        expect(screen.getByRole("button", { name: "Discord-Server" }).querySelector(".badge")).toBeNull();
    });

    it("marks the active entry and reports a click", async () => {
        const onSelect = vi.fn();
        render(<SectionNav groups={GROUPS} active="logs" onSelect={onSelect} ariaLabel="Bereiche" />);
        expect(screen.getByRole("button", { name: /Log-Auswertung/ })).toHaveAttribute("aria-current", "true");
        expect(screen.getByRole("button", { name: "Discord-Server" })).not.toHaveAttribute("aria-current");
        await userEvent.click(screen.getByRole("button", { name: "Discord-Server" }));
        expect(onSelect).toHaveBeenCalledWith("discordserver");
    });
});
