// The council's filter line under the tabs: the role segment and ONE "Filter"
// button that opens Content, raid category, BiS list, gear source and simulation.
// Changes apply live; the button counts the three real filters.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { bisListsData, councilData } from "../../test/councilFixtures";
import { renderPage } from "../../test/render";
import LootCouncilPage from "./LootCouncilPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

beforeEach(() => {
    localStorage.clear();
    const data = councilData();
    data.options.categories = [{ id: "c1", name: "Montagsraid" }] as typeof data.options.categories;
    vi.mocked(api.getLootCouncil).mockResolvedValue(data);
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
});

describe("loot council filter line", () => {
    it("puts the tabs first, then the role segment and a single Filter button", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const filter = await screen.findByRole("button", { name: "Filter" });
        const tabs = screen.getByRole("button", { name: /Offene BiS-Items/ });
        // the tabs come before the filter line in the document
        expect(tabs.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByRole("radiogroup", { name: "Rolle" })).toBeInTheDocument();
        expect(screen.queryByText("Gear: Auswertung")).not.toBeInTheDocument();
        expect(screen.queryByText("Sim aus")).not.toBeInTheDocument();
        // the old card header repeating the tab is gone
        expect(screen.queryByText("Wer ist dran?")).not.toBeInTheDocument();
    });

    it("opens a box with all fields and applies a change live, counting it on the button", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await user.click(await screen.findByRole("button", { name: "Filter" }));

        const box = screen.getByRole("dialog", { name: "Filter" });
        expect(within(box).getByText("Content", { exact: false })).toBeInTheDocument();
        expect(within(box).getByLabelText("Raid-Kategorie")).toBeInTheDocument();
        expect(within(box).getByLabelText("BiS-Liste")).toBeInTheDocument();
        expect(within(box).getByText("Gear-Quelle")).toBeInTheDocument();
        expect(within(box).getByText("Simulation")).toBeInTheDocument();

        await user.selectOptions(within(box).getByLabelText("Raid-Kategorie"), "c1");
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "c1" })));
        expect(await screen.findByRole("button", { name: "Filter · 1 aktiv" })).toBeInTheDocument();
    });

    it("resets the filters from the box", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await user.click(await screen.findByRole("button", { name: "Filter" }));
        await user.selectOptions(screen.getByLabelText("Raid-Kategorie"), "c1");
        await user.click(await screen.findByRole("button", { name: "Zurücksetzen" }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "" })));
        expect(await screen.findByRole("button", { name: "Filter" })).toBeInTheDocument();
    });

    it("offers every council role in the segment (#669)", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const roles = await screen.findByRole("radiogroup", { name: "Rolle" });
        expect(within(roles).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Caster", "Heiler", "Tank", "Nahkampf", "Fernkampf", "Alle"]);
        await user.click(within(roles).getByRole("radio", { name: "Nahkampf" }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ role: "melee" })));
    });

    it("says its numbers with words", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Anna");
        expect(screen.getAllByText(/^Bedarf \d+$/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/^BiS \d+ von \d+$/).length).toBeGreaterThan(0);
    });
});
