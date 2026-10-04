// The sidebar (components/Shell.tsx) draws the one shared menu
// (src/config/menu.json via lib/menu.ts): every entry the account may open as a
// link with its WoW icon, grouped under its heading, and the logout always in
// the foot (#435: formerly source scans in test/web-client/menuAccess.test.js).
//
// Entries with children fold them out under a chevron: Raid-Events its raid
// plan pages, Einstellungen the sections of the settings page (with the groups
// and badges the page's column used to show). The group of the current page
// opens by itself, every other one stays as the chevron last left it.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { AdminConfig, SessionUser, SettingsData } from "../api";
import { t, tOr } from "../i18n";
import { MENU } from "../lib/menu";
import { SETTINGS_SECTIONS, sectionLabel, visibleSections } from "../lib/settingsSections";
import { publishSettingsNav, resetSettingsNav } from "../lib/settingsNav";
import { adminUser, renderPage } from "../test/render";
import Shell from "./Shell";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getVersion: vi.fn(),
    getSettings: vi.fn(),
    getIngestTokens: vi.fn(),
}));

function settingsData(): SettingsData {
    const config = {
        adminRoleIds: [], rolePermissions: {}, baseAccess: {}, userPermissions: {},
        guildId: "g1", raidhelperServerId: "", officerRoleId: "", applicationChannelId: "",
        highestBidsChannelId: "", highestBidsMessageId: "",
        categoryIds: ["cat1", "cat2"], categoryRoles: {}, logChannelIds: [], raidDefaults: { channelId: "" },
        categoryRaidTemplate: {}, blizzard: { clientId: "", region: "eu", realmSlug: "thunderstrike", namespace: "" },
        categoryLootTool: {}, categorySheets: {}, topItems: [],
    } as AdminConfig;
    return {
        config, canManageAccess: true, areas: [], raidsheets: [], roles: [], categories: [], channels: [],
        bot: { online: true, readySince: 0, guildName: "Pulse" },
        servers: { events: [], talk: null },
        activeGuildId: "g1",
    };
}

beforeEach(() => {
    window.localStorage.clear();
    resetSettingsNav();
    vi.mocked(api.getVersion).mockReturnValue(new Promise(() => undefined));
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(settingsData());
    vi.mocked(api.getIngestTokens).mockReset().mockResolvedValue({ tokens: [] });
});

function showShell(user: SessionUser, route = "/") {
    return renderPage(<Shell user={user} guilds={[]} activeGuildId="" />, { user, route });
}

const nav = () => screen.getByRole("navigation");
const hrefs = () => within(nav()).getAllByRole("link").map((a) => a.getAttribute("href"));
const chevron = (name: string) => within(nav()).getByRole("button", { name: new RegExp(`^Unterpunkte von ${name} `) });
const entry = (name: string) => within(nav()).getByRole("link", { name });
const settingsKids = () => within(document.getElementById("nav-kids-settings")!);

describe("the sidebar", () => {
    it("is rendered from the shared menu file, every entry with its WoW icon", () => {
        showShell(adminUser());
        // the children stay folded away on the start page
        expect(hrefs()).toEqual(MENU.filter((e) => !e.sub).map((e) => e.href));
        for (const e of MENU.filter((m) => !m.sub)) {
            const link = entry(tOr(`shell.menu.${e.id}`, e.label));
            expect(link).toHaveAttribute("href", e.href);
            expect(link.querySelector("img")?.getAttribute("src")).toContain(e.wowIcon);
        }
    });

    it("prints each group heading once, above its entries", () => {
        showShell(adminUser());
        const groups = [...new Set(MENU.map((e) => e.group))];
        for (const group of groups) expect(within(nav()).getAllByText(tOr(`shell.group.${group}`, group))).toHaveLength(1);
    });

    it("shows only the entries the account's areas open", () => {
        showShell({ id: "u5", name: "Rai", isAdmin: false, access: { raids: { read: true, write: false }, loot: { read: true, write: false } } });
        // the raid plan's pages are their own area ("raidplan"), not a part of the raid events
        expect(hrefs()).toEqual(["/raids", "/history"]);
        expect(within(nav()).queryByRole("button")).not.toBeInTheDocument();
    });

    it("puts the logout in the foot for every account, as a plain link to the server", () => {
        for (const user of [adminUser(), { id: "u2", name: "Mia", isAdmin: false, access: {} }]) {
            const view = showShell(user);
            const logout = screen.getByRole("link", { name: t("shell.logout") });
            expect(logout).toHaveAttribute("href", "/auth/logout");
            expect(logout).toHaveAttribute("data-tip", t("shell.logout"));
            view.unmount();
        }
    });
});

