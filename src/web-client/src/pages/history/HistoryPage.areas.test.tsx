// The areas of Historie & Loot (design issue #225): three areas instead of nine
// tabs, every view in exactly one of them, the open area following from the
// open view, only the areas the visitor's permissions cover, and the old
// ?tab=import / ?tab=inbox links from Discord still working.
//
// The views themselves have their own tests; here the heavy ones are
// stand-ins that name themselves.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { HistoryData } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import HistoryPage from "./HistoryPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getHistoryData: vi.fn(),
    getLootStats: vi.fn(),
    getLootInbox: vi.fn(),
    getSession: vi.fn(),
}));

vi.mock("./LatestLootTab", () => ({ LatestLootTab: () => <div>Ansicht Vergaben</div> }));
vi.mock("./LootItemsTab", () => ({ LootItemsTab: () => <div>Ansicht Items</div> }));
vi.mock("./LootReasonsTab", () => ({ LootReasonsTab: () => <div>Ansicht Gründe</div> }));
vi.mock("./RaidTable", () => ({ default: () => <div>Raid-Tabelle</div> }));
vi.mock("./ImportLootDialog", () => ({
    ImportLootDialog: ({ open }: { open: boolean }) => (open ? <div>Import-Dialog offen</div> : null),
}));

function history(): HistoryData {
    return {
        events: [], upcomingRaids: { events: [], error: null }, pastRaids: { events: [], error: null },
        lootEvents: [], logs: [], categories: [], categoryLootTool: {}, chars: [], activeGuildId: "g1",
    };
}

const lootOnly = adminUser({ isAdmin: false, access: { loot: { read: true, write: false } } });
const historyReader = adminUser({ isAdmin: false, access: { history: { read: true, write: false } } });

/** Where the view with this label sits: its area and its tab. */
const AREA_OF: Record<string, { area: string; tab: string }> = {
    awards: { area: "Loot", tab: "Vergaben" },
    items: { area: "Loot", tab: "Items" },
    reasons: { area: "Loot", tab: "Gründe" },
    loot: { area: "Loot", tab: "Nach Raid" },
    raids: { area: "Raids & Logs", tab: "Raids" },
    logs: { area: "Raids & Logs", tab: "Warcraft Logs" },
    chars: { area: "Charaktere", tab: "" },
};

const areaSwitch = () => screen.getByRole("radiogroup", { name: "Bereich" });

beforeEach(() => {
    vi.mocked(api.getHistoryData).mockReset().mockResolvedValue(history());
    vi.mocked(api.getLootStats).mockReset().mockResolvedValue({ characters: [], reasons: [], items: [], contents: [], tiers: [], unknownContentCount: 0 } as unknown as Awaited<ReturnType<typeof api.getLootStats>>);
    vi.mocked(api.getLootInbox).mockReset().mockResolvedValue({ sessions: [] });
    vi.mocked(api.getSession).mockReset().mockResolvedValue({ user: null, csrfToken: null, areas: [], guilds: [{ id: "g1", name: "Pulse" }], activeGuildId: "g1" });
});

describe("the areas", () => {
    it("offers three areas, the import and the inbox not among the views", async () => {
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });

        const areas = within(await screen.findByRole("radiogroup", { name: "Bereich" })).getAllByRole("radio");
        expect(areas.map((a) => a.textContent)).toEqual(["Loot", "Raids & Logs", "Charaktere"]);
        expect(screen.queryByRole("tab", { name: /Import|Inbox/ })).not.toBeInTheDocument();
        // The import is a dialog from the page head, the inbox a page of its own.
        expect(screen.getByRole("button", { name: /Loot importieren/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Addon-Inbox/ })).toBeInTheDocument();
    });

    it("puts every view in exactly one area", async () => {
        const user = userEvent.setup();
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });
        await screen.findByRole("radiogroup", { name: "Bereich" });

        const seen: string[] = [];
        for (const area of within(areaSwitch()).getAllByRole("radio")) {
            await user.click(area);
            const tabs = screen.queryAllByRole("tab").map((t) => t.textContent || "");
            // An area with a single view goes straight to it, without a subnav.
            seen.push(...(tabs.length ? tabs : [area.textContent || ""]));
        }
        expect(seen).toEqual([...new Set(seen)]);
        expect(seen).toHaveLength(Object.keys(AREA_OF).length);
    });

    it("derives the open area from the open view", async () => {
        for (const [id, where] of Object.entries(AREA_OF)) {
            const { unmount } = renderPage(<HistoryPage />, { route: `/history?tab=${id}`, path: "/history" });
            const area = within(await screen.findByRole("radiogroup", { name: "Bereich" })).getByRole("radio", { name: where.area });
            expect({ id, area: area.getAttribute("aria-checked") }).toEqual({ id, area: "true" });
            if (where.tab) expect({ id, tab: screen.getByRole("tab", { name: where.tab }).getAttribute("aria-selected") }).toEqual({ id, tab: "true" });
            unmount();
        }
    });

    it("opens an area on its first view", async () => {
        const user = userEvent.setup();
        renderPage(<HistoryPage />, { route: "/history?tab=logs", path: "/history" });

        await user.click(within(await screen.findByRole("radiogroup", { name: "Bereich" })).getByRole("radio", { name: "Loot" }));
        expect(screen.getByRole("tab", { name: "Vergaben" })).toHaveAttribute("aria-selected", "true");
        expect(await screen.findByText("Ansicht Vergaben")).toBeInTheDocument();
    });
});

describe("what a visitor may see", () => {
    it("opens only the loot area for the narrower loot permission, without an area switch", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=raids", path: "/history", user: lootOnly });

        expect(await screen.findByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("radiogroup", { name: "Bereich" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Vergaben", "Items", "Gründe", "Nach Raid"]);
        expect(screen.queryByRole("button", { name: /Addon-Inbox/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Loot importieren/ })).not.toBeInTheDocument();
        expect(api.getLootInbox).not.toHaveBeenCalled();
    });
});

describe("old links", () => {
    it("opens the import dialog for ?tab=import when the visitor may import", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=import", path: "/history" });
        expect(await screen.findByText("Import-Dialog offen")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
    });

    it("opens no import dialog without write access", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=import", path: "/history", user: historyReader });
        await screen.findByRole("radiogroup", { name: "Bereich" });
        expect(screen.queryByText("Import-Dialog offen")).not.toBeInTheDocument();
    });

    it("sends ?tab=inbox on to the inbox page", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=inbox", path: "/history" });
        // /history/inbox is a different route: the page leaves.
        await waitFor(() => expect(screen.queryByRole("heading", { name: "Historie & Loot" })).not.toBeInTheDocument());
        expect(screen.queryByRole("radiogroup", { name: "Bereich" })).not.toBeInTheDocument();
    });

    it("keeps a loot-only visitor on the page for ?tab=inbox", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=inbox", path: "/history", user: lootOnly });
        expect(await screen.findByRole("heading", { name: "Historie & Loot" })).toBeInTheDocument();
        expect(await screen.findByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
    });
});
