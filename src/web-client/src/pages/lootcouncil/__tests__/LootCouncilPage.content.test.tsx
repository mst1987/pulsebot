// The council of a version without content data (#748): no BiS tabs, no tier filter,
// no simulation - an honest hint instead - while the raiders and their needs stay.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { bisListsData, councilData } from "../../../test/councilFixtures";
import { renderPage } from "../../../test/render";
import LootCouncilPage from "../LootCouncilPage";
import { councilContent } from "../model/council";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
    getManualBis: vi.fn(),
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
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster" });
        expect(await screen.findByText("Anna")).toBeInTheDocument();
        expect(screen.getByText(/Für diese Spielversion gibt es noch keine BiS-Listen und keine Simulation/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Offene BiS-Items/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "BiS-Listen" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Loot-Vergleich/ })).toBeInTheDocument();
    });

    it("opens the Raider tab although a BiS tab was stored", async () => {
        localStorage.setItem("lootcouncil.view", JSON.stringify({ tab: "bislists" }));
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({ content: NONE, gaps: [] }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster" });
        expect(await screen.findByText("Anna")).toBeInTheDocument();
        expect(api.getBisLists).not.toHaveBeenCalled();
    });

    it("keeps the filter free of tiers, the BiS list and the simulation line", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({ content: NONE, gaps: [] }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster" });
        await user.click(await screen.findByRole("button", { name: /Filter/ }));
        expect(screen.queryByText("BiS-Liste")).not.toBeInTheDocument();
        expect(screen.queryByText("Simulation")).not.toBeInTheDocument();
        expect(screen.getByText("Gear-Quelle")).toBeInTheDocument();
    });

    it("on hand lists (#760): both BiS tabs, a calm hint while no list exists, the editor instead of the WoWSims matrix", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getManualBis).mockResolvedValue({
            versionId: "forever", versionLabel: "WoW Forever", available: true, off: false, search: true, maxPerSlot: 3,
            slots: [{ slot: 0, slotName: "Kopf" }], specs: [], lists: {},
        });
        // the hint follows the server's flag, not the raiders (an empty roster or other specs say nothing about the lists)
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({
            content: { ...NONE, manualBis: true, manualLists: false }, gaps: [], sim: { available: false, version: "", hint: "" }, versionId: "forever",
        }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster" });
        expect(await screen.findByText("Anna")).toBeInTheDocument();
        expect(screen.queryByText(/noch keine BiS-Listen und keine Simulation/)).not.toBeInTheDocument();
        expect(screen.getByText(/Legt sie je Spec im Tab „BiS-Listen“ an/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Offene BiS-Items/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Filter/ })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Zu den BiS-Listen" }));
        await waitFor(() => expect(api.getManualBis).toHaveBeenCalledWith("forever"));
        expect(api.getBisLists).not.toHaveBeenCalled();
        // the editor filters nothing: no filter line there
        expect(screen.queryByRole("button", { name: /Filter/ })).not.toBeInTheDocument();
    });

    it("on hand lists with a list: no hint; ?tab=bislists opens the editor directly", async () => {
        vi.mocked(api.getManualBis).mockResolvedValue({
            versionId: "forever", versionLabel: "WoW Forever", available: true, off: false, search: true, maxPerSlot: 3,
            slots: [{ slot: 0, slotName: "Kopf" }], specs: [], lists: {},
        });
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({
            content: { ...NONE, manualBis: true, manualLists: true }, gaps: [], sim: { available: false, version: "", hint: "" }, versionId: "forever",
        }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=bislists" });
        await waitFor(() => expect(api.getManualBis).toHaveBeenCalledWith("forever"));
        expect(screen.queryByText(/Legt sie je Spec im Tab „BiS-Listen“ an/)).not.toBeInTheDocument();
    });

    it("shows nothing of this for TBC", async () => {
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData());
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster" });
        expect(await screen.findByRole("button", { name: /Offene BiS-Items/ })).toBeInTheDocument();
        expect(screen.queryByText(/noch keine BiS-Listen/)).not.toBeInTheDocument();
    });
});
