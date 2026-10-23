import { describe, expect, it } from "vitest";
import { menuFamily } from "../app/menu";
import { activeTab, discordTabOrder } from "./tabs";

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
