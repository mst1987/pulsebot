// The guild bank page against a mocked API: head, tabs, grouped list, the
// sorting switch, the item dialog, the bank-tab dialog, the empty state and
// the English texts.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { switchLang } from "../../test/i18n";
import { adminUser, CONTENT_ARIA, renderPage, twoVersions } from "../../test/render";
import { t } from "../../i18n";
import GuildBankPage from "./GuildBankPage";
import { bankData, bankItem } from "./guildBank.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    setGuildBankItem: vi.fn(),
    setGuildBankTabHidden: vi.fn(),
    getGuildBankRequests: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData());
});
afterEach(() => switchLang("de"));

describe("guild bank page", () => {
    it("heads the page with version, realm, scan and badges, and lists the requestable items by category", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByRole("heading", { name: "Gildenbank" })).toBeInTheDocument();
        expect(screen.getByText(/^TBC · Spineshatter · Stand .* · gescannt von Gemli$/)).toBeInTheDocument();
        expect(screen.getByText("4.812 g")).toBeInTheDocument();
        expect(screen.getByText("3 Bank-Tabs")).toBeInTheDocument();
        expect(screen.getByText("3 Anfragen vorgemerkt")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Ausgebbar 3/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /Neu 1/ })).toBeInTheDocument();
        const table = screen.getByRole("table", { name: "Gegenstände der Gildenbank" });
        expect(within(table).getByText("Edelsteine")).toBeInTheDocument();
        expect(within(table).getByText("Fläschchen")).toBeInTheDocument();
        const ruby = within(table).getByRole("link", { name: "Klobiger lebendiger Rubin" });
        expect(ruby).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=1");
        expect(within(table).getAllByText("Tab 2: Edelsteine").length).toBe(2);
        expect(within(table).queryByText("Urmacht")).toBeNull();
        expect(api.getGuildBank).toHaveBeenCalledWith({ key: "", version: "" });
    });

    it("shows the new items with the notice and leaves out what lies only in hidden tabs", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("tab", { name: /Neu/ }));
        expect(screen.getByText(/Seit dem letzten Scan neu in der Bank/)).toBeInTheDocument();
        expect(screen.getByText("Heldentrank")).toBeInTheDocument();
        expect(screen.queryByText("Schattenstoff")).toBeNull();
    });

    it("sorts an item with the switch and moves it to its new tab", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankItem).mockResolvedValue({ item: bankItem({ itemId: 1, status: "show" }) });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const group = await screen.findByRole("radiogroup", { name: "Einordnung von Klobiger lebendiger Rubin" });
        expect(within(group).getByRole("radio", { name: "Ausgebbar" })).toHaveAttribute("aria-checked", "true");
        await user.click(within(group).getByRole("radio", { name: "Nur Bestand" }));
        expect(api.setGuildBankItem).toHaveBeenCalledWith(KEY, 1, { status: "show" });
        await waitFor(() => expect(screen.queryByText("Klobiger lebendiger Rubin")).toBeNull());
        expect(screen.getByRole("tab", { name: /Nur Bestand 2/ })).toBeInTheDocument();
    });

    it("filters by category and search", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: /Kategorie: Alle/ }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Kategorie" }), "Fläschchen");
        expect(screen.queryByText("Klobiger lebendiger Rubin")).toBeNull();
        expect(screen.getByText("Fläschchen des unerbittlichen Angriffs")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Kategorie: Fläschchen/ }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Kategorie" }), "");
        await user.type(screen.getByPlaceholderText("Gegenstand suchen"), "glatt");
        expect(screen.getByText("Glatter Dämmerstein")).toBeInTheDocument();
        expect(screen.queryByText("Klobiger lebendiger Rubin")).toBeNull();
    });

    it("saves reserve, limit and category from the item dialog", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankItem).mockResolvedValue({ item: bankItem({ itemId: 1, reserve: 2, maxPerRequest: 5, reserved: 4, available: 4 }) });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Reserve und Höchstmenge: Klobiger lebendiger Rubin" }));
        const reserve = screen.getByRole("textbox", { name: "Reserve" });
        await user.clear(reserve);
        await user.type(reserve, "x");
        expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
        await user.clear(reserve);
        await user.type(reserve, "2");
        const max = screen.getByRole("textbox", { name: "Höchstmenge pro Anfrage" });
        await user.clear(max);
        await user.type(max, "5");
        await user.type(screen.getByRole("textbox", { name: "Kategorie" }), " Raid ");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        expect(api.setGuildBankItem).toHaveBeenCalledWith(KEY, 1, { reserve: 2, maxPerRequest: 5, category: "Raid" });
        await waitFor(() => expect(screen.queryByRole("textbox", { name: "Höchstmenge pro Anfrage" })).toBeNull());
    });

    it("hides a bank tab and reads the bank again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankTabHidden).mockResolvedValue({ tabs: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Bank-Tabs" }));
        const raid = screen.getByRole("switch", { name: "Tab 3: Raid" });
        expect(raid).toBeChecked();
        expect(screen.getByRole("switch", { name: "Tab 5: Lager" })).not.toBeChecked();
        await user.click(raid);
        expect(api.setGuildBankTabHidden).toHaveBeenCalledWith(KEY, 3, true);
        await waitFor(() => expect(api.getGuildBank).toHaveBeenCalledTimes(2));
    });

    it("lists the waiting requests in the 'Anfragen' dialog and reads the bank again when it closes", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({
            requests: [
                {
                    id: "r2", itemId: 2, item: "Glatter Dämmerstein", iconUrl: "", amount: 1, userId: "u2", userName: "Bo", characterName: "",
                    realm: "", purpose: "", status: "open", createdAt: Date.UTC(2026, 9, 6, 18), handledByName: "", handledAt: 0,
                },
                {
                    id: "r1", itemId: 1, item: "Klobiger lebendiger Rubin", iconUrl: "https://example.test/ruby.jpg", amount: 2, userId: "u1",
                    userName: "Anna", characterName: "Zibbo", realm: "Spine Shatter", purpose: "Gruul", status: "confirmed",
                    createdAt: Date.UTC(2026, 9, 6, 17), handledByName: "Arthas", handledAt: 1,
                },
            ],
        });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        const list = await screen.findByRole("list", { name: "Anfragen" });
        const rows = within(list).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("1× Glatter Dämmerstein")).toBeInTheDocument();
        expect(within(rows[0]).getByText("Offen")).toBeInTheDocument();
        expect(within(rows[1]).getByText("2× Klobiger lebendiger Rubin")).toBeInTheDocument();
        expect(within(rows[1]).getByText(/^Anna · an Zibbo-SpineShatter · /)).toBeInTheDocument();
        expect(within(rows[1]).getByText("Wofür: Gruul")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Vorgemerkt")).toBeInTheDocument();
        expect(api.getGuildBankRequests).toHaveBeenCalledWith(KEY);
        // the dialog's close button in its foot (the head has an "X" of the same name)
        const closers = screen.getAllByRole("button", { name: "Schließen" });
        await user.click(closers[closers.length - 1]);
        await waitFor(() => expect(api.getGuildBank).toHaveBeenCalledTimes(2));
    });

    it("says so when no request waits", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        expect(await screen.findByText("Gerade wartet keine Anfrage.")).toBeInTheDocument();
    });

    it("lets a reader look but not change", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank", user: adminUser({ isAdmin: false, access: { raids: { read: true, write: false } } }) });
        const group = await screen.findByRole("radiogroup", { name: "Einordnung von Klobiger lebendiger Rubin" });
        expect(within(group).getByRole("radio", { name: "Nur Bestand" })).toBeDisabled();
        expect(screen.queryByRole("button", { name: /Reserve und Höchstmenge:/ })).toBeNull();
    });

    it("explains the addon and links the assignment when the server has no bank", async () => {
        vi.mocked(api.getGuildBank).mockResolvedValue({ banks: [], bank: null });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByText("Noch keine Gildenbank")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zur Zuordnung" })).toHaveAttribute("href", "/settings?section=verbindungen");
    });

    it("asks for the content version's bank and offers a select with several banks", async () => {
        const user = userEvent.setup();
        localStorage.removeItem("eh-content-version");
        const banks = [
            { key: KEY, gameVersion: "tbc", versionShort: "TBC", realm: "Spineshatter", guild: "Die Gilde", scannedAt: 1 },
            { key: "forever:x:die gilde", gameVersion: "forever", versionShort: "Forever", realm: "X", guild: "Die Gilde", scannedAt: 1 },
        ];
        vi.mocked(api.getGuildBank).mockResolvedValue(bankData({}, banks));
        renderPage(<GuildBankPage />, { route: "/guildbank", content: twoVersions() });
        expect(await screen.findByRole("heading", { name: "Gildenbank" })).toBeInTheDocument();
        expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "", version: "tbc" });
        await user.selectOptions(screen.getByLabelText("Gildenbank wählen"), "forever:x:die gilde");
        await waitFor(() => expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "forever:x:die gilde", version: "tbc" }));
        await user.click(within(screen.getByRole("radiogroup", { name: t(CONTENT_ARIA) })).getByRole("radio", { name: /Forever/ }));
        await waitFor(() => expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "", version: "forever" }));
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByRole("heading", { name: "Guild bank" })).toBeInTheDocument();
        expect(screen.getByText("4,812 g")).toBeInTheDocument();
        expect(screen.getByText("3 requests set aside")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Requestable 3/ })).toBeInTheDocument();
        expect(screen.getByText("Available = stock - set aside - reserve")).toBeInTheDocument();
    });
});
