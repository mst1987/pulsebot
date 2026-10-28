// The Einstellungen page's section rail and save bar: every section opens a
// panel, a limited settings user never sees the full-admin sections or the
// credentials, an old section id lands where its setting lives now, and the
// save bar follows the draft — sending the access fields only when the server
// would accept them and never the connection blocks (each modal saves its own).
//
// The sections are the page's icon rail (components/ui/SectionRail.tsx) left of
// the page; below 900 px the same markup is a chip row — that switch is CSS
// (test/web-client/conventions/sectionNav.test.js).
//
// The big panels (permission matrix, category matrix, Discord servers) have
// their own tests; here they are stand-ins that show which panel is open.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { JobsProvider } from "../../components/shell/Jobs";
import { ConfirmProvider } from "../../components/ui/Modal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, SettingsData } from "../../api";
import { SETTINGS_SECTIONS, sectionLabel, sectionsFor } from "../../lib/settings/settingsSections";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import SettingsPage from "./SettingsPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getIngestTokens: vi.fn(),
    getAvailabilityPanels: vi.fn(),
    getCategorySwitch: vi.fn(),
    getCategoryDeactivate: vi.fn(),
    closeCategory: vi.fn(),
}));

vi.mock("./RolePermissions", () => ({ default: () => <div>Panel Berechtigungen</div> }));
vi.mock("./BotCommandAccess", () => ({ default: () => <div>Panel Bot-Befehle</div> }));
vi.mock("./SettingsDiscordServers", () => ({ default: () => <div>Panel Discord-Server</div> }));
vi.mock("./SettingsRaidhelperRetirement", () => ({ default: () => null }));
// The category matrix edits the per-category maps through its callbacks; the
// stand-in clears the first category's sheet url the way its field would.
vi.mock("./CategoryMatrix", () => ({
    default: ({ onSheet, onPlanning, availabilityPanels, onToggleCategory, missing = [], onCloseCategory, closeBlocked }: {
        onSheet: (id: string, sheet: { url: string; name: string }) => void;
        onPlanning?: (id: string, mode: "raidplan" | "sheet") => void;
        availabilityPanels?: { panels: { categoryId: string }[]; channels: { id: string }[]; onChange: (id: string, panel: unknown) => void };
        onToggleCategory: (id: string) => void;
        missing?: { categoryId: string; name: string }[];
        onCloseCategory?: (c: unknown) => void;
        closeBlocked?: boolean;
    }) => (
        <div>
            Panel Kategorien
            <button type="button" onClick={() => onToggleCategory("cat1")}>Montag umschalten</button>
            {missing.map((m) => (
                <button key={m.categoryId} type="button" disabled={closeBlocked} onClick={() => onCloseCategory && onCloseCategory(m)}>{`${m.name} abschließen …`}</button>
            ))}
            <button type="button" onClick={() => onSheet("cat1", { url: "", name: "Montag-Sheet" })}>Sheet-URL leeren</button>
            {onPlanning && <button type="button" onClick={() => onPlanning("cat2", "raidplan")}>Mittwoch mit Raidplan</button>}
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
        categoryIds: ["cat1"], categoryRoles: {}, raidDefaults: { channelId: "" },
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
        servers: { events: [] },
        activeGuildId: "g1",
        ...over,
    };
}

const limited = () => settings({ canManageAccess: false, config: config({ adminRoleIds: undefined as unknown as string[], rolePermissions: undefined }) });

const nav = () => screen.getByRole("navigation", { name: "Einstellungs-Bereiche" });
const entry = (label: string) => within(nav()).getByRole("button", { name: new RegExp(`^${label}`) });

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(settings());
    vi.mocked(api.updateSettings).mockReset().mockImplementation(async (partial) => ({ config: { ...config(), ...partial } as AdminConfig }));
    vi.mocked(api.getIngestTokens).mockReset().mockResolvedValue({ tokens: [] });
    vi.mocked(api.getAvailabilityPanels).mockReset().mockResolvedValue({ panels: [{ categoryId: "cat1", channelId: "n1", postedAt: 1, url: "" }], links: {}, maxLinks: 5 });
});

