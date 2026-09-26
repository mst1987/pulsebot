// The loot council page as the orga sees it, against a mocked council API: the
// German default and the English texts (#440) of the page head, the four tabs
// and the raider dialog. The structural promises (busy keys, no estimates,
// the sim runner) stay in test/web-client/conventions/council*.test.js.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { bisListsData, councilData } from "../../test/councilFixtures";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import LootCouncilPage from "./LootCouncilPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(api.getLootCouncil).mockResolvedValue(councilData());
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
});

describe("loot council page (German)", () => {
    it("heads the raider tab with its question and the drop check", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Wer ist dran?")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Loot-Council" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Drop prüfen/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Offene BiS-Items/ })).toBeInTheDocument();
        expect(screen.getByText("Anna")).toBeInTheDocument();
    });

    it("opens a raider's details from the url", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?raider=Anna" });
        expect(await screen.findByText("Getragenes Set")).toBeInTheDocument();
        expect(screen.getByText("Loot-Council › Raider · Rang 1 von 1")).toBeInTheDocument();
    });
});

describe("loot council page (English)", () => {
    beforeEach(() => switchLang("en"));
    afterEach(() => switchLang("de"));

    it("shows the head, the tabs and the raider list in English", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Whose turn is it?")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Loot council" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Check drop/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Calculate DPS" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Open BiS items/ })).toBeInTheDocument();
        expect(screen.getByText("Notes")).toBeInTheDocument();
        expect(screen.queryByText("Wer ist dran?")).not.toBeInTheDocument();
    });

    it("translates the open BiS items tab", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await userEvent.click(await screen.findByRole("button", { name: /Open BiS items/ }));
        expect(screen.getByText("What is still missing?")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Simulate all BiS items (1)" })).toBeInTheDocument();
        expect(screen.getByText("Check as drop")).toBeInTheDocument();
    });

    it("translates the BiS lists and the loot comparison", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await userEvent.click(await screen.findByRole("button", { name: "BiS lists" }));
        expect(await screen.findByText("Look up an item")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Item name, e.g. Skull of Gul'dan")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Loot comparison" }));
        expect(screen.getByText("Which raiders side by side")).toBeInTheDocument();
    });

    it("translates the raider dialog", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?raider=Anna" });
        expect(await screen.findByText("Worn set")).toBeInTheDocument();
        expect(screen.getByText("Loot council › Raider · rank 1 of 1")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /BiS gaps/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Get gear from the armory" })).toBeInTheDocument();
    });
});
