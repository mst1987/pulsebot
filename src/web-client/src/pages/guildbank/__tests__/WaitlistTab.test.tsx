// The guild bank's "Warteliste" tab (#775) against a mocked API: the tab
// with its count next to "Ausgebbar", the queues per item with place, name
// and amount, forward / back / remove, the filter line, adding one entry
// with − / + and the pasted import with its preview (each in a dialog from
// the tab), the badges on the page, and a reader who only looks. Linking an
// entry or an import line to a raider profile's character.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { adminUser, renderPage } from "../../../test/render";
import GuildBankPage from "../GuildBankPage";
import { bankData, bankItem } from "../guildBank.fixture";
import type { GuildBankCharacterChoice, GuildBankImportRow, GuildBankWaitingEntry } from "../../../api";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getGuildBank: vi.fn(),
    getGuildBankRequests: vi.fn(),
    getGuildBankWaitlist: vi.fn(),
    addGuildBankWaiting: vi.fn(),
    moveGuildBankWaiting: vi.fn(),
    removeGuildBankWaiting: vi.fn(),
    previewGuildBankWaitlist: vi.fn(),
    importGuildBankWaitlist: vi.fn(),
    searchGuildBankCharacters: vi.fn(),
    linkGuildBankRequest: vi.fn(),
    verifyGuildBankRequest: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";

function entry(over: Partial<GuildBankWaitingEntry> = {}): GuildBankWaitingEntry {
    return {
        id: "w1", itemId: 1, item: "Bold Living Ruby", iconUrl: "", amount: 2, userId: "u1", userName: "Anna", characterName: "Zibbo",
        realm: "Spineshatter", purpose: "", createdAt: Date.UTC(2026, 9, 6, 18), position: 1, addedByName: "", linked: true, ...over,
    };
}

const ENTRIES = [
    entry(),
    entry({ id: "w2", userId: "", userName: "Whapap", characterName: "Whapap", amount: 1, position: 2, addedByName: "Arthas", linked: false }),
    entry({ id: "w3", itemId: 3, item: "Flask of Relentless Assault", amount: 3, userName: "Bo", position: 1 }),
];

function row(over: Partial<GuildBankImportRow>): GuildBankImportRow {
    return { line: 1, name: "Whapap", itemText: "Bold Living Ruby", amount: 1, error: "", item: { itemId: 1, name: "Bold Living Ruby", iconUrl: "" }, itemError: "", match: null, ambiguous: false, ok: true, ...over };
}

