import { describe, expect, it } from "vitest";
import { menuFamily } from "../../app/menu";
import { activeTab, discordTabOrder, scrollToShow } from "../tabs";

describe("discord tabs", () => {
    it("shows the overview as the first tab, Kanäle second", () => {
        const ids = discordTabOrder(menuFamily("channels")).map((e) => e.id);
        expect(ids.slice(0, 2)).toEqual(["discordOverview", "channels"]);
    });

    it("keeps the order when the landing page is not among the items", () => {
        const items = menuFamily("channels").filter((e) => e.id !== "discordOverview");
        expect(discordTabOrder(items)).toEqual(items);
    });

    it("marks the overview on its own path and Kanäle on /channels", () => {
        const items = menuFamily("channels");
        expect(activeTab(items, "/channels/overview")).toBe("discordOverview");
        expect(activeTab(items, "/channels")).toBe("channels");
        expect(activeTab(items, "/channels/server-roles")).toBe("serverRoles");
    });
});

describe("scrollToShow", () => {
    // A bar 358 px wide at x = 16, its content 400 px; the tab at content x = from.
    function geometry(scrollLeft: number, from: number, width: number) {
        const bar = { scrollLeft, clientWidth: 358, getBoundingClientRect: () => ({ left: 16 }) } as unknown as HTMLElement;
        const tab = { getBoundingClientRect: () => ({ left: 16 + from - scrollLeft, width }) } as unknown as HTMLElement;
        return [bar, tab] as const;
    }

    it("leaves the bar alone when the tab is already whole in view", () => {
        expect(scrollToShow(...geometry(0, 100, 60))).toBe(0);
    });

    it("scrolls just far enough to show a tab cut off at the right edge, with room for the button", () => {
        expect(scrollToShow(...geometry(0, 320, 80))).toBe(320 + 80 + 32 - 358);
    });

    it("scrolls back to a tab hidden on the left, never below zero", () => {
        expect(scrollToShow(...geometry(42, 10, 60))).toBe(0);
        expect(scrollToShow(...geometry(200, 100, 60))).toBe(68);
    });
});