describe("the section rail", () => {
    it("sits left of the page head and the open section, which keeps its width rule", async () => {
        const { container } = renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=verbindungen" });
        const rail = await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        expect(rail).toHaveClass("srail");
        const layout = rail.closest(".srail-layout")!;
        expect(layout).toHaveClass("settings-layout");
        const main = layout.querySelector(":scope > .srail-main")!;
        expect(main.querySelector(".settings-head")).not.toBeNull();
        expect(container.querySelector(".srail-main > .settings-panel")).toHaveAttribute("data-section", "verbindungen");
        // the section's own head with its name stays in the content
        expect(main.querySelector(".settings-panel .part-head")).toHaveTextContent("Verbindungen");
    });

    it("counts the categories from the draft, so the badge follows an unsaved edit", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ categoryIds: ["cat1", "cat2"] }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raidchars" });
        await waitFor(() => expect(within(entry("Kategorien")).getByText("2")).toBeInTheDocument());
        expect(entry("Kategorien")).toHaveAccessibleName("Kategorien · 2 aktive Raid-Kategorien");
    });

    it("remembers a section opened through a link, so the plain menu entry lands there next time", async () => {
        const first = renderPage(<SettingsPage />, { route: "/settings?section=logs" });
        expect(await screen.findByText("Log-Kanäle")).toBeInTheDocument();
        expect(window.localStorage.getItem("eh-settings-section")).toBe("\"logs\"");
        first.unmount();
        renderPage(<SettingsPage />, { route: "/settings" });
        await waitFor(() => expect(entry("Log-Auswertung")).toHaveAttribute("aria-current", "true"));
    });

    it("keeps the page mounted on a pick, so an unsaved draft survives it", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        await user.click(entry("Log-Auswertung"));
        expect(await screen.findByText("Log-Kanäle")).toBeInTheDocument();
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
    });
});

describe("the log channels of the active server (#921)", () => {
    const versions = [{ id: "tbc", label: "TBC Anniversary", short: "TBC" }, { id: "forever", label: "WoW Forever", short: "Forever" }];
    const withLogs = (over: Partial<SettingsData> = {}) => settings({
        config: config({ serverSettings: { g1: { logChannels: [{ channelId: "ch1", versionId: "tbc" }] }, g2: { logChannels: [{ channelId: "x", versionId: "" }] } } }),
        gameVersions: versions,
        ...over,
    });

    it("shows the active server's channels with their version and sends a changed version", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(withLogs());
        renderPage(<SettingsPage />, { route: "/settings?section=logs" });

        const version = await screen.findByRole("combobox", { name: "Spielversion für #raids" });
        expect(version).toHaveValue("tbc");
        // the other server's channel stays out of this page
        expect(screen.queryByText("x")).not.toBeInTheDocument();

        await user.selectOptions(version, "forever");
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({
            logChannels: [{ channelId: "ch1", versionId: "forever" }],
            // the server the page loaded, so a switch in another tab is refused (409)
            serverSettingsGuildId: "g1",
        });
    });

    it("leaves the log channels out when another field is saved, so a switched session cannot overwrite them", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(withLogs());
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect("logChannels" in body).toBe(false);
        // #924: the raid channel is the active server's own value; the active categories always go
        // along (#926) - both with the server the page loaded
        expect(body).toMatchObject({ raidDefaults: { channelId: "ch1" }, categoryIds: ["cat1"], serverSettingsGuildId: "g1" });
    });

    it("says the server was switched when the save is refused for it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(withLogs());
        vi.mocked(api.updateSettings).mockRejectedValue({ code: "server_switched", message: "raw" });
        renderPage(<SettingsPage />, { route: "/settings?section=logs" });
        await user.selectOptions(await screen.findByRole("combobox", { name: "Spielversion für #raids" }), "forever");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText(/in einem anderen Tab gewechselt/)).toBeInTheDocument();
        // the draft stays, nothing was saved
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
    });

    it("removes a channel", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(withLogs());
        renderPage(<SettingsPage />, { route: "/settings?section=logs" });
        await user.click(await screen.findByRole("button", { name: "Kanal entfernen" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].logChannels).toEqual([]);
    });

    it("without an active server shows a hint and sends no log channels", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(withLogs({ activeGuildId: "" }));
        renderPage(<SettingsPage />, { route: "/settings?section=logs" });
        expect(await screen.findByText("Log-Kanäle gelten je Server. Wähle zuerst einen Server aus.")).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: /Spielversion für/ })).not.toBeInTheDocument();

        await user.click(entry("Raid-Standardwerte"));
        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect("logChannels" in vi.mocked(api.updateSettings).mock.calls[0][0]).toBe(false);
        // the categories go to the first server's part then: an empty id lets the server fall back
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].serverSettingsGuildId).toBe("");
    });
});