const WHAPAP: GuildBankCharacterChoice = {
    userId: "u7", userName: "Wha", characterKey: "whapap", characterName: "Whapap", realm: "Spineshatter", className: "Mage",
    versionId: "tbc", icon: "spell_frost_frostbolt02", classColor: "#69CCF0", specKey: "Mage-Frost", verified: true, evidence: "log",
};

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
    vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [] });
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData({
        items: [
            bankItem({ itemId: 1, available: 0, free: 0, waiting: 2, waitingAmount: 3 }),
            bankItem({ itemId: 2, name: "Smooth Dawnstone" }),
            bankItem({ itemId: 3, name: "Flask of Relentless Assault", group: "Fläschchen", waiting: 1, waitingAmount: 3, free: 0, available: 0 }),
            bankItem({ itemId: 4, name: "Primal Might", status: "show" }),
        ],
    }));
    vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: ENTRIES });
    vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [WHAPAP] });
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
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Ausgebbar 3", "Warteliste 3", "Anfragen 0", "Ausgegeben 0", "Nur Bestand 1", "Ausgeblendet 0", "Neu 0"]);
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

    it("lists each item's queue with place, name, amount and the entries not linked", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        const dialog = document.body;
        const ruby = await within(dialog).findByRole("region", { name: "Bold Living Ruby" });
        const rows = within(ruby).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("Anna")).toBeInTheDocument();
        expect(within(rows[0]).getByText("2×")).toBeInTheDocument();
        expect(within(rows[0]).getByText(/^an Zibbo-Spineshatter · seit /)).toBeInTheDocument();
        expect(within(rows[0]).queryByText("nicht verknüpft")).toBeNull();
        expect(within(rows[1]).getByText("Whapap")).toBeInTheDocument();
        expect(within(rows[1]).getByText("nicht verknüpft")).toBeInTheDocument();
        expect(within(rows[1]).getByRole("button", { name: "Verknüpfen: Whapap" })).toBeInTheDocument();
        // a linked entry can be linked anew with the small chain button
        expect(within(rows[0]).getByRole("button", { name: "Anders verknüpfen: Anna" })).toBeInTheDocument();
        expect(within(rows[1]).getByText(/eingetragen von Arthas/)).toBeInTheDocument();
        expect(within(ruby).getByText("2 Einträge")).toBeInTheDocument();
        expect(within(ruby).getByText("Verfügbar 0")).toBeInTheDocument();
        // how the list shares out: the item's portion per turn
        expect(within(ruby).getByText("reihum je 2")).toBeInTheDocument();
        expect(screen.getByText(/reihum in Portionen; ein Rest stellt sich wieder hinten an/)).toBeInTheDocument();
        const flask = within(dialog).getByRole("region", { name: "Flask of Relentless Assault" });
        expect(within(flask).getByText("reihum je 2")).toBeInTheDocument();
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
        // not matched and ambiguous rows land unlinked unless the orga picks someone; the unknown item needs nobody
        expect(within(dialog).getAllByText("nicht verknüpft")).toHaveLength(2);
        expect(within(dialog).getByText("Mehrere Raider – wer?")).toBeInTheDocument();
        expect(within(dialog).getByText(/^2 Zeilen kommen ohne verknüpften Charakter/)).toBeInTheDocument();
        // a typo in the item name: the real item is named under the row
        expect(within(dialog).getByText("erkannt als Bold Living Ruby")).toBeInTheDocument();
        const bad = within(dialog).getByText("Unbekannter Gegenstand.").closest("li");
        expect(bad).toHaveClass("gb-wl-bad");
        await user.click(within(dialog).getByRole("button", { name: "3 Einträge importieren" }));
        expect(api.importGuildBankWaitlist).toHaveBeenCalledWith(KEY, text, {});
        expect(await screen.findByText("3 importiert, 1 übersprungen.")).toBeInTheDocument();
        expect(await screen.findByRole("region", { name: "Bold Living Ruby" })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("links an entry to a profile character: search prefilled with its name, a click links it, the list is read again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.linkGuildBankRequest).mockImplementation(async () => {
            vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: ENTRIES.map((e) => (e.id === "w2" ? { ...e, userId: "u7", userName: "Wha", linked: true } : e)) });
            return { request: {} as never };
        });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(screen.getByRole("button", { name: "Verknüpfen: Whapap" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Charakter verknüpfen")).toBeInTheDocument();
        expect(within(dialog).getByRole("textbox", { name: "Charakter oder Raider suchen" })).toHaveValue("Whapap");
        await waitFor(() => expect(api.searchGuildBankCharacters).toHaveBeenCalledWith(KEY, "Whapap"));
        await user.click(await within(dialog).findByRole("button", { name: "Whapap-Spineshatter von Wha wählen" }));
        expect(api.linkGuildBankRequest).toHaveBeenCalledWith(KEY, "w2", { userId: "u7", characterKey: "whapap" });
        expect(await screen.findByText("Verknüpft mit Whapap-Spineshatter (Wha).")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(screen.queryByText("nicht verknüpft")).toBeNull());
    });

    it("#806: an entry without a profile is checked in game by its own name, after asking once more", async () => {
        const user = userEvent.setup();
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [] });
        vi.mocked(api.verifyGuildBankRequest).mockImplementation(async () => {
            vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: ENTRIES.map((e) => (e.id === "w2" ? { ...e, linked: true, linkProblem: "" as const } : e)) });
            return { request: {} as never };
        });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(screen.getByRole("button", { name: "Verknüpfen: Whapap" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Kein passendes Profil (z. B. ohne Discord-Konto)? Den Namen selbst prüfen:")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Whapap im Spiel geprüft" }));
        expect(api.verifyGuildBankRequest).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: "Ja, gefunden" }));
        expect(api.verifyGuildBankRequest).toHaveBeenCalledWith(KEY, "w2");
        expect(await screen.findByText("Whapap-Spineshatter ist im Spiel geprüft – die Anfrage kann bestätigt werden.")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(screen.queryByText("nicht verknüpft")).toBeNull());
    });

    it("#806: a linked entry's dialog offers no check of its own name", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(screen.getByRole("button", { name: "Anders verknüpfen: Anna" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByRole("button", { name: /im Spiel geprüft$/ })).toBeNull();
    });
    it("picks one of several raiders of an ambiguous import line, or searches one for a name nobody has", async () => {
        const user = userEvent.setup();
        vi.mocked(api.previewGuildBankWaitlist).mockResolvedValue({
            rows: [
                row({ line: 1, name: "Josh", ambiguous: true, candidates: [
                    { userId: "u-a", userName: "Anna", characterKey: "josh", characterName: "Josh", realm: "", className: "Priest" },
                    { userId: "u-b", userName: "Bert", characterKey: "josh", characterName: "Josh", realm: "", className: "Mage" },
                ] }),
                row({ line: 2, name: "Whappy" }),
            ],
        });
        vi.mocked(api.importGuildBankWaitlist).mockResolvedValue({ added: 2, skipped: 0, unlinked: 0, entries: ENTRIES });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user, "Import");
        await user.click(within(dialog).getByRole("textbox", { name: "Zeilen einfügen" }));
        await user.paste("Josh\tBold Living Ruby\nWhappy\tBold Living Ruby");
        await user.click(within(dialog).getByRole("button", { name: "Vorschau" }));
        // the ambiguous line: the candidates as chips
        await user.click(await within(dialog).findByRole("button", { name: "Bert · Magier" }));
        expect(within(dialog).getByText("Josh (Bert)")).toBeInTheDocument();
        // the unknown name: the search inside the dialog
        await user.click(within(dialog).getByRole("button", { name: "Verknüpfen: Whappy" }));
        expect(within(dialog).getByRole("textbox", { name: "Charakter oder Raider suchen" })).toHaveValue("Whappy");
        await user.click(await within(dialog).findByRole("button", { name: "Whapap-Spineshatter von Wha wählen" }));
        expect(within(dialog).getByText("Whapap (Wha)")).toBeInTheDocument();
        expect(within(dialog).queryByText("nicht verknüpft")).toBeNull();
        await user.click(within(dialog).getByRole("button", { name: "2 Einträge importieren" }));
        expect(api.importGuildBankWaitlist).toHaveBeenCalledWith(KEY, "Josh\tBold Living Ruby\nWhappy\tBold Living Ruby", {
            1: { userId: "u-b", characterKey: "josh" }, 2: { userId: "u7", characterKey: "whapap" },
        });
    });

    it("marks an entry whose character nobody confirmed apart from an unlinked one", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankWaitlist).mockResolvedValue({ entries: [
            entry({ id: "w1", userId: "u3", userName: "Gentle", characterName: "Gentle", linked: false, linkProblem: "unverified" }),
            entry({ id: "w2", userId: "", userName: "Whapap", characterName: "Whapap", position: 2, linked: false, linkProblem: "none" }),
        ] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const queue = await openTab(user);
        expect(within(queue).getByText("Charakter nicht bestätigt")).toBeInTheDocument();
        expect(within(queue).getByText("nicht verknüpft")).toBeInTheDocument();
        expect(within(queue).getByRole("button", { name: "Verknüpfen: Gentle" })).toBeInTheDocument();
    });

    it("offers the confirmed characters of the raider for an unconfirmed import name, as chips", async () => {
        const user = userEvent.setup();
        vi.mocked(api.previewGuildBankWaitlist).mockResolvedValue({
            rows: [row({ line: 1, name: "Gentle", unverified: true, candidates: [
                { userId: "u3", userName: "Gentle", characterKey: "gentleowl", characterName: "Gentleowl", realm: "", className: "Druid" },
                { userId: "u3", userName: "Gentle", characterKey: "gentletwowl", characterName: "Gentletwowl", realm: "", className: "Priest" },
            ] })],
        });
        vi.mocked(api.importGuildBankWaitlist).mockResolvedValue({ added: 1, skipped: 0, unlinked: 0, entries: ENTRIES });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user, "Import");
        await user.click(within(dialog).getByRole("textbox", { name: "Zeilen einfügen" }));
        await user.paste("Gentle\tBold Living Ruby");
        await user.click(within(dialog).getByRole("button", { name: "Vorschau" }));
        expect(await within(dialog).findByText("„Gentle“ ist nicht bestätigt – meinst du:")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Gentletwowl · Priester" }));
        expect(within(dialog).getByText("Gentletwowl (Gentle)")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "1 Eintrag importieren" }));
        expect(api.importGuildBankWaitlist).toHaveBeenCalledWith(KEY, "Gentle\tBold Living Ruby", { 1: { userId: "u3", characterKey: "gentletwowl" } });
    });

    it("lets a reader look but not change", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank", user: adminUser({ isAdmin: false, access: { raids: { read: true, write: false } } }) });
        await openTab(user);
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Eintrag anlegen" })).toBeNull();
        expect(screen.queryByRole("button", { name: /Entfernen/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Verknüpfen/ })).toBeNull();
        expect(screen.getByText("nicht verknüpft")).toBeInTheDocument();
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
