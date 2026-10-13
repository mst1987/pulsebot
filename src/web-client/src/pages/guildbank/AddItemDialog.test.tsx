// "Gegenstand hinzufügen" against a mocked API: an id or link adds at
// once, a name is searched on Wowhead and a hit adds, the new item shows under
// "Ausgebbar", a refusal stays in the dialog, and a reader has no button.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { adminUser, renderPage } from "../../test/render";
import GuildBankPage from "./GuildBankPage";
import { bankData, bankItem } from "./guildBank.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    getGuildBankRequests: vi.fn(),
    searchGuildBankItems: vi.fn(),
    addGuildBankItem: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";
const SPINEL = bankItem({ itemId: 32227, name: "Crimson Spinel", count: 0, tabs: {}, allTabs: {}, totalCount: 0, available: 0, free: 0, addedByHand: true, group: "Edelsteine" });

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Gegenstand hinzufügen" }));
    return screen.findByRole("dialog");
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [] });
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData());
    vi.mocked(api.addGuildBankItem).mockResolvedValue({ item: SPINEL, created: true });
    vi.mocked(api.searchGuildBankItems).mockResolvedValue({
        items: [{ id: 32227, name: "Crimson Spinel", icon: "inv_x", iconUrl: "", quality: 4 }, { id: 32196, name: "Runed Crimson Spinel", icon: "inv_y", iconUrl: "", quality: 4 }],
    });
});

describe("guild bank: add an item by hand", () => {
    it("adds by item id, shows the item under Ausgebbar and reads the bank again", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user);
        expect(within(dialog).getByText(/Anfragen kommen auf die Warteliste/)).toBeInTheDocument();
        vi.mocked(api.getGuildBank).mockResolvedValue(bankData({ items: [...bankData().bank!.items, SPINEL] }));
        await user.type(within(dialog).getByLabelText("Item-ID, Wowhead-Link oder Name"), "32227");
        expect(within(dialog).getByText("Wird mit dieser ID angelegt.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
        await waitFor(() => expect(api.addGuildBankItem).toHaveBeenCalledWith(KEY, { query: "32227" }));
        expect(await screen.findByText("Crimson Spinel")).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(api.searchGuildBankItems).not.toHaveBeenCalled();
        expect(api.getGuildBank).toHaveBeenCalledTimes(2);
    });

    it("searches a name on Wowhead and adds the hit that was clicked", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user);
        await user.type(within(dialog).getByLabelText("Item-ID, Wowhead-Link oder Name"), "Crimson Spinel");
        const hits = await within(dialog).findByRole("list", { name: "Treffer" });
        expect(api.searchGuildBankItems).toHaveBeenLastCalledWith(KEY, "Crimson Spinel");
        expect(within(hits).getByText("Item-ID 32196")).toBeInTheDocument();
        await user.click(within(hits).getByRole("button", { name: /^Crimson Spinel/ }));
        await waitFor(() => expect(api.addGuildBankItem).toHaveBeenCalledWith(KEY, { itemId: 32227 }));
    });

    it("says so when nothing is found, and toasts the server's refusal with the dialog staying open", async () => {
        const user = userEvent.setup();
        vi.mocked(api.searchGuildBankItems).mockResolvedValue({ items: [] });
        vi.mocked(api.addGuildBankItem).mockRejectedValue({ message: "Ungültige Item-ID." });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const dialog = await openDialog(user);
        const input = within(dialog).getByLabelText("Item-ID, Wowhead-Link oder Name");
        await user.type(input, "Nichtsda");
        expect(await within(dialog).findByText(/Nichts gefunden/)).toBeInTheDocument();
        await user.clear(input);
        await user.type(input, "99999999");
        await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
        expect(await screen.findByText("Ungültige Item-ID.")).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("gives a reader no button", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank", user: adminUser({ isAdmin: false, access: { raids: { read: true, write: false } } }) });
        await screen.findByRole("tab", { name: /^Anfragen/ });
        expect(screen.queryByRole("button", { name: "Gegenstand hinzufügen" })).toBeNull();
    });
});
