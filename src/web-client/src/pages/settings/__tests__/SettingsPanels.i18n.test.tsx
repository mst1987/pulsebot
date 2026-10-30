// The Einstellungen panels in English (#440): the permission matrix, the
// category list, the bot commands and the Discord servers each render their
// own texts in the language the page is switched to. The German behaviour of
// these panels is guarded by SettingsPage.sections.test.tsx and the convention
// tests under test/web-client/conventions/.
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { BotCommandsData, DiscordServersData } from "../../../api";
import { renderPage } from "../../../test/render";
import { switchLang } from "../../../test/i18n";
import RolePermissionsEditor from "../access/RolePermissions";
import CategoryMatrix from "../categories/CategoryMatrix";
import BotCommandAccess from "../access/BotCommandAccess";
import DiscordServersSection from "../discord/SettingsDiscordServers";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getBotCommands: vi.fn(),
    getDiscordServers: vi.fn(),
    getTalkOverview: vi.fn(),
    getRoleSync: vi.fn(),
    getReminders: vi.fn(),
    getRaiderCharacters: vi.fn(),
}));

const noop = () => undefined;

beforeEach(async () => {
    await switchLang("en");
    vi.mocked(api.getTalkOverview).mockResolvedValue({ statuses: [] });
    vi.mocked(api.getRoleSync).mockResolvedValue({ roleSync: [], servers: [], overlaps: [], drift: [], driftTotal: 0, driftError: null, lastRun: null });
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], lastRun: null });
    vi.mocked(api.getRaiderCharacters).mockRejectedValue(new Error("offline"));
});
afterEach(() => switchLang("de"));

describe("the Einstellungen panels in English", () => {
    it("labels the permission matrix and translates the area names", () => {
        renderPage(
            <RolePermissionsEditor
                areas={[{ id: "history", tab: "history", label: "Historie & Loot", description: "Loot-Import, Event- und Charakter-Historie." }]}
                roles={[{ id: "r1", name: "Raidlead" }]}
                adminRoleIds={[]}
                value={{ r1: { history: { read: true, write: false } } }}
                onChange={noop}
                baseAccess={{}}
                onBaseAccessChange={noop}
                userPermissions={{}}
                onUserPermissionsChange={noop}
                userNames={{}}
                icon="inv_scroll_11"
                crumb="Access"
            />,
        );
        expect(screen.getByText("Permissions")).toBeInTheDocument();
        expect(screen.getByText("Full admins")).toBeInTheDocument();
        expect(screen.getByText("Everyone signed in")).toBeInTheDocument();
        expect(screen.getByText("1 × read · 0 × write")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "@Raidlead · History & loot: Read" })).toBeInTheDocument();
    });

    it("words the category list", () => {
        renderPage(
            <CategoryMatrix
                categories={[{ id: "c1", name: "Raids Mittwoch" }, { id: "c2", name: "Allgemein" }]}
                roles={[]}
                categoryIds={["c1"]}
                categoryRoles={{}}
                categoryLootTool={{}}
                categorySheets={{}}
                savedCategoryRoles={{}}
                onToggleCategory={noop}
                onToggleRole={noop}
                onLootTool={noop}
                onSignupSource={noop}
                onSheet={noop}
                icon="inv_banner_03"
                crumb="Raid categories"
            />,
        );
        expect(screen.getByText("Categories")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Raid categories 1" })).toBeInTheDocument();
        expect(screen.getByText("1 still Raid-Helper")).toBeInTheDocument();
        expect(screen.getByText("1 more Discord category without raid events")).toBeInTheDocument();
        // no fixed sheet and no pick: the category plans with the raid plan
        expect(screen.getByText("Raid plan")).toBeInTheDocument();
    });

    it("words the bot commands", async () => {
        const data: BotCommandsData = {
            groups: [{ id: "auctions", label: "Auktionen", icon: "inv_misc_coin_01" }],
            commands: [{
                name: "bid", description: "Bieten", group: "auctions", kind: "slash",
                defaultAccess: { mode: "everyone", roleIds: [] }, access: null, effective: { mode: "everyone", roleIds: [] }, inherits: [],
            }],
            roles: [], guildId: "g1", guildName: "Pulse",
        };
        vi.mocked(api.getBotCommands).mockResolvedValue(data);
        renderPage(<BotCommandAccess viewSwitch={null} icon="inv_scroll_11" crumb="Access" />);
        expect(await screen.findByText("1 command · Everyone")).toBeInTheDocument();
        expect(screen.getByText(/^Admins may always do everything · roles of/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit /bid" })).toBeInTheDocument();
    });

    it("words the Discord servers", async () => {
        const data: DiscordServersData = {
            discordServers: { servers: [], links: [] },
            channels: {}, servers: [], guilds: [], versions: [],
        };
        vi.mocked(api.getDiscordServers).mockResolvedValue(data);
        renderPage(<DiscordServersSection onConfig={noop} crumb="Connections" />);
        expect(await screen.findByText("No server yet — add the Discord your raids run on.")).toBeInTheDocument();
        expect(screen.getByText("Add a server first, then its channels can be picked.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
        expect(screen.getByText("0 servers")).toBeInTheDocument();
        // design B: the tabs in English, the links and the reminders behind their own tab
        expect(screen.getByRole("tablist", { name: "Parts of the Discord servers" })).toBeInTheDocument();
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Servers0", "Links0", "Roles", "Reminders"]);
        fireEvent.click(screen.getByRole("tab", { name: /^Links/ }));
        expect(await screen.findByText("No link yet — without a link the bot posts no raid list.")).toBeInTheDocument();
        expect(screen.getByText("0 links")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: /^Reminders/ }));
        expect(await screen.findByText("Reminders", { selector: ".part-title *" })).toBeInTheDocument();
    });
});
