// A picked roster (or a raid category without roster) brings its Loot-Council
// profile's filters from the server (#676) — the in-game addon gets its council
// with exactly these — and a change to them is saved into that profile for the
// whole orga. Without a pick the browser keeps its own. The head names roster,
// profile and Kader, and ?roster=<id> preselects a roster.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { bisListsData, councilData, councilHeadData } from "../../test/councilFixtures";
import { adminUser, renderPage, twoVersions } from "../../test/render";
import { switchLang } from "../../test/i18n";
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
const MAIN_VIEW = { role: "healer", tiers: ["t6"], contents: [], bisTier: "t6", version: "tbc" };

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const data = councilData();
    data.options.categories = [{ id: "c1", name: "Montagsraid" }, { id: "c2", name: "Softres-Raid" }] as typeof data.options.categories;
    vi.mocked(api.getLootCouncil).mockImplementation(async (filter) => (filter?.roster === "r1" ? {
        ...data,
        council: councilHeadData({
            target: "roster",
            roster: { id: "r1", name: "Mittwoch-Roster", categoryId: "c1", categoryName: "Montagsraid", versionId: "tbc", lootSystem: "lootcouncil", kaderId: "k1", kaderName: "Forever-Kader" },
            profile: { id: "p-main", name: "Main T6", isDefault: false, source: "roster" },
        }),
    } : data));
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
    vi.mocked(api.getCouncilViews).mockResolvedValue({
        views: { "p-main": MAIN_VIEW, standard: DEFAULTS },
        targets: { "roster:r1": "p-main", "category:c1": "p-main", "category:c2": "standard" },
        defaultId: "standard",
        defaults: DEFAULTS,
        councilCategories: ["c1"],
        councilRosters: ["r1"],
    });
    vi.mocked(api.saveCouncilView).mockImplementation(async (profileId, view) => ({ profileId, view }));
});

/** Start the page on a pick, as a stored browser view would. */
function startOn(pick: { roster?: string; category?: string }) {
    localStorage.setItem("eh-lootcouncil.view", JSON.stringify({ category: "", ...pick }));
}

describe("council filters per Loot-Council profile", () => {
    it("loads a picked roster with its profile's filters and says they reach the game", async () => {
        startOn({ roster: "r1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Gilt auch fürs Spiel")).toBeInTheDocument();
        expect(api.getLootCouncil).toHaveBeenCalledTimes(1);
        expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ roster: "r1", role: "healer", tiers: ["t6"], bisTier: "t6" }));
        // Nothing changed, so nothing is saved.
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });

    it("saves a changed filter into the profile on the server, not in the browser", async () => {
        const user = userEvent.setup();
        startOn({ roster: "r1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Gilt auch fürs Spiel");
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Caster/ }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ roster: "r1", role: "caster", tiers: ["t6"] })));
        await waitFor(() => expect(api.saveCouncilView).toHaveBeenCalledWith("p-main", { role: "caster", tiers: ["t6"], contents: [], bisTier: "t6", version: "tbc" }), { timeout: 2000 });
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}").role).toBeUndefined();
    });

    it("stores the menu's game version with the view", async () => {
        startOn({ roster: "r1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil", content: twoVersions({ mainVersion: "forever" }) });
        await screen.findByText("Gilt auch fürs Spiel");
        await waitFor(() => expect(api.saveCouncilView).toHaveBeenCalledWith("p-main", expect.objectContaining({ role: "healer", version: "forever" })), { timeout: 2000 });
    });

    it("starts a category without roster on its profile (here the default) and keeps the hint off for a non-council one", async () => {
        startOn({ category: "c2" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c2", role: "caster", tiers: [] })));
        await screen.findByText("Anna");
        expect(screen.queryByText("Gilt auch fürs Spiel")).not.toBeInTheDocument();
    });

    it("saves nothing for a reader without write access", async () => {
        const user = userEvent.setup();
        startOn({ roster: "r1" });
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

    it("keeps the browser's own filters without a pick", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Anna");
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Heiler/ }));
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "", roster: "", role: "healer" })));
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}").role).toBe("healer");
        await new Promise((r) => setTimeout(r, 800));
        expect(api.saveCouncilView).not.toHaveBeenCalled();
    });

    it("falls back to the browser's filters when the stored views cannot be read", async () => {
        vi.mocked(api.getCouncilViews).mockRejectedValue(new Error("down"));
        startOn({ category: "c1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ category: "c1", role: "caster" })));
        expect(screen.queryByText("Gilt auch fürs Spiel")).not.toBeInTheDocument();
    });
});

describe("council head: roster first, profile and Kader (#676)", () => {
    it("picks by roster first, categories without roster as the fallback group", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const picker = await screen.findByLabelText("Council für");
        const groups = within(picker).getAllByRole("group");
        expect(groups.map((g) => g.getAttribute("label"))).toEqual(["Roster mit Loot-Council", "Kategorien ohne Roster"]);
        expect(within(groups[0]).getByRole("option", { name: "Mittwoch-Roster · Montagsraid" })).toBeInTheDocument();
        expect(within(groups[1]).getByRole("option", { name: "Softres-Raid" })).toBeInTheDocument();
        await user.selectOptions(picker, "roster:r1");
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ roster: "r1", role: "healer" })));
        expect(await screen.findByText("Main T6")).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Council für"), "category:c2");
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ roster: "", category: "c2" })));
    });

    it("names roster, profile and linked Kader with links to roster and Kader", async () => {
        startOn({ roster: "r1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const head = await screen.findByRole("region", { name: "Für wen der Council rechnet" });
        expect(within(head).getByText("Mittwoch-Roster")).toBeInTheDocument();
        expect(within(head).getByText("Main T6")).toBeInTheDocument();
        expect(within(head).getByText("Forever-Kader")).toBeInTheDocument();
        expect(within(head).getByRole("link", { name: "Zum Roster" })).toHaveAttribute("href", "/roster/r/r1");
        expect(within(head).getByRole("link", { name: "Zum Kader" })).toHaveAttribute("href", "/kader/k1/roster");
    });

    it("hides the links the caller may not follow", async () => {
        vi.mocked(api.getLootCouncil).mockResolvedValue(councilData({
            council: councilHeadData({
                target: "roster",
                roster: { id: "r1", name: "Mittwoch-Roster", categoryId: "c1", categoryName: "Montagsraid", versionId: "tbc", lootSystem: "lootcouncil", kaderId: "k1", kaderName: "" },
                canOpenRoster: false,
                canOpenKader: false,
            }),
        }));
        startOn({ roster: "r1" });
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const head = await screen.findByRole("region", { name: "Für wen der Council rechnet" });
        expect(within(head).queryByRole("link")).not.toBeInTheDocument();
        expect(within(head).queryByText("Kader")).not.toBeInTheDocument();
    });

    it("takes ?roster=<id> from a link (the Kaderplaner's \"Zum Loot-Council\")", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil?roster=r1" });
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenCalledWith(expect.objectContaining({ roster: "r1", role: "healer" })));
        expect(JSON.parse(localStorage.getItem("eh-lootcouncil.view") || "{}").roster).toBe("r1");
    });

    it("speaks English too", async () => {
        await switchLang("en");
        try {
            startOn({ roster: "r1" });
            renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
            const head = await screen.findByRole("region", { name: "Who the council works for" });
            expect(within(head).getByRole("link", { name: "To the roster" })).toBeInTheDocument();
            expect(within(head).getByRole("link", { name: "To the squad" })).toBeInTheDocument();
            expect(screen.getByLabelText("Council for")).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});
