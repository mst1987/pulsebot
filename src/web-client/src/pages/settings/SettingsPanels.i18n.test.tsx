// The Einstellungen panels in English (#440): the permission matrix, the
// category list, the bot commands and the Discord servers each render their
// own texts in the language the page is switched to. The German behaviour of
// these panels is guarded by SettingsPage.sections.test.tsx and the convention
// tests under test/web-client/conventions/.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { BotCommandsData, DiscordServersData } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import RolePermissionsEditor from "./RolePermissions";
import CategoryMatrix from "./CategoryMatrix";
import BotCommandAccess from "./BotCommandAccess";
import DiscordServersSection from "./SettingsDiscordServers";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
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
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], pingTargets: { talk: false, talkGuildName: "", talkChannelName: "" }, lastRun: null });
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
                onAdminRoleIds={noop}
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
        expect(screen.getByText("no sheet")).toBeInTheDocument();
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
        const data = {
            discordServers: { eventGuilds: [], talkGuildId: "", talkPingChannelId: "", signupNoteChannelId: "" },
            events: [], talk: null, overlap: null, guilds: [],
        } as unknown as DiscordServersData;
        vi.mocked(api.getDiscordServers).mockResolvedValue(data);
        renderPage(<DiscordServersSection onConfig={noop} icon="inv_letter_15" crumb="Connections" />);
        expect(await screen.findByText("No event Discord chosen yet.")).toBeInTheDocument();
        const talk = document.querySelector("[data-server='talk']") as HTMLElement;
        expect(within(talk).getByText("No second server")).toBeInTheDocument();
        expect(await screen.findByText("Reminders")).toBeInTheDocument();
    });
});
