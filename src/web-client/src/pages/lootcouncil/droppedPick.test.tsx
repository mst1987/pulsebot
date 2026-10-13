// A council pick of another version (#741/#563): the server answers with "Alle
// Raid-Kategorien" of the menu's version and names the pick; the page forgets a
// stale pick (back to the overview's tiles, Oct 2026) and follows a link into the
// roster's version when the menu offers it.
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { LootCouncilData } from "../../api";
import { bisListsData, councilData } from "../../test/councilFixtures";
import { renderPage, twoVersions } from "../../test/render";
import { VIEW_KEY } from "./council";
import { droppedPickStep } from "./droppedPick";
import LootCouncilPage from "./LootCouncilPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
    getCouncilViews: vi.fn(),
    getLootCouncilOverview: vi.fn(async () => ({ versionId: "forever", tiles: [] })),
}));

const TBC_ROSTER = { kind: "roster" as const, id: "montag", versionId: "tbc" };

describe("droppedPickStep", () => {
    it("does nothing without a dropped pick", () => {
        expect(droppedPickStep(null, { linked: "", offered: ["tbc", "forever"] })).toBe("none");
    });

    it("follows a linked roster into its version when the menu offers it", () => {
        expect(droppedPickStep(TBC_ROSTER, { linked: "montag", offered: ["tbc", "forever"] })).toBe("follow");
    });

    it("resets a stale pick, a category, and a linked roster of a hidden version", () => {
        expect(droppedPickStep(TBC_ROSTER, { linked: "", offered: ["tbc", "forever"] })).toBe("reset");
        expect(droppedPickStep({ kind: "category", id: "pug", versionId: "tbc" }, { linked: "pug", offered: ["tbc", "forever"] })).toBe("reset");
        expect(droppedPickStep(TBC_ROSTER, { linked: "montag", offered: ["forever"] })).toBe("reset");
    });
});

function droppedData(): LootCouncilData {
    const data = councilData();
    data.council = { ...data.council, target: "all", dropped: TBC_ROSTER };
    return data;
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
    vi.mocked(api.getCouncilViews).mockResolvedValue({ views: {}, targets: {}, defaults: { role: "caster", tiers: [], contents: [], bisTier: "", version: "" }, councilCategories: [], councilRosters: [] } as unknown as Awaited<ReturnType<typeof api.getCouncilViews>>);
});

describe("the council page with a pick of another version", () => {
    it("forgets a stored TBC roster in the Forever menu and goes back to the Forever overview", async () => {
        localStorage.setItem(`eh-${VIEW_KEY}`, JSON.stringify({ roster: "montag", category: "" }));
        vi.mocked(api.getLootCouncil).mockImplementation(async (filter) => (filter && filter.roster ? droppedData() : councilData()));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?tab=roster", content: FOREVER_MAIN });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ roster: "montag", version: "forever" })));
        // the views are asked for the menu's version: a TBC roster has no target there
        expect(api.getCouncilViews).toHaveBeenCalledWith("forever");
        // the pick is forgotten and the page is the tiles of the Forever councils
        await waitFor(() => expect(api.getLootCouncilOverview).toHaveBeenCalledWith("forever"));
        expect(JSON.parse(localStorage.getItem(`eh-${VIEW_KEY}`) || "{}")).toMatchObject({ roster: "", category: "" });
        expect(api.getLootCouncil).not.toHaveBeenCalledWith(expect.objectContaining({ roster: "", category: "" }));
    });

    it("follows a link to a TBC roster into TBC when the menu offers it", async () => {
        vi.mocked(api.getLootCouncil).mockImplementation(async (filter) => (filter && filter.roster && filter.version === "forever" ? droppedData() : councilData()));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?roster=montag", content: FOREVER_MAIN });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ roster: "montag", version: "tbc" })));
    });

    it("forgets a link to a roster of a hidden version", async () => {
        vi.mocked(api.getLootCouncil).mockImplementation(async (filter) => (filter && filter.roster ? droppedData() : councilData()));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?roster=montag", content: { ...FOREVER_MAIN, hideOtherVersions: true, versions: [FOREVER_MAIN.versions[0]] } });
        await waitFor(() => expect(api.getLootCouncilOverview).toHaveBeenCalledWith("forever"));
        expect(api.getLootCouncil).not.toHaveBeenCalledWith(expect.objectContaining({ version: "tbc" }));
    });
});

const FOREVER_MAIN = twoVersions({ mainVersion: "forever", versions: [{ id: "forever", label: "WoW Forever", short: "Forever" }, { id: "tbc", label: "WoW TBC", short: "TBC" }] });
