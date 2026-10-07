// The drop check (/lootcouncil/drop/:itemId) against a mocked council API, in
// German and in English (#440). The simulation is switched off in the payload,
// so the page stays on "not simulated" and never starts a run.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { councilData, councilFocus } from "../../test/councilFixtures";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import DropCheckPage from "./DropCheckPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    searchCouncilItems: vi.fn(),
    getCouncilViews: vi.fn(),
    saveCouncilView: vi.fn(),
}));

const PATH = "/lootcouncil/drop/:itemId?";

beforeEach(() => {
    vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({
        focus: councilFocus(),
        sim: { available: false, version: "", hint: "" },
    }));
    vi.mocked(api.getCouncilViews).mockResolvedValue({
        views: { c1: { role: "healer", tiers: ["t5"], contents: [], bisTier: "", version: "" } },
        defaults: { role: "caster", tiers: [], contents: [], bisTier: "", version: "" },
        councilCategories: ["c1"],
    });
});

describe("drop check with a raid category", () => {
    it("asks with the category's stored filters and never saves them", async () => {
        localStorage.setItem("eh-lootcouncil.view", JSON.stringify({ category: "c1" }));
        renderPage(<DropCheckPage />, { route: "/lootcouncil/drop/200", path: PATH });
        expect(await screen.findByText("Alle, die ihn tragen können")).toBeInTheDocument();
        expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c1", role: "healer", tiers: ["t5"], item: 200 }));
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });
});

describe("drop check (German)", () => {
    it("asks for an item first", () => {
        renderPage(<DropCheckPage />, { route: "/lootcouncil/drop", path: PATH });
        expect(screen.getByText("Wer bekommt den Drop?")).toBeInTheDocument();
        expect(screen.getByText(/Noch kein Item gewählt/)).toBeInTheDocument();
    });

    it("lists the candidates of a drop", async () => {
        renderPage(<DropCheckPage />, { route: "/lootcouncil/drop/200", path: PATH });
        expect(await screen.findByText("Alle, die ihn tragen können")).toBeInTheDocument();
        expect(screen.getByText("Staff of Test")).toBeInTheDocument();
    });
});

describe("drop check (English)", () => {
    beforeEach(() => switchLang("en"));
    afterEach(() => switchLang("de"));

    it("asks for an item first", () => {
        renderPage(<DropCheckPage />, { route: "/lootcouncil/drop", path: PATH });
        expect(screen.getByText("Who gets the drop?")).toBeInTheDocument();
        expect(screen.getByText("Loot council › Check drop")).toBeInTheDocument();
        expect(screen.getByText(/No item chosen yet/)).toBeInTheDocument();
    });

    it("shows the recommendation and the candidates in English", async () => {
        renderPage(<DropCheckPage />, { route: "/lootcouncil/drop/200", path: PATH });
        expect(await screen.findByText("Everyone who can wear it")).toBeInTheDocument();
        expect(screen.getByText(/^Not simulated yet\. Without a simulation/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Gain" })).toBeInTheDocument();
        expect(screen.getByText("not simulated")).toBeInTheDocument();
    });
});
