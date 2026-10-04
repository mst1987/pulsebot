// The Einstellungen page's section column and save bar: every section opens a
// panel, a limited settings user never sees the full-admin sections or the
// credentials, an old section id lands where its setting lives now, and the
// save bar follows the draft — sending the access fields only when the server
// would accept them and never the connection blocks (each modal saves its own).
//
// The big panels (permission matrix, category matrix, Discord servers) have
// their own tests; here they are stand-ins that show which panel is open.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, SettingsData } from "../../api";
import { SETTINGS_SECTIONS, sectionLabel, visibleSections } from "../../lib/settingsSections";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import SettingsPage from "./SettingsPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getIngestTokens: vi.fn(),
    getAvailabilityPanels: vi.fn(),
}));

vi.mock("./RolePermissions", () => ({ default: () => <div>Panel Berechtigungen</div> }));
vi.mock("./BotCommandAccess", () => ({ default: () => <div>Panel Bot-Befehle</div> }));
vi.mock("./SettingsDiscordServers", () => ({ default: () => <div>Panel Discord-Server</div> }));
vi.mock("./SettingsRaidhelperRetirement", () => ({ default: () => null }));
// The category matrix edits the per-category maps through its callbacks; the
// stand-in clears the first category's sheet url the way its field would.
vi.mock("./CategoryMatrix", () => ({
    default: ({ onSheet, availabilityPanels }: {
        onSheet: (id: string, sheet: { url: string; name: string }) => void;
        availabilityPanels?: { panels: { categoryId: string }[]; channels: { id: string }[]; onChange: (id: string, panel: unknown) => void };
    }) => (
        <div>
            Panel Kategorien
            <button type="button" onClick={() => onSheet("cat1", { url: "", name: "Montag-Sheet" })}>Sheet-URL leeren</button>
            {availabilityPanels && (
                <>
                    <output data-testid="panels">{availabilityPanels.panels.map((p) => p.categoryId).join(",")}|{availabilityPanels.channels.map((c) => c.id).join(",")}</output>
                    <button type="button" onClick={() => availabilityPanels.onChange("cat2", { categoryId: "cat2", channelId: "n1", postedAt: 1, url: "" })}>Panel posten</button>
                </>
            )}
        </div>
    ),
}));

function config(over: Partial<AdminConfig> = {}): AdminConfig {
    return {
        adminRoleIds: ["r1"], rolePermissions: {}, baseAccess: {}, userPermissions: {},
        guildId: "g1", raidhelperServerId: "", officerRoleId: "", applicationChannelId: "",
        highestBidsChannelId: "", highestBidsMessageId: "",
        categoryIds: ["cat1"], categoryRoles: {}, logChannelIds: [], raidDefaults: { channelId: "" },
        categoryRaidTemplate: {}, blizzard: { clientId: "", region: "eu", realmSlug: "thunderstrike", namespace: "" },
        categoryLootTool: {},
        categorySheets: { cat1: { url: "https://docs.google.com/a", name: "Montag-Sheet" }, cat2: { url: " https://docs.google.com/b ", name: "Mittwoch" } },
        topItems: [],
        ...over,
    };
}

function settings(over: Partial<SettingsData> = {}): SettingsData {
    return {
        config: config(), canManageAccess: true, areas: [], raidsheets: [],
        roles: [{ id: "r1", name: "Offizier" }],
        categories: [{ id: "cat1", name: "Montag" }, { id: "cat2", name: "Mittwoch" }],
        channels: [{ id: "ch1", name: "raids", category: "" }],
        bot: { online: true, readySince: 0, guildName: "Pulse" },
        servers: { events: [], talk: null },
        activeGuildId: "g1",
        ...over,
    };
}

const limited = () => settings({ canManageAccess: false, config: config({ adminRoleIds: undefined as unknown as string[], rolePermissions: undefined }) });

const nav = () => screen.getByRole("navigation", { name: "Einstellungs-Bereiche" });
const entry = (label: string) => within(nav()).getByRole("button", { name: new RegExp(`^${label}`) });

beforeEach(() => {
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(settings());
    vi.mocked(api.updateSettings).mockReset().mockImplementation(async (partial) => ({ config: { ...config(), ...partial } as AdminConfig }));
    vi.mocked(api.getIngestTokens).mockReset().mockResolvedValue({ tokens: [] });
    vi.mocked(api.getAvailabilityPanels).mockReset().mockResolvedValue({ panels: [{ categoryId: "cat1", channelId: "n1", postedAt: 1, url: "" }] });
});