describe("the sections", () => {
    it("lists the active server's sections under System › Einstellungen and the shared ones under Alle Server (#957)", async () => {
        const first = renderPage(<SettingsPage />, { route: "/settings" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        const labels = () => within(nav()).getAllByRole("button").map((b) => b.querySelector(".srail-text")?.textContent);
        expect(labels()).toEqual(sectionsFor("server", true).map(sectionLabel));
        expect(labels()[0]).toBe("Berechtigungen");
        expect(within(nav()).getAllByText("Server")).toHaveLength(1);
        expect(within(nav()).queryByText("Alle Server")).not.toBeInTheDocument();
        first.unmount();

        renderPage(<SettingsPage scope="all" />, { route: "/settings/all" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        expect(labels()).toEqual(sectionsFor("all", true).map(sectionLabel));
        expect(labels()[0]).toBe("Discord-Server");
        expect(within(nav()).getAllByText("Alle Server")).toHaveLength(1);
        // every section stands on exactly one of the two pages
        expect([...sectionsFor("server", true), ...sectionsFor("all", true)].map((s) => s.id).sort()).toEqual(SETTINGS_SECTIONS.map((s) => s.id).sort());
    });

    it.each([["server" as const, "/settings"], ["all" as const, "/settings/all"]])("opens a panel for every section of the %s page", async (scope, route) => {
        const user = userEvent.setup();
        const { container } = renderPage(<SettingsPage scope={scope} />, { route });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });

        for (const s of sectionsFor(scope, true)) {
            await user.click(entry(sectionLabel(s)));
            await waitFor(() => expect(entry(sectionLabel(s))).toHaveAttribute("aria-current", "true"));
            const panel = container.querySelector(".settings-panel")!;
            expect({ section: s.id, hasPanel: panel.childElementCount > 0 && panel.textContent !== "" }).toEqual({ section: s.id, hasPanel: true });
        }
    });

    it("carries a WoW icon per entry and counts what is missing", async () => {
        const first = renderPage(<SettingsPage scope="all" />, { route: "/settings/all" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        for (const s of sectionsFor("all", true)) {
            expect({ id: s.id, icon: !!entry(sectionLabel(s)).querySelector(`img[src*="/${s.icon}.jpg"]`) }).toEqual({ id: s.id, icon: true });
        }
        // Bot online, but Battle.net, Warcraft Logs, the AI key, the GitHub token (#818) and a loot-sync token missing.
        await waitFor(() => expect(within(entry("Verbindungen")).getByText("5")).toBeInTheDocument());
        expect(entry("Verbindungen")).toHaveAttribute("data-tip-sub", "5 Verbindungen nicht eingerichtet");
        expect(entry("Verbindungen")).toHaveAccessibleName("Verbindungen · 5 Verbindungen nicht eingerichtet");
        first.unmount();

        renderPage(<SettingsPage />, { route: "/settings" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        for (const s of sectionsFor("server", true)) {
            expect({ id: s.id, icon: !!entry(sectionLabel(s)).querySelector(`img[src*="/${s.icon}.jpg"]`) }).toEqual({ id: s.id, icon: true });
        }
        await waitFor(() => expect(within(entry("Kategorien")).getByText("1")).toBeInTheDocument());
        expect(entry("Kategorien")).toHaveAttribute("data-tip-sub", "1 aktive Raid-Kategorien");
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
        expect(entry(sectionLabel(sectionsFor("server", false)[0]))).toHaveAttribute("aria-current", "true");
    });

    it("stays on System › Einstellungen with an old link to a shared section: no redirect to a page it may not open (#957)", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=discordserver" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        expect(screen.queryByText("Panel Discord-Server")).not.toBeInTheDocument();
        expect(entry(sectionLabel(sectionsFor("server", false)[0]))).toHaveAttribute("aria-current", "true");
    });

    it("sees only the Battle.net card among the connections", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=verbindungen" });

        expect(await screen.findByText("Battle.net / Armory")).toBeInTheDocument();
        for (const hidden of ["Discord & Raid-Helper", "Warcraft Logs", "KI-Formulierung", "Loot-Sync"]) {
            expect({ hidden, shown: !!screen.queryByText(hidden) }).toEqual({ hidden, shown: false });
        }
        expect(api.getIngestTokens).not.toHaveBeenCalled();
        expect(within(entry("Verbindungen")).getByText("1")).toBeInTheDocument();
    });

    it("sees every connection card as a full admin", async () => {
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=verbindungen" });
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

    it("sends no untouched access field as a full admin (#925), and never the connection blocks", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body).toMatchObject({ raidDefaults: { channelId: "ch1" } });
        // the active server is per session: an old tab must not write its rights onto another server
        for (const field of ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
        for (const block of ["anthropic", "warcraftlogsV2", "blizzard", "guildId", "raidhelperServerId"]) {
            expect({ block, sent: block in body }).toEqual({ block, sent: false });
        }
        expect(await screen.findByText("Gespeichert.")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument());
    });

    it("shows the server's own bot language, marks the draft dirty on a switch and sends it on save", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ botLanguage: "en", botLanguageOwn: true, botLanguageDefault: "de" }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        expect(await screen.findByRole("switch", { name: "Eigener Wert auf Pulse" })).toBeChecked();

        const group = await screen.findByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(within(group).getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument();

        await user.click(within(group).getByRole("radio", { name: "Deutsch" }));
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        expect(screen.getByText("Bot-Sprache: Deutsch")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ botLanguage: "de", serverSettingsGuildId: "g1" });
    });

    it("shows a server without an own bot language on the default (German when none is sent)", async () => {
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        expect(await screen.findByRole("switch", { name: "Eigener Wert auf Pulse" })).not.toBeChecked();
        expect(screen.queryByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" })).not.toBeInTheDocument();
        expect(screen.getByText("Standard (alle Server)").parentElement).toHaveTextContent("Deutsch");
    });

    it("gives the active server an own bot language through the switch", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ botLanguage: "en", botLanguageDefault: "en", botLanguageOwn: false }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.click(await screen.findByRole("switch", { name: "Eigener Wert auf Pulse" }));
        const group = screen.getByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(within(group).getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
        await user.click(within(group).getByRole("radio", { name: "Deutsch" }));
        expect(screen.getByText("Bot-Sprache: Deutsch")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ botLanguage: "de", serverSettingsGuildId: "g1" });
    });

    it("drops the server's own bot language with \"Standard verwenden\" (sends null)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ botLanguage: "en", botLanguageDefault: "de", botLanguageOwn: true }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.click(await screen.findByRole("button", { name: "Standard verwenden" }));
        expect(screen.getByRole("switch", { name: "Eigener Wert auf Pulse" })).not.toBeChecked();
        expect(screen.getByText("Bot-Sprache: Standard verwenden (Deutsch)")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ botLanguage: null, serverSettingsGuildId: "g1" });
    });

    it("edits the default for all servers without an active server (full admins only)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ activeGuildId: "", config: config({ botLanguage: "de", botLanguageDefault: "de" }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        expect(await screen.findByText(/Standard für alle Server/)).toBeInTheDocument();
        expect(screen.queryByRole("switch", { name: /Eigener Wert/ })).not.toBeInTheDocument();
        await user.click(within(screen.getByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" })).getByRole("radio", { name: "English" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ botLanguage: "en", serverSettingsGuildId: "" });
    });

    it("shows the default read-only to a limited account without an active server", async () => {
        vi.mocked(api.getSettings).mockResolvedValue({ ...limited(), activeGuildId: "" });
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        expect(await screen.findByText("Den Standard ändern nur Voll-Admins.")).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" })).not.toBeInTheDocument();
    });

    it("tells the user to pick a server first when the save answers no_active_server", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ activeGuildId: "" }));
        vi.mocked(api.updateSettings).mockRejectedValue(Object.assign(new Error("no_active_server"), { code: "no_active_server" }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText(/Bitte erst oben einen Server wählen/)).toBeInTheDocument();
    });

    it("shows the picture switches of the bot messages (on unless saved off) and sends them on save", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ discordVisuals: { setupImage: false } }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        const strip = await screen.findByRole("switch", { name: "Raid-Übersicht mit Wochenleiste" });
        expect(strip).toBeChecked();
        expect(screen.getByRole("switch", { name: "Setup als Grafik" })).not.toBeChecked();
        expect(screen.getByRole("switch", { name: "Titelbild des Discord-Events" })).toBeChecked();

        await user.click(strip);
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();
        expect(screen.getByText("Bilder in Bot-Nachrichten · Raid-Übersicht mit Wochenleiste aus")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({
            discordVisuals: { overviewWeekStrip: false, setupImage: false, eventCover: true },
        });
        // #924: the per-server fields only go out when changed, so another server's values stay untouched
        // (serverSettingsGuildId always goes along with the categories, #926)
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        for (const field of ["raidDefaults", "botLanguage", "officerRoleId", "applicationChannelId"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
    });

    it("names the picture switches in English", async () => {
        await switchLang("en");
        try {
            renderPage(<SettingsPage />, { route: "/settings?section=raids" });
            expect(await screen.findByRole("switch", { name: "Setup as a graphic" })).toBeChecked();
            expect(screen.getByText("Pictures in bot messages")).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });

    it("edits the full admin roles under Alle Server and sends only that field (#925)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({
            adminRoles: [{ id: "r1", name: "Offizier", guildId: "g1", guildName: "Pulse" }, { id: "r9", name: "Leitung", guildId: "g2", guildName: "PuGs" }],
        }));
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=vollAdmins" });

        const table = await screen.findByRole("table");
        expect(within(table).getByText("@Offizier")).toBeInTheDocument();
        expect(within(table).getByText("Pulse")).toBeInTheDocument();
        await user.click(within(table).getByRole("button", { name: "@Offizier entfernen" }));
        expect(screen.getByText("Noch keine Admin-Rolle eingetragen.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body.adminRoleIds).toEqual([]);
        for (const field of ["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
    });

    it("hides the full admin section from a limited settings user", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        await screen.findByRole("combobox", { name: "Standard-Kanal" });
        expect(within(nav()).queryByRole("button", { name: /^Voll-Admins/ })).not.toBeInTheDocument();
    });

    it("leaves the access fields out for a limited settings user, whom the server would refuse", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(limited());
        renderPage(<SettingsPage />, { route: "/settings?section=raids" });

        await user.selectOptions(await screen.findByRole("combobox", { name: "Standard-Kanal" }), "ch1");
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        // #957: neither what every server shares - the API wants a full admin for those
        for (const field of ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "blizzard", "mainVersion", "hideOtherVersions", "versionSettings", "dungeonRecords"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
        expect(body.raidDefaults).toEqual({ channelId: "ch1" });
        // the server's own values still go along
        expect(body).toHaveProperty("categoryVersion");
        expect(body).toHaveProperty("topItems");
    });

    it("sends what every server shares only from Alle Server › Einstellungen (#957)", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=dungeons" });
        await user.click(await screen.findByRole("switch", { name: /Gildenrekorde/ }));
        // the head names the page it is on, not System › Einstellungen
        expect(screen.getByText(/^Alle Server › Module/)).toBeInTheDocument();
        expect(screen.queryByText(/^Einstellungen › /)).toBeNull();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        for (const field of ["mainVersion", "hideOtherVersions", "versionSettings", "dungeonRecords"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: true });
        }
        expect(body.dungeonRecords).toMatchObject({ post: true });
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

    it("shows what deactivating a category pauses before the save goes out (#744)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ categoryIds: ["cat1", "cat2"] }) }));
        vi.mocked(api.getCategoryDeactivate).mockResolvedValue({
            categories: [{ categoryId: "cat1", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: false, upcoming: 0 }], emptyBlocked: false,
        });
        vi.mocked(api.updateSettings).mockImplementation(async (partial) => ({
            config: { ...config(), ...partial } as AdminConfig,
            deactivatedCategories: [{ categoryId: "cat1", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: false, upcoming: 0 }],
        }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });

        await user.click(await screen.findByRole("button", { name: "Montag umschalten" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText("Serie (Mo 19:30) pausiert – legt keine Events an")).toBeInTheDocument();
        // the preview names the server the page loaded (#926)
        expect(api.getCategoryDeactivate).toHaveBeenCalledWith(["cat2"], "g1");
        expect(api.updateSettings).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Deaktivieren und speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].categoryIds).toEqual(["cat2"]);
        expect(await screen.findByText("Montag: deaktiviert – Serie und Erinnerungen pausieren")).toBeInTheDocument();
    });

    it("saves a newly switched-on category without a dialog", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ config: config({ categoryIds: [] }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });
        await user.click(await screen.findByRole("button", { name: "Montag umschalten" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(api.getCategoryDeactivate).not.toHaveBeenCalled();
    });

    it("closes a category deleted in Discord, only without unsaved changes (#744)", async () => {
        const user = userEvent.setup();
        const gone: api.MissingCategory = {
            categoryId: "gone", name: "TBC Montag", active: true, series: null, reminders: true, settings: ["categoryReminders"],
            councilProfile: false, kaders: [], rosters: [], upcoming: 0,
        };
        vi.mocked(api.getSettings).mockResolvedValue(settings({ missingCategories: [gone], config: config({ categoryIds: ["cat1", "gone"] }) }));
        vi.mocked(api.closeCategory).mockResolvedValue({
            ok: true, name: "TBC Montag", removed: { series: false, reminders: true, settings: [], active: true, councilProfile: false, kaders: 0 },
            rosters: [], config: config({ categoryIds: ["cat1"] }), missingCategories: [],
        });
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });

        const close = await screen.findByRole("button", { name: "TBC Montag abschließen …" });
        // an unsaved change first has to be saved or thrown away
        await user.click(screen.getByRole("button", { name: "Sheet-URL leeren" }));
        expect(close).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Verwerfen" }));
        expect(close).toBeEnabled();

        await user.click(close);
        expect(screen.getByText("Die Erinnerungen werden entfernt.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Abschließen" }));
        expect(api.closeCategory).toHaveBeenCalledWith("gone");
        expect(await screen.findByText("TBC Montag abgeschlossen")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "TBC Montag abschließen …" })).not.toBeInTheDocument();
        expect(api.updateSettings).not.toHaveBeenCalled();
    });

    it("sends the picked planning and names it in the save bar", async () => {
        const user = userEvent.setup();
        renderPage(<SettingsPage />, { route: "/settings?section=kategorien" });

        await user.click(await screen.findByRole("button", { name: "Mittwoch mit Raidplan" }));
        // cat2 had a fixed sheet, so it planned with the sheet until now
        expect(screen.getByText(/Mittwoch · Planung → Raidplan/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].categoryPlanning).toEqual({ cat2: "raidplan" });
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

describe("two pages: System › Einstellungen and Alle Server › Einstellungen (#957)", () => {
    function Where() {
        const loc = useLocation();
        return <output data-testid="where">{loc.pathname + loc.search}</output>;
    }

    /** Both routes like App.tsx, so a redirect lands on the other page. */
    function renderBoth(route: string) {
        return render(
            <JobsProvider>
                <ConfirmProvider>
                    <MemoryRouter initialEntries={[route]}>
                        <Where />
                        <Routes>
                            <Route element={<Outlet context={{ user: adminUser() }} />}>
                                <Route path="settings" element={<SettingsPage />} />
                                <Route path="settings/all" element={<SettingsPage scope="all" />} />
                            </Route>
                        </Routes>
                    </MemoryRouter>
                </ConfirmProvider>
            </JobsProvider>,
        );
    }

    it("names the active server in the head of System › Einstellungen", async () => {
        renderPage(<SettingsPage />, { route: "/settings" });
        expect(await screen.findByText("System · Pulse")).toBeInTheDocument();
    });

    it("says when no server is chosen", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(settings({ bot: { online: true, readySince: 0, guildName: "" }, activeGuildId: "" }));
        renderPage(<SettingsPage />, { route: "/settings" });
        expect(await screen.findByText("System · kein Server gewählt")).toBeInTheDocument();
    });

    it("heads the shared page with Alle Server instead of a server", async () => {
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all" });
        await screen.findByRole("navigation", { name: "Einstellungs-Bereiche" });
        expect(document.querySelector(".settings-head .kicker")).toHaveTextContent("Alle Server");
        expect(screen.queryByText("System · Pulse")).not.toBeInTheDocument();
    });

    it.each([
        ["/settings?section=discordserver", "/settings/all?section=discordserver", "Panel Discord-Server"],
        // an old id of a connection card lands in Verbindungen on the shared page
        ["/settings?section=battlenet", "/settings/all?section=battlenet", "Battle.net / Armory"],
        // and a server section opened on the shared page goes back to System
        ["/settings/all?section=kategorien", "/settings?section=kategorien", "Panel Kategorien"],
    ])("sends the old link %s to %s", async (from, to, shown) => {
        renderBoth(from);
        expect(await screen.findByText(shown)).toBeInTheDocument();
        expect(screen.getByTestId("where")).toHaveTextContent(to);
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("names the page, the sections, the connection cards and the save bar in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        const shared = renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=verbindungen" });
        const allNav = await screen.findByRole("navigation", { name: "Settings sections" });
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
        expect(within(allNav).getByText("All servers")).toBeInTheDocument();
        expect(await screen.findByText("AI wording")).toBeInTheDocument();
        expect(screen.getAllByText("Full admins only").length).toBeGreaterThan(0);
        shared.unmount();

        renderPage(<SettingsPage />, { route: "/settings?section=raids" });
        const nav = await screen.findByRole("navigation", { name: "Settings sections" });
        expect(within(nav).getByRole("button", { name: /^Permissions/ })).toBeInTheDocument();
        expect(screen.getByText("System · Pulse")).toBeInTheDocument();

        await user.click(within(nav).getByRole("button", { name: /^Raid defaults/ }));
        await user.selectOptions(await screen.findByRole("combobox", { name: "Default channel" }), "ch1");
        expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    });
});

