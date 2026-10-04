// The tabs of Historie & Loot: ONE tab row (Vergaben | Items | Raids |
// Charaktere) instead of an area switch over a second row. What used to be a
// tab of its own is a switch inside the tab it belongs to; the old ?tab= links
// from Discord still land in the right place; only the tabs the visitor's
// permissions cover show; the import/inbox links keep working.
//
// The views themselves have their own tests; here the heavy ones are
// stand-ins that name themselves.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { HistoryData } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import HistoryPage from "./HistoryPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getHistoryData: vi.fn(),
    getLootStats: vi.fn(),
    getLootInbox: vi.fn(),
    getSession: vi.fn(),
}));

vi.mock("./LatestLootTab", () => ({ LatestLootTab: () => <div>Ansicht Vergaben</div> }));
vi.mock("./LootItemsTab", () => ({ LootItemsTab: ({ lead }: { lead?: React.ReactNode }) => <div>Ansicht Items{lead}</div> }));
vi.mock("./LootReasonsTab", () => ({ LootReasonsTab: ({ lead }: { lead?: React.ReactNode }) => <div>Ansicht Gründe{lead}</div> }));
vi.mock("./LootEventsTab", () => ({ LootEventsTab: ({ lead }: { lead?: React.ReactNode }) => <div>Ansicht Nach Raid{lead}</div> }));
vi.mock("./LogsTab", () => ({ LogsTab: ({ lead }: { lead?: React.ReactNode }) => <div>Ansicht Logs{lead}</div> }));
vi.mock("./CharactersTab", () => ({ CharactersTab: () => <div>Ansicht Charaktere</div> }));
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

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getHistoryData).mockReset().mockResolvedValue(history());
    vi.mocked(api.getLootStats).mockReset().mockResolvedValue({ characters: [], reasons: [], items: [], contents: [], tiers: [], unknownContentCount: 0 } as unknown as Awaited<ReturnType<typeof api.getLootStats>>);
    vi.mocked(api.getLootInbox).mockReset().mockResolvedValue({ sessions: [{ id: "s1" }, { id: "s2" }] } as unknown as Awaited<ReturnType<typeof api.getLootInbox>>);
    vi.mocked(api.getSession).mockReset().mockResolvedValue({ user: null, csrfToken: null, areas: [], guilds: [{ id: "g1", name: "Pulse" }], activeGuildId: "g1" });
});

describe("the one tab row", () => {
    it("offers Vergaben, Items, Raids and Charaktere — and no area switch", async () => {
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });

        await screen.findByText("Ansicht Items");
        expect(tabNames()).toEqual(["Vergaben", "Items", "Raids", "Charaktere"]);
        expect(screen.queryByRole("radiogroup", { name: "Bereich" })).not.toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: /Import|Inbox|Gründe|Nach Raid/ })).not.toBeInTheDocument();
    });

    it("puts the import first and the inbox as a second button with its count", async () => {
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });

        expect(await screen.findByRole("button", { name: /Addon-Inbox · 2 offen/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Loot importieren/ })).toBeInTheDocument();
    });

    it("switches between the four tabs", async () => {
        const user = userEvent.setup();
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });
        await screen.findByText("Ansicht Items");

        await user.click(screen.getByRole("tab", { name: "Vergaben" }));
        expect(await screen.findByText("Ansicht Vergaben")).toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: "Charaktere" }));
        expect(await screen.findByText("Ansicht Charaktere")).toBeInTheDocument();
    });

    it("keeps Gründe inside Items as a switch by player", async () => {
        const user = userEvent.setup();
        renderPage(<HistoryPage />, { route: "/history", path: "/history" });
        await screen.findByText("Ansicht Items");

        await user.click(screen.getByRole("radio", { name: "Nach Spieler" }));
        expect(await screen.findByText("Ansicht Gründe")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: "Nach Item" }));
        expect(await screen.findByText("Ansicht Items")).toBeInTheDocument();
    });

    it("keeps the raid lists, the loot per raid and the logs inside Raids", async () => {
        const user = userEvent.setup();
        renderPage(<HistoryPage />, { route: "/history?tab=raids", path: "/history" });

        expect(await screen.findByText("Raid-Tabelle")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Loot nach Raid/ }));
        expect(await screen.findByText("Ansicht Nach Raid")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Logs/ }));
        expect(await screen.findByText("Ansicht Logs")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Kommende/ }));
        expect(await screen.findByText("Raid-Tabelle")).toBeInTheDocument();
    });
});