describe("the section column", () => {
    it("lists every section under its group heading, each once", async () => {
        renderPage(<SettingsPage />, { route: "/settings" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });

        const labels = within(nav()).getAllByRole("button").map((b) => b.querySelector(".section-nav-text")?.textContent);
        expect(labels).toEqual(SETTINGS_SECTIONS.map(sectionLabel));
        expect(labels[0]).toBe("Berechtigungen");
        for (const group of ["Zugang", "Raid-Kategorien", "Module"]) {
            expect({ group, count: within(nav()).getAllByText(group).length }).toEqual({ group, count: 1 });
        }
    });

    it("opens a panel for every section", async () => {
        const user = userEvent.setup();
        const { container } = renderPage(<SettingsPage />, { route: "/settings" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });

        for (const s of visibleSections(true)) {
            await user.click(entry(sectionLabel(s)));
            await waitFor(() => expect(entry(sectionLabel(s))).toHaveAttribute("aria-current", "true"));
            const panel = container.querySelector(".settings-panel")!;
            expect({ section: s.id, hasPanel: panel.childElementCount > 0 && panel.textContent !== "" }).toEqual({ section: s.id, hasPanel: true });
        }
    });

    it("carries a WoW icon per entry and counts what is missing", async () => {
        renderPage(<SettingsPage />, { route: "/settings" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });

        for (const s of SETTINGS_SECTIONS) {
            expect({ id: s.id, icon: !!entry(sectionLabel(s)).querySelector(`img[src*="/${s.icon}.jpg"]`) }).toEqual({ id: s.id, icon: true });
        }
        // Bot online, but Battle.net, Warcraft Logs, the AI key and a loot-sync token missing.
        await waitFor(() => expect(within(entry("Verbindungen")).getByText("4")).toHaveAttribute("data-tip", "4 Verbindungen nicht eingerichtet"));
        expect(within(entry("Kategorien")).getByText("1")).toHaveAttribute("data-tip", "1 aktive Raid-Kategorien");
        expect(entry("Raid-Standardwerte").querySelector(".badge")).toBeNull();
    });

    it("sends an id merged away in the redesign to the section that holds the setting now", async () => {
        renderPage(<SettingsPage />, { route: "/settings?section=raidchars" });
        expect(await screen.findByText("Panel Kategorien")).toBeInTheDocument();
        expect(entry("Kategorien")).toHaveAttribute("aria-current", "true");
    });
});

describe("a limited settings user", () => {
    it("never sees the full-admin sections, not even through a link", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=berechtigungen" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });

        expect(within(nav()).queryByRole("button", { name: /^Berechtigungen/ })).not.toBeInTheDocument();
        expect(within(nav()).queryByRole("button", { name: /^Discord-Server/ })).not.toBeInTheDocument();
        expect(screen.queryByText("Panel Berechtigungen")).not.toBeInTheDocument();
        expect(entry(sectionLabel(visibleSections(false)[0]))).toHaveAttribute("aria-current", "true");
    });

    it("sees only the Battle.net card among the connections", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=verbindungen" });

        expect(await screen.findByText("Battle.net / Armory")).toBeInTheDocument();
        for (const hidden of ["Discord & Raid-Helper", "Warcraft Logs", "KI-Formulierung", "Loot-Sync"]) {
            expect({ hidden, shown: !!screen.queryByText(hidden) }).toEqual({ hidden, shown: false });
        }
        expect(api.getIngestTokens).not.toHaveBeenCalled();
        expect(within(entry("Verbindungen")).getByText("1")).toBeInTheDocument();
    });

    it("sees every connection card as a full admin", async () => {
        renderPage(<SettingsPage />, { route: "/settings?section=verbindungen" });
        for (const shown of ["Battle.net / Armory", "Discord & Raid-Helper", "Warcraft Logs", "KI-Formulierung", "Loot-Sync"]) {
            expect(await screen.findByText(shown)).toBeInTheDocument();
        }
    });
});