describe("Spielversion (#541)", () => {
    afterEach(() => switchLang("de"));

    const gameVersions = [
        { id: "tbc", label: "TBC Anniversary", short: "TBC" },
        { id: "classic", label: "Classic Era", short: "Classic" },
        { id: "forever", label: "WoW Forever", short: "Forever" },
    ];

    const preview = (over: Partial<api.CategorySwitchPreview> = {}): api.CategorySwitchPreview => ({
        categoryId: "cat1", name: "Montag",
        from: { id: "tbc", label: "TBC Anniversary", short: "TBC" }, to: { id: "forever", label: "WoW Forever", short: "Forever" },
        switching: true, eras: [{ versionId: "tbc", from: 0, name: "" }],
        upcoming: [{ id: "eh-1", title: "Karazhan", startTime: 1_800_000_000, versionId: "tbc", source: "eventhelper" }],
        series: { enabled: true, usesDefault: false, template: { id: "t-tbc", name: "SSC + TK", versionId: "tbc" }, fits: false },
        defaultTemplate: { id: "t-tbc", name: "SSC + TK", versionId: "tbc", fits: false },
        templates: [{ id: "t-fe", name: "Onyxia 40" }],
        ...over,
    });

    it("switches the main version without moving a category, which keeps its fixed version (#738)", async () => {
        const user = userEvent.setup();
        // stored before the migration: the active category has no entry, it plays the saved main version
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions }));
        const first = renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion" });
        // only the active category gets a row, with its own version and no "Hauptversion" choice
        const montag = await screen.findByRole("combobox", { name: "Spielversion von Montag" });
        expect(montag).toHaveValue("tbc");
        expect(within(montag).queryByRole("option", { name: /Hauptversion/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Spielversion von Mittwoch" })).not.toBeInTheDocument();
        first.unmount();

        // the main version is shared: Alle Server, and that save leaves the categories alone
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=spielversion" });
        const main = await screen.findByRole("radiogroup", { name: "Hauptversion" });
        expect(within(main).getByRole("radio", { name: "TBC" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByRole("combobox", { name: "Spielversion von Montag" })).not.toBeInTheDocument();
        await user.click(within(main).getByRole("radio", { name: "Forever" }));
        expect(screen.getByText("1 ungespeicherte Änderung")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body).toMatchObject({ mainVersion: "forever" });
        expect("categoryVersion" in body).toBe(false);
        expect(api.getCategorySwitch).not.toHaveBeenCalled();
    });

    it("asks before switching a category: the dialog lists what happens and the fixes go with the save (#738)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions, config: config({ categoryVersion: { cat1: "tbc" }, categoryRaidTemplate: { cat1: "t-tbc" } }) }));
        vi.mocked(api.getCategorySwitch).mockResolvedValue(preview());
        vi.mocked(api.updateSettings).mockImplementation(async (partial) => ({
            config: { ...config(), ...partial } as AdminConfig,
            switchedCategories: [{ categoryId: "cat1", fromVersion: "tbc", toVersion: "forever", at: 1, name: "Montag", series: "template" }],
        }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion" });

        const montag = await screen.findByRole("combobox", { name: "Spielversion von Montag" });
        await user.selectOptions(montag, "forever");
        expect(api.getCategorySwitch).toHaveBeenCalledWith("cat1", "forever");
        expect(await screen.findByText("Montag: TBC Anniversary → WoW Forever")).toBeInTheDocument();
        expect(screen.getByText(/Bisherige Raids, Roster und Quote bleiben als TBC lesbar/)).toBeInTheDocument();
        expect(screen.getByText(/neue Raids als Forever angelegt/)).toBeInTheDocument();
        expect(screen.getByText("1 kommender Raid behält seine Version. Die Orga kann ihn absagen.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Karazhan" })).toHaveAttribute("href", "/raids/detail?event=eh-1");
        // nothing changes before the confirmation
        expect(montag).toHaveValue("tbc");

        await user.selectOptions(screen.getByRole("combobox", { name: "Serie" }), "t-fe");
        await user.selectOptions(screen.getByRole("combobox", { name: "Standard-Vorlage" }), "t-fe");
        await user.click(screen.getByRole("button", { name: "Auf Forever umstellen" }));
        expect(montag).toHaveValue("forever");

        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({
            categoryVersion: { cat1: "forever" },
            categorySwitchFixes: { cat1: { series: "t-fe" } },
            categoryRaidTemplate: { cat1: "t-fe" },
        });
        expect(await screen.findByText("Montag: neuer Abschnitt mit Forever")).toBeInTheDocument();
    });

    it("pauses the series by default, and cancelling or going back leaves nothing behind (#738)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions, config: config({ categoryVersion: { cat1: "tbc" }, categoryRaidTemplate: { cat1: "t-tbc" } }) }));
        vi.mocked(api.getCategorySwitch).mockResolvedValue(preview({ upcoming: [] }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion" });

        const montag = await screen.findByRole("combobox", { name: "Spielversion von Montag" });
        await user.selectOptions(montag, "forever");
        expect(await screen.findByText("Keine kommenden Raids in einer anderen Version.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Abbrechen" }));
        expect(montag).toHaveValue("tbc");
        expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument();

        await user.selectOptions(montag, "forever");
        await user.click(await screen.findByRole("button", { name: "Auf Forever umstellen" }));
        expect(montag).toHaveValue("forever");
        // back to the saved version: no dialog, the choices are gone
        await user.selectOptions(montag, "tbc");
        expect(api.getCategorySwitch).toHaveBeenCalledTimes(2);
        expect(screen.queryByText(/ungespeicherte/)).not.toBeInTheDocument();

        await user.selectOptions(montag, "forever");
        await user.click(await screen.findByRole("button", { name: "Auf Forever umstellen" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({
            categoryVersion: { cat1: "forever" }, categorySwitchFixes: { cat1: { series: "pause" } }, categoryRaidTemplate: {},
        });
    });

    it("says where to switch a category on when none is active", async () => {
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions, config: config({ categoryIds: [] }) }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion" });
        expect(await screen.findByText(/Noch keine aktive Kategorie/)).toBeInTheDocument();
    });

    it("names the section in English", async () => {
        await switchLang("en");
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions }));
        const first = renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=spielversion" });
        expect(await screen.findByRole("radiogroup", { name: "Main version" })).toBeInTheDocument();
        first.unmount();
        renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion" });
        expect(await screen.findByRole("combobox", { name: /Montag/ })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "WoW Forever" })).toBeInTheDocument();
        const rail = screen.getByRole("navigation", { name: "Settings sections" });
        expect(within(rail).getByRole("button", { name: /^Game version per category/ })).toHaveAttribute("aria-current", "true");
    });

    // #957 review: the category versions are the server's - a settings writer who is no
    // full admin switches them on System › Einstellungen, the main version stays shared
    it("lets a settings writer who is no full admin switch a category's version on the server page", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue({ ...limited(), gameVersions } as Awaited<ReturnType<typeof api.getSettings>>);
        vi.mocked(api.getCategorySwitch).mockResolvedValue(preview({ upcoming: [] }));
        renderPage(<SettingsPage />, { route: "/settings?section=kategorieversion", user: adminUser({ isAdmin: false, access: { settings: { read: true, write: true } } }) });

        const montag = await screen.findByRole("combobox", { name: "Spielversion von Montag" });
        expect(screen.queryByRole("radiogroup", { name: "Hauptversion" })).not.toBeInTheDocument();
        await user.selectOptions(montag, "forever");
        await user.click(await screen.findByRole("button", { name: "Auf Forever umstellen" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body).toMatchObject({ categoryVersion: { cat1: "forever" }, serverSettingsGuildId: expect.any(String) });
        for (const field of ["mainVersion", "hideOtherVersions", "versionSettings", "dungeonRecords", "adminRoleIds"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
    });

    it("sends only the shared keys from Alle Server: no server keys, no server id (#957 review)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSettings).mockResolvedValue(settings({ gameVersions }));
        renderPage(<SettingsPage scope="all" />, { route: "/settings/all?section=spielversion" });
        await user.click(within(await screen.findByRole("radiogroup", { name: "Hauptversion" })).getByRole("radio", { name: "Forever" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
        const body = vi.mocked(api.updateSettings).mock.calls[0][0];
        expect(body.mainVersion).toBe("forever");
        for (const field of ["serverSettingsGuildId", "categoryIds", "categoryVersion", "categorySwitchFixes", "raidDefaults", "logChannels", "topItems", "rolePermissions", "botLanguage"]) {
            expect({ field, sent: field in body }).toEqual({ field, sent: false });
        }
    });
});