describe("the groups that fold out", () => {
    const planner = { id: "u6", name: "Tak", isAdmin: false, access: { raids: { read: true, write: false }, raidplan: { read: true, write: true } } } as SessionUser;

    it("puts a chevron on Raid-Events and Einstellungen only, both closed away from their pages", () => {
        showShell(adminUser());
        const chevrons = within(nav()).getAllByRole("button");
        expect(chevrons.map((b) => b.getAttribute("aria-label"))).toEqual([
            "Unterpunkte von Raid-Events ausklappen",
            "Unterpunkte von Einstellungen ausklappen",
        ]);
        for (const b of chevrons) {
            expect(b).toHaveAttribute("aria-expanded", "false");
            expect(document.getElementById(b.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
        }
    });

    it("opens the group of the current page by itself and marks the parent as holding it", () => {
        showShell(planner, "/raids/plan-templates");
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "true");
        expect(hrefs()).toEqual(["/raids", "/raids/plan-templates", "/raids/plan-catalog"]);
        const kid = entry("Raidplan-Vorlagen");
        expect(kid).toHaveClass("nav-kid", "active");
        expect(kid).toHaveAttribute("aria-current", "page");
        expect(entry("Raidplan-Katalog")).not.toHaveClass("active");
        // the parent holds the open page, it is not the open page
        expect(entry("Raid-Events")).toHaveClass("has-active");
        expect(entry("Raid-Events")).not.toHaveClass("active");
    });

    it("fills the parent itself on its own page and on a page under it that is no child", () => {
        const view = showShell(planner, "/raids");
        expect(entry("Raid-Events")).toHaveClass("active");
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "true");
        view.unmount();
        showShell(planner, "/raids/new");
        expect(entry("Raid-Events")).toHaveClass("active");
        expect(entry("Raid-Events")).not.toHaveClass("has-active");
    });

    it("draws the raid plan's pages as plain entries when Raid-Events is not shown", () => {
        showShell({ id: "u7", name: "Tik", isAdmin: false, access: { raidplan: { read: true, write: false } } });
        expect(hrefs()).toEqual(["/raids/plan-templates", "/raids/plan-catalog"]);
        expect(within(nav()).queryByRole("button")).not.toBeInTheDocument();
        expect(entry("Raidplan-Vorlagen")).toHaveClass("nav-item");
    });

    it("toggles a group with the chevron, by mouse and keyboard, and remembers it in this browser", async () => {
        const user = userEvent.setup();
        const view = showShell(adminUser());
        await user.click(chevron("Raid-Events"));
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "true");
        expect(chevron("Raid-Events")).toHaveAccessibleName("Unterpunkte von Raid-Events einklappen");
        expect(hrefs()).toContain("/raids/plan-catalog");
        expect(JSON.parse(window.localStorage.getItem("eh-menu-groups") || "{}")).toEqual({ raids: true });

        chevron("Einstellungen").focus();
        await user.keyboard("{Enter}");
        expect(chevron("Einstellungen")).toHaveAttribute("aria-expanded", "true");
        await user.keyboard(" ");
        expect(chevron("Einstellungen")).toHaveAttribute("aria-expanded", "false");

        view.unmount();
        showShell(adminUser());
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "true");
        expect(chevron("Einstellungen")).toHaveAttribute("aria-expanded", "false");
    });

    it("can fold the current group away, and opens it again on entering its page", async () => {
        const user = userEvent.setup();
        window.localStorage.setItem("eh-menu-groups", JSON.stringify({ raids: false }));
        showShell(planner, "/raids/plan-catalog");
        // entering the group's page overrides the folded state stored before
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "true");
        await user.click(chevron("Raid-Events"));
        expect(chevron("Raid-Events")).toHaveAttribute("aria-expanded", "false");
        expect(hrefs()).toEqual(["/raids"]);
    });
});

