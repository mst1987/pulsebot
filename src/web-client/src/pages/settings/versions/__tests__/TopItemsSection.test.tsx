// Einstellungen → Server → Top-Items (#952, variant B "Boss-Schalter"): raids
// and bosses with "n gewählt" on the left, the whole loot of one boss with a
// switch per item on the right; a switch saves at once for the loaded server.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import { adminUser, renderPage } from "../../../../test/render";
import { inLang, switchLang } from "../../../../test/i18n";
import { t } from "../../../../i18n";
import TopItemsSection from "../TopItemsSection";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getTopItems: vi.fn(),
    putTopItem: vi.fn(),
    searchSettingsItems: vi.fn(),
}));

const G1 = "111111111111111111";
const item = (id: number, name: string, quality = 4): api.TopItem => ({ id, name, iconUrl: `https://icons.test/${id}.jpg`, quality });
const WARGLAIVE = item(32837, "Warglaive of Azzinoth", 5);
const CLOAK = item(32524, "Shroud of the Highborne");
const SHARD = item(99001, "Fremdes Item", 3);
const BT: api.TopItemRaid = {
    id: "bt", label: "Black Temple", short: "BT", tierLabel: "T6", bosses: [
        { name: "Mother Shahraz", items: [item(32365, "Heartshatter Breastplate")] },
        { name: "Illidan Stormrage", items: [WARGLAIVE, CLOAK] },
    ],
};

function pageOf(over: Partial<api.TopItemsPage> = {}): api.TopItemsPage {
    return {
        guildId: G1, versionId: "tbc", mainVersion: "tbc",
        versions: [
            { id: "tbc", label: "TBC Anniversary", short: "TBC", count: 2 },
            { id: "forever", label: "WoW Forever", short: "Forever", count: 0 },
        ],
        raids: [BT], items: [WARGLAIVE, SHARD], max: 200, wowheadPath: "tbc",
        ...over,
    };
}

const show = (user = adminUser()) => renderPage(<TopItemsSection guildId={G1} />, { user });
const switchOf = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getTopItems).mockReset();
    vi.mocked(api.putTopItem).mockReset();
    vi.mocked(api.getTopItems).mockImplementation(async (version = "") => (
        version === "forever"
            ? pageOf({ versionId: "forever", raids: [], items: [] })
            : pageOf()));
});
afterEach(() => switchLang("de"));

describe("TopItemsSection (#952)", () => {
    it("opens on the first boss with a pick and counts the picks per boss and version", async () => {
        show();
        expect(await screen.findByRole("heading", { name: "Illidan Stormrage" })).toBeInTheDocument();
        const nav = screen.getByRole("navigation", { name: t("settings.topItems.bosses") });
        expect(within(nav).getByRole("button", { name: /Illidan Stormrage/ })).toHaveTextContent("1 gewählt");
        expect(within(nav).getByRole("button", { name: "Mother Shahraz" })).toBeInTheDocument();
        expect(within(nav).getByRole("button", { name: /Ohne Zuordnung/ })).toHaveTextContent("1 gewählt");
        expect(screen.getByRole("radio", { name: "TBC · 2 gewählt" })).toBeChecked();
        expect(switchOf("Warglaive of Azzinoth")).toBeChecked();
        expect(switchOf("Shroud of the Highborne")).not.toBeChecked();
        expect(screen.getByRole("link", { name: "Warglaive of Azzinoth" })).toHaveAttribute("href", expect.stringContaining("32837"));
    });

    it("saves a switch at once for the loaded server and counts it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.putTopItem).mockResolvedValueOnce({ guildId: G1, versionId: "tbc", items: [WARGLAIVE, SHARD, CLOAK] });
        show();
        await user.click(await screen.findByRole("switch", { name: "Shroud of the Highborne" }));
        expect(api.putTopItem).toHaveBeenCalledWith({ versionId: "tbc", item: CLOAK, on: true, serverSettingsGuildId: G1 });
        await waitFor(() => expect(switchOf("Shroud of the Highborne")).toBeChecked());
        expect(screen.getByRole("button", { name: /Illidan Stormrage/ })).toHaveTextContent("2 gewählt");
        expect(screen.getByRole("radio", { name: "TBC · 3 gewählt" })).toBeInTheDocument();
    });

    it("keeps an unassigned item listed after switching it off, to switch it on again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.putTopItem).mockResolvedValueOnce({ guildId: G1, versionId: "tbc", items: [WARGLAIVE] });
        show();
        await user.click(await screen.findByRole("button", { name: /Ohne Zuordnung/ }));
        await user.click(switchOf("Fremdes Item"));
        await waitFor(() => expect(switchOf("Fremdes Item")).not.toBeChecked());
        expect(api.putTopItem).toHaveBeenCalledWith(expect.objectContaining({ item: SHARD, on: false }));
    });

    // #921: a tab loaded on this server whose session switched to another one
    it("names a server switch instead of the raw error and locks the switches", async () => {
        const user = userEvent.setup();
        vi.mocked(api.putTopItem).mockRejectedValueOnce({ code: "server_switched", message: "raw" });
        show();
        await user.click(await screen.findByRole("switch", { name: "Shroud of the Highborne" }));
        expect(await screen.findByText(t("settings.serverSwitched"))).toBeInTheDocument();
        expect(screen.queryByText("raw")).not.toBeInTheDocument();
        expect(switchOf("Shroud of the Highborne")).toBeDisabled();
        expect(switchOf("Shroud of the Highborne")).not.toBeChecked();
    });

    it("says the limit when the version is full", async () => {
        const user = userEvent.setup();
        vi.mocked(api.putTopItem).mockRejectedValueOnce({ code: "too_many", message: "raw" });
        show();
        await user.click(await screen.findByRole("switch", { name: "Shroud of the Highborne" }));
        expect(await screen.findByText(t("settings.topItems.tooMany", { max: 200 }))).toBeInTheDocument();
    });

    it("shows a version without a loot table as search plus Ohne Zuordnung only", async () => {
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("radio", { name: "Forever" }));
        expect(api.getTopItems).toHaveBeenLastCalledWith("forever");
        expect(await screen.findByText(t("settings.topItems.noTable", { version: "WoW Forever" }))).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Ohne Zuordnung" })).toBeInTheDocument();
        expect(screen.getByText(t("settings.topItems.noneUnassigned"))).toBeInTheDocument();
        expect(screen.getByPlaceholderText(t("settings.topItems.search"))).toBeInTheDocument();
    });

    it("lets a reader look, not switch or search", async () => {
        show(adminUser({ isAdmin: false, access: { settings: { read: true, write: false } } }));
        expect(await screen.findByRole("switch", { name: "Warglaive of Azzinoth" })).toBeDisabled();
        expect(screen.queryByPlaceholderText(t("settings.topItems.search"))).not.toBeInTheDocument();
    });

    it("speaks English", async () => {
        await switchLang("en");
        show();
        expect(await screen.findByRole("radio", { name: "TBC · 2 picked" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Not assigned/ })).toHaveTextContent("1 picked");
        await inLang("en", () => expect(t("settings.topItems.other")).toBe("Other"));
    });
});
