// The council's entry (Oct 2026): plain /lootcouncil is the tiles of every roster and
// category that runs as Loot-Council; a tile, a link with a pick or a raider's link
// opens the council, whose "Zur Übersicht" leads back.
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { CouncilOverviewTile } from "../../../api";
import { bisListsData, councilData } from "../../../test/councilFixtures";
import { renderPage, twoVersions } from "../../../test/render";
import LootCouncilPage from "../LootCouncilPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
    getCouncilViews: vi.fn(),
    getLootCouncilOverview: vi.fn(),
}));

const MONTAG: CouncilOverviewTile = {
    kind: "roster", id: "r1", name: "Montagsraid", categoryId: "c1", categoryName: "TBC Montag", versionId: "tbc", versionLabel: "WoW TBC",
    profileName: "TBC Montag", members: { roster: 18, bench: 3, pause: 1 }, nextRaid: { id: "eh-1", title: "Gruul & Mag", startTime: 1792490400 },
};
const PUG: CouncilOverviewTile = {
    kind: "category", id: "c9", name: "PUG Raids", categoryId: "c9", categoryName: "PUG Raids", versionId: "tbc", versionLabel: "WoW TBC",
    profileName: "Standard", members: null, nextRaid: null,
};

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getLootCouncilOverview).mockResolvedValue({ versionId: "tbc", tiles: [MONTAG, PUG] });
    vi.mocked(api.getLootCouncil).mockResolvedValue(councilData());
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
    vi.mocked(api.getCouncilViews).mockResolvedValue({ views: {}, targets: {}, defaults: { role: "caster", tiers: [], contents: [], bisTier: "", version: "" }, councilCategories: [], councilRosters: [] } as unknown as Awaited<ReturnType<typeof api.getCouncilViews>>);
});

const tiles = () => within(screen.getByRole("list", { name: "Raids mit Loot-Council" }));

describe("the council's entry: tiles of the raids with Loot-Council", () => {
    it("opens on the tiles, not on a council - without building one", async () => {
        localStorage.setItem("eh-lootcouncil.view", JSON.stringify({ roster: "r1", category: "" }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Montagsraid")).toBeInTheDocument();
        expect(screen.getByText("2 Raids mit Loot-Council")).toBeInTheDocument();
        expect(api.getLootCouncil).not.toHaveBeenCalled();
    });

    it("shows per tile the roster, the next raid and the profile, and links into its council", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Montagsraid");
        const montag = tiles().getByRole("link", { name: /Montagsraid/ });
        expect(montag).toHaveAttribute("href", "/lootcouncil?roster=r1");
        expect(within(montag).getByText("18")).toBeInTheDocument();
        expect(within(montag).getByText("dazu 3 auf der Bank")).toBeInTheDocument();
        expect(within(montag).getByText("Gruul & Mag")).toBeInTheDocument();
        expect(within(montag).getByText("TBC Montag", { selector: ".lc-ov-profile" })).toBeInTheDocument();
        const pug = tiles().getByRole("link", { name: /PUG Raids/ });
        expect(pug).toHaveAttribute("href", "/lootcouncil?category=c9");
        expect(within(pug).getByText("Kein Roster – alle Anmeldungen zählen")).toBeInTheDocument();
        expect(within(pug).getByText("Kein Raid geplant")).toBeInTheDocument();
    });

    it("asks for the tiles of the menu's version", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil", content: twoVersions({ mainVersion: "forever" }) });
        await waitFor(() => expect(api.getLootCouncilOverview).toHaveBeenCalledWith("forever"));
    });

    it("says how to get a raid onto Loot-Council when none uses it", async () => {
        vi.mocked(api.getLootCouncilOverview).mockResolvedValue({ versionId: "tbc", tiles: [] });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Noch kein Raid nutzt Loot-Council.")).toBeInTheDocument();
        expect(screen.getByText(/Raids mit Softres oder GDKP erscheinen hier nicht/)).toBeInTheDocument();
    });

    it("opens the council of a pick in the url, with a way back to the tiles", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?roster=r1" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ roster: "r1" })));
        expect(await screen.findByRole("link", { name: "Zur Übersicht" })).toHaveAttribute("href", "/lootcouncil");
        expect(api.getLootCouncilOverview).not.toHaveBeenCalled();
        // the pick is remembered for a raider's link and the drop check
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}")).toMatchObject({ roster: "r1", category: "" });
    });

    it("keeps a raider's link in the council it came from", async () => {
        localStorage.setItem("eh-lootcouncil.view", JSON.stringify({ roster: "r1", category: "" }));
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?raider=Anna" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ roster: "r1" })));
        expect(api.getLootCouncilOverview).not.toHaveBeenCalled();
    });
});
