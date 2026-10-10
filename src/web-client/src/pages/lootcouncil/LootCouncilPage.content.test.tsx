// The council of a version without content data (#748): no BiS tabs, no tier filter,
// no simulation - an honest hint instead - while the raiders and their needs stay.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { bisListsData, councilData } from "../../test/councilFixtures";
import { renderPage } from "../../test/render";
import LootCouncilPage from "./LootCouncilPage";
import { councilContent } from "./council";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

const NONE = { bis: false, sim: false, tiers: false, itemTable: false };

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
});

describe("councilContent", () => {
    it("is the full TBC council when the answer carries no flags", () => {
        expect(councilContent(councilData())).toEqual({ bis: true, sim: true, tiers: true, itemTable: true });
        expect(councilContent(null)).toEqual({ bis: true, sim: true, tiers: true, itemTable: true });
        expect(councilContent(councilData({ content: NONE }))).toEqual(NONE);
    });
});

describe("loot council page without content data", () => {
    it("hides the BiS tabs, says why, and keeps the raiders", async () => {
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({
            content: NONE, gaps: [], sim: { available: false, version: "", hint: "" }, versionId: "forever",
        }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Anna")).toBeInTheDocument();
        expect(screen.getByText(/Für diese Spielversion gibt es noch keine BiS-Listen und keine Simulation/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Offene BiS-Items/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "BiS-Listen" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Loot-Vergleich/ })).toBeInTheDocument();
    });

    it("opens the Raider tab although a BiS tab was stored", async () => {
        localStorage.setItem("lootcouncil.view", JSON.stringify({ tab: "bislists" }));
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({ content: NONE, gaps: [] }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Anna")).toBeInTheDocument();
        expect(api.getBisLists).not.toHaveBeenCalled();
    });

    it("keeps the filter free of tiers, the BiS list and the simulation line", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({ content: NONE, gaps: [] }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await user.click(await screen.findByRole("button", { name: /Filter/ }));
        expect(screen.queryByText("BiS-Liste")).not.toBeInTheDocument();
        expect(screen.queryByText("Simulation")).not.toBeInTheDocument();
        expect(screen.getByText("Gear-Quelle")).toBeInTheDocument();
    });

    it("shows nothing of this for TBC", async () => {
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData());
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByRole("button", { name: /Offene BiS-Items/ })).toBeInTheDocument();
        expect(screen.queryByText(/noch keine BiS-Listen/)).not.toBeInTheDocument();
    });
});
