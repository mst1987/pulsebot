// The guild bank's "Warteliste" tab (#775) against a mocked API: the tab
// with its count next to "Ausgebbar", the queues per item with place, name
// and amount, forward / back / remove, the filter line, adding one entry
// with − / + and the pasted import with its preview (each in a dialog from
// the tab), the badges on the page, and a reader who only looks.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { adminUser, renderPage } from "../../test/render";
import GuildBankPage from "./GuildBankPage";
import { bankData, bankItem } from "./guildBank.fixture";
import type { GuildBankImportRow, GuildBankWaitingEntry } from "../../api";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    getGuildBankWaitlist: vi.fn(),
    addGuildBankWaiting: vi.fn(),
    moveGuildBankWaiting: vi.fn(),
    removeGuildBankWaiting: vi.fn(),
    previewGuildBankWaitlist: vi.fn(),
    importGuildBankWaitlist: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";

function entry(over: Partial<GuildBankWaitingEntry> = {}): GuildBankWaitingEntry {
    return {
        id: "w1", itemId: 1, item: "Bold Living Ruby", iconUrl: "", amount: 2, userId: "u1", userName: "Anna", characterName: "Zibbo",
        realm: "Spineshatter", purpose: "", createdAt: Date.UTC(2026, 9, 6, 18), position: 1, addedByName: "", ...over,
    };
}

const ENTRIES = [
    entry(),
    entry({ id: "w2", userId: "", userName: "Whapap", characterName: "Whapap", amount: 1, position: 2, addedByName: "Arthas" }),
    entry({ id: "w3", itemId: 3, item: "Flask of Relentless Assault", amount: 3, userName: "Bo", position: 1 }),
];

function row(over: Partial<GuildBankImportRow>): GuildBankImportRow {
    return { line: 1, name: "Whapap", itemText: "Bold Living Ruby", amount: 1, error: "", item: { itemId: 1, name: "Bold Living Ruby", iconUrl: "" }, itemError: "", match: null, ambiguous: false, ok: true, ...over };
}

async function openTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: /^Warteliste/ }));
    return screen.findByRole("region", { name: "Bold Living Ruby" });
}

/** The dialog behind one of the tab's buttons ("Eintrag anlegen", "Import"). */
async function openDialog(user: ReturnType<typeof userEvent.setup>, button: string) {
    await openTab(user);
    await user.click(screen.getByRole("button", { name: button }));
    return screen.findByRole("dialog");
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData({
        items: [
            bankItem({ itemId: 1, available: 0, free: 0, waiting: 2, waitingAmount: 3 }),
            bankItem({ itemId: 2, name: "Smooth Dawnstone" }),
            bankItem({ itemId: 3, name: "Flask of Relentless Assault", group: "Fläschchen", waiting: 1, waitingAmount: 3, free: 0, available: 0 }),
            bankItem({ itemId: 4, name: "Primal Might", status: "show" }),
        ],
    }));
    vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: ENTRIES });
});