describe("old ?tab= links", () => {
    it("maps the former tab ids to their new place", async () => {
        const cases: [string, string, string][] = [
            ["awards", "Vergaben", "Ansicht Vergaben"],
            ["items", "Items", "Ansicht Items"],
            ["reasons", "Items", "Ansicht Gründe"],
            ["loot", "Raids", "Ansicht Nach Raid"],
            ["logs", "Raids", "Ansicht Logs"],
            ["raids", "Raids", "Raid-Tabelle"],
            ["chars", "Charaktere", "Ansicht Charaktere"],
        ];
        for (const [id, tab, view] of cases) {
            localStorage.clear();
            const { unmount } = renderPage(<HistoryPage />, { route: `/history?tab=${id}`, path: "/history" });
            expect(await screen.findByText(view)).toBeInTheDocument();
            expect({ id, tab: selectedTab() }).toEqual({ id, tab });
            unmount();
        }
    });
});

describe("what a visitor may see", () => {
    it("opens only the loot tabs for the narrower loot permission", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=chars", path: "/history", user: lootOnly });

        expect(await screen.findByText("Ansicht Items")).toBeInTheDocument();
        expect(selectedTab()).toBe("Items");
        expect(tabNames()).toEqual(["Vergaben", "Items", "Raids"]);
        expect(screen.queryByRole("button", { name: /Addon-Inbox/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Loot importieren/ })).not.toBeInTheDocument();
        expect(api.getLootInbox).not.toHaveBeenCalled();
    });

    it("shows a loot-only visitor just the loot per raid under Raids, without the raid and log lists", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=raids", path: "/history", user: lootOnly });

        expect(await screen.findByText("Ansicht Nach Raid")).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: "Zeitraum" })).not.toBeInTheDocument();
        expect(screen.queryByText("Raid-Tabelle")).not.toBeInTheDocument();
    });

    it("sends a loot-only ?tab=logs to the loot per raid instead of the logs", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=logs", path: "/history", user: lootOnly });
        expect(await screen.findByText("Ansicht Nach Raid")).toBeInTheDocument();
        expect(screen.queryByText("Ansicht Logs")).not.toBeInTheDocument();
    });
});

describe("old import and inbox links", () => {
    it("opens the import dialog for ?tab=import when the visitor may import", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=import", path: "/history" });
        expect(await screen.findByText("Import-Dialog offen")).toBeInTheDocument();
        expect(selectedTab()).toBe("Items");
    });

    it("opens no import dialog without write access", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=import", path: "/history", user: historyReader });
        await screen.findByText("Ansicht Items");
        expect(screen.queryByText("Import-Dialog offen")).not.toBeInTheDocument();
    });

    it("sends ?tab=inbox on to the inbox page", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=inbox", path: "/history" });
        // /history/inbox is a different route: the page leaves.
        await waitFor(() => expect(screen.queryByRole("heading", { name: "Historie & Loot" })).not.toBeInTheDocument());
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
    });

    it("keeps a loot-only visitor on the page for ?tab=inbox", async () => {
        renderPage(<HistoryPage />, { route: "/history?tab=inbox", path: "/history", user: lootOnly });
        expect(await screen.findByRole("heading", { name: "Historie & Loot" })).toBeInTheDocument();
        expect(await screen.findByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("names the tabs, the switches and the head buttons in English", async () => {
        await switchLang("en");
        renderPage(<HistoryPage />, { route: "/history?tab=raids", path: "/history" });

        await screen.findByText("Raid-Tabelle");
        expect(tabNames()).toEqual(["Awards", "Items", "Raids", "Characters"]);
        expect(screen.getByRole("heading", { name: "History & loot" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Import loot/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Addon inbox · 2 open/ })).toBeInTheDocument();
        const switchRadios = within(screen.getByRole("radiogroup", { name: "Period" })).getAllByRole("radio").map((r) => r.textContent);
        expect(switchRadios).toEqual(["Past (0)", "Upcoming (0)", "Loot by raid (0)", "Logs (0)"]);
    });
});
