// A picked raid category brings its own council filters from the server — the
// in-game addon gets its council with exactly these — and a change to them is
// saved there for the whole orga. Without a category the browser keeps its own.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { bisListsData, councilData } from "../../test/councilFixtures";
import { adminUser, renderPage, twoVersions } from "../../test/render";
import LootCouncilPage from "./LootCouncilPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
    getCouncilViews: vi.fn(),
    saveCouncilView: vi.fn(),
}));

const DEFAULTS = { role: "caster", tiers: [], contents: [], bisTier: "", version: "" };

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const data = councilData();
    data.options.categories = [{ id: "c1", name: "Montagsraid" }, { id: "c2", name: "Softres-Raid" }] as typeof data.options.categories;
    vi.mocked(api.getLootCouncil).mockResolvedValue(data);
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
    vi.mocked(api.getCouncilViews).mockResolvedValue({
        views: { c1: { role: "healer", tiers: ["t6"], contents: [], bisTier: "t6", version: "tbc" } },
        defaults: DEFAULTS,
        councilCategories: ["c1"],
    });
    vi.mocked(api.saveCouncilView).mockImplementation(async (category, view) => ({ category, view }));
});

/** Start the page on a category, as a stored browser view would. */
function startOn(category: string) {
    localStorage.setItem("eh-lootcouncil.view", JSON.stringify({ category }));
}

describe("council filters per raid category", () => {
    it("loads a picked category with its stored filters and says they reach the game", async () => {
        startOn("c1");
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Gilt auch fürs Spiel")).toBeInTheDocument();
        expect(api.getLootCouncil).toHaveBeenCalledTimes(1);
        expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c1", role: "healer", tiers: ["t6"], bisTier: "t6" }));
        // Nothing changed, so nothing is saved.
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });

    it("saves a changed filter of the category on the server, not in the browser", async () => {
        const user = userEvent.setup();
        startOn("c1");
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Gilt auch fürs Spiel");
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Caster/ }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "c1", role: "caster", tiers: ["t6"] })));
        await waitFor(() => expect(api.saveCouncilView).toHaveBeenCalledWith("c1", { role: "caster", tiers: ["t6"], contents: [], bisTier: "t6", version: "tbc" }), { timeout: 2000 });
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}").role).toBeUndefined();
    });

    it("stores the menu's game version with the view", async () => {
        startOn("c1");
        renderPage(<LootCouncilPage />, { route: "/lootcouncil", content: twoVersions({ mainVersion: "forever" }) });
        await screen.findByText("Gilt auch fürs Spiel");
        await waitFor(() => expect(api.saveCouncilView).toHaveBeenCalledWith("c1", expect.objectContaining({ role: "healer", version: "forever" })), { timeout: 2000 });
    });

    it("starts a category without a stored view on the defaults and keeps the hint off for a non-council one", async () => {
        startOn("c2");
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c2", role: "caster", tiers: [] })));
        await screen.findByText("Anna");
        expect(screen.queryByText("Gilt auch fürs Spiel")).not.toBeInTheDocument();
    });

    it("saves nothing for a reader without write access", async () => {
        const user = userEvent.setup();
        startOn("c1");
        renderPage(<LootCouncilPage />, {
            route: "/lootcouncil",
            user: adminUser({ isAdmin: false, access: { lootcouncil: { read: true, write: false } } }),
        });
        await screen.findByText("Gilt auch fürs Spiel");
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Caster/ }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ role: "caster" })));
        await new Promise((r) => setTimeout(r, 800));
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });

    it("keeps the browser's own filters without a category", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Anna");
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Heiler/ }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "", role: "healer" })));
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}").role).toBe("healer");
        await new Promise((r) => setTimeout(r, 800));
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });

    it("falls back to the browser's filters when the stored views cannot be read", async () => {
        vi.mocked(api.getCouncilViews).mockRejectedValue(new Error("down"));
        startOn("c1");
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c1", role: "caster" })));
        expect(screen.queryByText("Gilt auch fürs Spiel")).not.toBeInTheDocument();
    });
});