describe("the settings sections in the menu", () => {
    it("lists every section under its group heading, linking to the page's section", async () => {
        const user = userEvent.setup();
        showShell(adminUser());
        await user.click(chevron("Einstellungen"));
        expect(settingsKids().getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(SETTINGS_SECTIONS.map((s) => `/settings?section=${s.id}`));
        for (const s of SETTINGS_SECTIONS) {
            const link = settingsKids().getByRole("link", { name: new RegExp(`^${sectionLabel(s)}`) });
            expect({ id: s.id, icon: !!link.querySelector(`img[src*="/${s.icon}.jpg"]`) }).toEqual({ id: s.id, icon: true });
        }
        for (const group of ["Zugang", "Verbindungen", "Raid-Kategorien", "Module"]) {
            expect({ group, count: settingsKids().getAllByText(group, { selector: ".nav-kid-label" }).length }).toEqual({ group, count: 1 });
        }
    });

    it("leaves out the full-admin sections for a settings user who is no admin", async () => {
        const user = userEvent.setup();
        showShell({ id: "u8", name: "Set", isAdmin: false, access: { settings: { read: true, write: true } } });
        await user.click(chevron("Einstellungen"));
        const links = settingsKids().getAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(visibleSections(false).map((s) => `/settings?section=${s.id}`));
        expect(links.some((a) => a.textContent?.startsWith("Berechtigungen"))).toBe(false);
        // no access tokens asked for without the right to see them
        await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
        expect(api.getIngestTokens).not.toHaveBeenCalled();
    });

    it("opens on the settings page with the linked section active and the parent holding it", () => {
        showShell(adminUser(), "/settings?section=raidchars");
        expect(chevron("Einstellungen")).toHaveAttribute("aria-expanded", "true");
        // an old id lands on the section that holds the setting now
        expect(within(nav()).getByRole("link", { current: "page" })).toHaveAttribute("href", "/settings?section=kategorien");
        expect(entry("Einstellungen")).toHaveClass("has-active");
        // the page itself publishes the counts there
        expect(api.getSettings).not.toHaveBeenCalled();
    });

    it("follows the section and the counts the settings page publishes", () => {
        showShell(adminUser(), "/settings");
        act(() => publishSettingsNav({ active: "verbindungen", counts: { verbindungen: 3, discordserver: 0, kategorien: 2 } }));
        expect(within(nav()).getByRole("link", { current: "page" })).toHaveAttribute("href", "/settings?section=verbindungen");
        expect(within(settingsKids().getByRole("link", { name: /^Verbindungen/ })).getByText("3")).toHaveAttribute("data-tip", "3 Verbindungen nicht eingerichtet");
        expect(within(settingsKids().getByRole("link", { name: /^Kategorien/ })).getByText("2")).toHaveAttribute("data-tip", "2 aktive Raid-Kategorien");
        // a zero is no badge
        expect(settingsKids().getByRole("link", { name: /^Discord-Server/ }).querySelector(".badge")).toBeNull();
    });

    it("loads the counts itself once when the group is opened on another page", async () => {
        const user = userEvent.setup();
        showShell(adminUser(), "/signups");
        expect(api.getSettings).not.toHaveBeenCalled();
        await user.click(chevron("Einstellungen"));
        // Bot online, but Battle.net, Warcraft Logs, the AI key and a loot-sync token missing.
        await waitFor(() => expect(within(settingsKids().getByRole("link", { name: /^Verbindungen/ })).getByText("4")).toBeInTheDocument());
        expect(within(settingsKids().getByRole("link", { name: /^Kategorien/ })).getByText("2")).toBeInTheDocument();
        await user.click(chevron("Einstellungen"));
        await user.click(chevron("Einstellungen"));
        expect(api.getSettings).toHaveBeenCalledTimes(1);
        expect(api.getIngestTokens).toHaveBeenCalledTimes(1);
    });
});
