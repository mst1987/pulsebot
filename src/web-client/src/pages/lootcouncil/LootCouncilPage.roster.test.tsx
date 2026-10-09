// A category with a roster (#667): the roster is the candidate list. The page
// says which roster, offers "Ersatz zeigen", shows Probe/Ersatz as a badge,
// counts members without a council spec, and folds the stand-ins.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CouncilRosterSource, LootCouncilData } from "../../api";
import { bisListsData, councilData, councilRaider } from "../../test/councilFixtures";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import LootCouncilPage from "./LootCouncilPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLootCouncil: vi.fn(),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
    getCouncilViews: vi.fn(),
}));

const rosterSource = (over: Partial<CouncilRosterSource> = {}): CouncilRosterSource => ({
    id: "r1", name: "Montag", versionId: "tbc", counts: { core: 1, trial: 1, bench: 2, pause: 1 }, showBench: false,
    noSpec: [{ key: "krieger", character: "Krieger", className: "Warrior", status: "core" }],
    ...over,
});

function rosterData(over: Partial<LootCouncilData> = {}): LootCouncilData {
    const data = councilData({
        roster: [councilRaider({ status: "core" }), councilRaider({ key: "berta", character: "Berta", status: "trial" })],
        outsiders: [{ ...councilRaider({ key: "aushilfe", character: "Aushilfe", lootCount: 3, status: "" }) }],
        ...over,
    });
    data.options.categories = [{ id: "c1", name: "Montagsraid" }] as typeof data.options.categories;
    data.filter = { ...data.filter, categoryId: "c1", skipped: { category: 0, excluded: 0, bench: 2, paused: 1 }, roster: rosterSource() };
    return data;
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getLootCouncil).mockResolvedValue(rosterData());
    vi.mocked(api.getBisLists).mockResolvedValue(bisListsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
    vi.mocked(api.getCouncilViews).mockResolvedValue({ views: {}, defaults: { role: "caster", tiers: [], contents: [], bisTier: "", version: "" }, councilCategories: [] } as Awaited<ReturnType<typeof api.getCouncilViews>>);
});

describe("loot council with a roster (#667)", () => {
    it("names the roster and counts the members without a council spec", async () => {
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        expect(await screen.findByText("Roster Montag")).toBeInTheDocument();
        const noSpec = screen.getByText("1 ohne Council-Spec");
        expect(noSpec.closest("[data-tip-sub]")?.getAttribute("data-tip-sub")).toContain("Krieger");
        // the roster badge replaces the category's "hidden" note
        expect(screen.queryByText(/ausgeblendet$/)).not.toBeInTheDocument();
    });

    it("shows Probe as a badge in the list and in the raider's details, none for Stamm", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await screen.findByText("Berta");
        const rows = screen.getAllByRole("row");
        const berta = rows.find((r) => within(r).queryByText("Berta"))!;
        const anna = rows.find((r) => within(r).queryByText("Anna"))!;
        expect(within(berta).getByText("Probe")).toBeInTheDocument();
        expect(within(anna).queryByText("Probe")).not.toBeInTheDocument();
        expect(within(anna).queryByText("Stamm")).not.toBeInTheDocument();

        await user.click(within(berta).getByRole("button", { name: /Details/ }));
        const dialog = await screen.findByRole("dialog", { name: /Berta/ });
        expect(within(dialog).getByText("Probe")).toBeInTheDocument();
    });

    it("offers \"Ersatz zeigen\" only with a roster and asks the server for the bench when it is on", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await user.click(await screen.findByRole("button", { name: /^Filter/ }));
        const box = screen.getByRole("dialog", { name: "Filter" });
        await user.selectOptions(within(box).getByLabelText("Raid-Kategorie"), "c1");
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "c1", bench: false })));
        const toggle = within(screen.getByRole("dialog", { name: "Filter" })).getByRole("switch", { name: "Ersatz zeigen" });
        expect(toggle).not.toBeChecked();

        await user.click(toggle);
        await waitFor(() => expect(api.getLootCouncil).toHaveBeenLastCalledWith(expect.objectContaining({ category: "c1", bench: true })));
        expect(await screen.findByRole("button", { name: "Filter · 2 aktiv" })).toBeInTheDocument();
    });

    it("has no bench switch without a roster", async () => {
        const plain = councilData();
        plain.options.categories = [{ id: "c1", name: "Montagsraid" }] as typeof plain.options.categories;
        vi.mocked(api.getLootCouncil).mockResolvedValue(plain);
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        await user.click(await screen.findByRole("button", { name: /^Filter/ }));
        expect(within(screen.getByRole("dialog", { name: "Filter" })).queryByRole("switch", { name: "Ersatz zeigen" })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Roster /)).not.toBeInTheDocument();
    });

    it("folds the stand-ins under \"Nicht im Roster\", unranked", async () => {
        const user = userEvent.setup();
        renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
        const fold = (await screen.findByText("Nicht im Roster")).closest(".lc-fold") as HTMLElement;
        // folded: the name in the summary line, no row of its own in the ranked list
        expect(within(fold).getByText("Aushilfe")).toBeInTheDocument();
        expect(screen.getAllByRole("row").some((r) => within(r).queryByText("Aushilfe"))).toBe(false);
        expect(screen.queryByText(/zählen nicht für die Rangliste/)).not.toBeInTheDocument();
        await user.click(within(fold).getByRole("button", { expanded: false }));
        expect(await screen.findByText(/zählen nicht für die Rangliste/)).toBeInTheDocument();
        expect(within(fold).getByText(/nie$/)).toBeInTheDocument();
    });

    it("speaks English too", async () => {
        await switchLang("en");
        try {
            renderPage(<LootCouncilPage />, { route: "/lootcouncil" });
            expect(await screen.findByText("Roster Montag")).toBeInTheDocument();
            expect(screen.getByText("1 without council spec")).toBeInTheDocument();
            expect(screen.getByText("Not in the roster")).toBeInTheDocument();
            expect(screen.getByText("Trial")).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});