describe("the save bar", () => {
    it("appears as soon as the draft differs, counts the changes and can throw them away", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        const channel = await screen.findByRole("combobox", { name: "Standard-Kanal" });
        expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
        expect(document.querySelector("form")).toBeNull();

        await user.selectOptions(channel, "ch1");
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Verwerfen" }));
        expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Standard-Kanal" })).toHaveValue("");
        expect(api.updateSettings).not.toHaveBeenCalled();
    });

    it("sends the access fields as a full admin, and never the connection blocks", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body).toMatchObject({ adminRoleIds: ["r1"], rolePermissions: {}, baseAccess: {}, userPermissions: {}, raidDefaults: { channelId: "ch1" } });
        for (const block of ["anthropic", "warcraftlogsV2", "blizzard", "guildId", "raidhelperServerId"]) {
            expect({ block, sent: block in body }).toEqual({ block, sent: false });
        }
        expect(await screen.findByText("Gespeichert.")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument());
    });

    it("shows the saved bot language, marks the draft dirty on a switch and sends it on save", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ botLanguage: "en" }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        const group = await screen.findByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(within(group).getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument();

        await user.click(within(group).getByRole("radio", { name: "Deutsch" }));
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        expect(screen.getByText("Bot-Sprache: Deutsch")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ botLanguage: "de" });
    });

    it("defaults the bot language to German when the server sends none", async () => {
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        const group = await screen.findByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(within(group).getByRole("radio", { name: "Deutsch" })).toHaveAttribute("aria-checked", "true");
    });

    it("leaves the access fields out for a limited settings user, whom the server would refuse", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        for (const field of ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
        expect(body.raidDefaults).toEqual({ channelId: "ch1" });
    });

    it("sends the whole sheet map, so clearing a url removes the assignment", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });

        await user.click(await screen.findByRole("button", { name: "Sheet-URL leeren" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].categorySheets).toEqual({
            cat1: { url: "", name: "Montag-Sheet" },
            cat2: { url: "https://docs.google.com/b", name: "Mittwoch" },
        });
    });

    it("hands the posted absence/attendance panels to the categories and keeps a new one out of the draft", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });
        // the text channels come from noteChannels — none here
        expect(await screen.findByTestId("panels")).toHaveTextContent("cat1|");
        expect(api.getAvailabilityPanels).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole("button", { name: "Panel posten" }));
        expect(screen.getByTestId("panels")).toHaveTextContent("cat1,cat2|");
        // posted at once: nothing waits in the save bar
        expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("names the page, the sections, the connection cards and the save bar in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=verbindungen" });

        const nav = await screen.findByRole("navigation", { name: "Settings sections" });
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
        expect(within(nav).getByRole("button", { name: /^Permissions/ })).toBeInTheDocument();
        expect(within(nav).getByText("Raid categories")).toBeInTheDocument();
        expect(await screen.findByText("AI wording")).toBeInTheDocument();
        expect(screen.getAllByText("Full admins only").length).toBeGreaterThan(0);

        await user.click(within(nav).getByRole("button", { name: /^Raid defaults/ }));
        await user.selectOptions(await screen.findByRole("combobox", { name: "Default channel" }), "ch1");
        expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    });
});

describe("Spielversion (#541)", () => {
    const gameVersions = [
        { id: "tbc", label: "TBC Anniversary", short: "TBC" },
        { id: "classic", label: "Classic Era", short: "Classic" },
        { id: "forever", label: "WoW Forever", short: "Forever" },
    ];

    it("switches the main version, overrides one category and sends both with the draft", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions }));
        renderPage(<SettingsPage />, { route: "/settings?section=spielversion" });

        const main = await screen.findByRole("radiogroup", { name: "Hauptversion" });
        expect(within(main).getByRole("radio", { name: "TBC" })).toHaveAttribute("aria-checked", "true");
        // only the active category gets a row, and it follows the main version
        const montag = screen.getByRole("combobox", { name: "Spielversion von Montag" });
        expect(montag).toHaveValue("");
        expect(within(montag).getByRole("option", { name: "Hauptversion (TBC)" })).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Spielversion von Mittwoch" })).not.toBeInTheDocument();

        await user.click(within(main).getByRole("radio", { name: "Forever" }));
        expect(within(montag).getByRole("option", { name: "Hauptversion (Forever)" })).toBeInTheDocument();
        await user.selectOptions(montag, "tbc");
        expect(screen.getByText("2 ungespeicherte Änderungen")).toBeInTheDocument();
        expect(screen.getByText(/Hauptversion → Forever/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ mainVersion: "forever", categoryVersion: { cat1: "tbc" } });
    });

    it("leaves a category on the main version out of the map", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions, config: config({ mainVersion: "forever", categoryVersion: { cat1: "tbc" } }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=spielversion" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Spielversion von Montag" }), "");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ mainVersion: "forever", categoryVersion: {} });
    });

    it("says where to switch a category on when none is active", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions, config: config({ categoryIds: [] }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=spielversion" });
        expect(await screen.findByText(/Noch keine aktive Kategorie/)).toBeInTheDocument();
    });

    it("names the section in English", async () => {
        await switchLang("en");
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions }));
        renderPage(<SettingsPage />, { route: "/settings?section=spielversion" });
        expect(await screen.findByRole("radiogroup", { name: "Main version" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Main version (TBC)" })).toBeInTheDocument();
    });
});