describe("guild bank waiting list", () => {
    it("counts who waits in the head and per item", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByText("3 warten")).toBeInTheDocument();
        const table = screen.getByRole("table", { name: "Gegenstände der Gildenbank" });
        expect(within(table).getByText("2 warten")).toBeInTheDocument();
        expect(within(table).getByText("1 wartet")).toBeInTheDocument();
    });

    it("has a tab next to \"Ausgebbar\" that counts who waits, and no head button any more", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const tabs = await screen.findAllByRole("tab");
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Ausgebbar 3", "Warteliste 3", "Nur Bestand 1", "Ausgeblendet 0", "Neu 0"]);
        expect(screen.queryByRole("button", { name: "Warteliste" })).toBeNull();
    });

    it("jumps to the tab from the head's badge and remembers it", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "3 warten" }));
        expect(await screen.findByRole("region", { name: "Bold Living Ruby" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /^Warteliste/ })).toHaveAttribute("aria-selected", "true");
        expect(localStorage.getItem("eh-guildbank-tab")).toContain("wait");
    });

    it("filters the queues by player or item", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.type(screen.getByRole("searchbox"), "relentless");
        expect(screen.queryByRole("region", { name: "Bold Living Ruby" })).toBeNull();
        expect(screen.getByRole("region", { name: "Flask of Relentless Assault" })).toBeInTheDocument();
        await user.clear(screen.getByRole("searchbox"));
        await user.type(screen.getByRole("searchbox"), "whapap");
        expect(screen.getByRole("region", { name: "Bold Living Ruby" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Flask of Relentless Assault" })).toBeNull();
    });

    it("lists each item's queue with place, name, amount and the entries without Discord", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        const dialog = document.body;
        const ruby = await within(dialog).findByRole("region", { name: "Bold Living Ruby" });
        const rows = within(ruby).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("Anna")).toBeInTheDocument();
        expect(within(rows[0]).getByText("2×")).toBeInTheDocument();
        expect(within(rows[0]).getByText(/^an Zibbo · seit /)).toBeInTheDocument();
        expect(within(rows[1]).getByText("Whapap")).toBeInTheDocument();
        expect(within(rows[1]).getByText("ohne Discord")).toBeInTheDocument();
        expect(within(rows[1]).getByText(/eingetragen von Arthas/)).toBeInTheDocument();
        expect(within(ruby).getByText("2 Einträge")).toBeInTheDocument();
        expect(within(ruby).getByText("Verfügbar 0")).toBeInTheDocument();
        expect(within(dialog).getByRole("region", { name: "Flask of Relentless Assault" })).toBeInTheDocument();
        // the first cannot move forward, the last not back
        expect(within(rows[0]).getByRole("button", { name: "Nach vorne: Anna" })).toBeDisabled();
        expect(within(rows[1]).getByRole("button", { name: "Nach hinten: Whapap" })).toBeDisabled();
        expect(api.getGuildBankWaitlist).toHaveBeenCalledWith(KEY);
    });

    it("moves and removes entries (asking first) and reads the bank again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.moveGuildBankWaiting).mockResolvedValue({ entries: [ENTRIES[1], ENTRIES[0], ENTRIES[2]].map((e, i) => ({ ...e, position: e.itemId === 1 ? i + 1 : 1 })) });
        vi.mocked(api.removeGuildBankWaiting).mockResolvedValue({ entries: [ENTRIES[2]] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        const dialog = document.body;
        await user.click(await within(dialog).findByRole("button", { name: "Nach vorne: Whapap" }));
        expect(api.moveGuildBankWaiting).toHaveBeenCalledWith(KEY, "w2", "up");
        await waitFor(() => expect(within(within(dialog).getByRole("region", { name: "Bold Living Ruby" })).getAllByRole("listitem")[0]).toHaveTextContent("Whapap"));
        await user.click(within(dialog).getByRole("button", { name: "Entfernen: Anna" }));
        expect(await screen.findByText("2× Bold Living Ruby für Anna kommt von der Warteliste.")).toBeInTheDocument();
        const confirmButtons = screen.getAllByRole("button", { name: "Entfernen" });
        await user.click(confirmButtons[confirmButtons.length - 1]);
        await waitFor(() => expect(api.removeGuildBankWaiting).toHaveBeenCalledWith(KEY, "w1"));
        await waitFor(() => expect(within(dialog).queryByRole("region", { name: "Bold Living Ruby" })).toBeNull());
        await waitFor(() => expect(api.getGuildBank).toHaveBeenCalledTimes(3));
    });

    it("adds an entry: a name, an offered item and the amount with − / +", async () => {
        const user = userEvent.setup();
        const grown = [...ENTRIES, entry({ id: "w4", itemId: 2, item: "Smooth Dawnstone", userId: "", userName: "Gentle", amount: 3 })];
        vi.mocked(api.addGuildBankWaiting).mockImplementation(async () => { vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: grown }); return { added: 1, entries: grown }; });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user, "Eintrag anlegen");
        const add = within(dialog).getByRole("button", { name: "Hinten anstellen" });
        expect(add).toBeDisabled();
        await user.type(within(dialog).getByRole("textbox", { name: "Raider oder Charakter" }), "Gentle");
        const select = within(dialog).getByRole("combobox", { name: "Gegenstand" });
        // only offered items: Primal Might is "Nur Bestand"
        expect(within(select).queryByRole("option", { name: "Primal Might" })).toBeNull();
        await user.selectOptions(select, "2");
        const amount = within(dialog).getByRole("group", { name: "Menge" });
        expect(within(amount).getByRole("button", { name: "Weniger" })).toBeDisabled();
        await user.click(within(amount).getByRole("button", { name: "Mehr" }));
        await user.click(within(amount).getByRole("button", { name: "Mehr" }));
        await user.click(add);
        expect(api.addGuildBankWaiting).toHaveBeenCalledWith(KEY, { name: "Gentle", itemId: 2, amount: 3 });
        expect(await screen.findByRole("region", { name: "Smooth Dawnstone" })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("previews pasted lines — raider found, character only, unknown item in red — then imports the readable ones", async () => {
        const user = userEvent.setup();
        vi.mocked(api.previewGuildBankWaitlist).mockResolvedValue({
            rows: [
                row({ line: 1, name: "Alîna", match: { userId: "u-a", userName: "Ali", characterName: "Alina", realm: "" } }),
                row({ line: 2, name: "Whapap", itemText: "Bold Living Rubi", fuzzy: true }),
                row({ line: 3, name: "Josh", ambiguous: true }),
                row({ line: 4, name: "X", itemText: "Dragon Egg", item: null, itemError: "Unbekannter Gegenstand.", ok: false }),
            ],
        });
        vi.mocked(api.importGuildBankWaitlist).mockResolvedValue({ added: 3, skipped: 1, entries: ENTRIES });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user, "Import");
        const text = "Alîna\tBold Living Ruby\t1\nWhapap\tBold Living Ruby\t1\nJosh\tBold Living Ruby\t1\nX\tDragon Egg\t1";
        const area = within(dialog).getByRole("textbox", { name: "Zeilen einfügen" });
        await user.click(area);
        await user.paste(text);
        await user.click(within(dialog).getByRole("button", { name: "Vorschau" }));
        expect(api.previewGuildBankWaitlist).toHaveBeenCalledWith(KEY, text);
        expect(await within(dialog).findByText("Raider: Ali")).toBeInTheDocument();
        expect(within(dialog).getAllByText("nur Charakter")).toHaveLength(2);
        expect(within(dialog).getByText("mehrdeutig – nur Charakter")).toBeInTheDocument();
        // a typo in the item name: the real item is named under the row
        expect(within(dialog).getByText("erkannt als Bold Living Ruby")).toBeInTheDocument();
        const bad = within(dialog).getByText("Unbekannter Gegenstand.").closest("li");
        expect(bad).toHaveClass("gb-wl-bad");
        await user.click(within(dialog).getByRole("button", { name: "3 Einträge importieren" }));
        expect(api.importGuildBankWaitlist).toHaveBeenCalledWith(KEY, text);
        expect(await screen.findByText("3 importiert, 1 übersprungen.")).toBeInTheDocument();
        expect(await screen.findByRole("region", { name: "Bold Living Ruby" })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("lets a reader look but not change", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank", user: adminUser({ isAdmin: false, access: { raids: { read: true, write: false } } }) });
        await openTab(user);
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Eintrag anlegen" })).toBeNull();
        expect(screen.queryByRole("button", { name: /Entfernen/ })).toBeNull();
    });

    it("says so when nobody waits", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("tab", { name: /^Warteliste/ }));
        expect(await screen.findByText(/^Niemand wartet gerade\./)).toBeInTheDocument();
        // the buttons stay: the first entry comes from here
        expect(screen.getByRole("button", { name: "Eintrag anlegen" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    });
});
