// The start page "Übersicht" (design issue #220): one question per page —
// what is coming up, and what is open? The next raid beside the open tasks,
// one tile per area, the latest top-item awards beside the last raids.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { DashboardData, DashboardRaid, DashboardTask, NextRaidDetails } from "../api";
import { t } from "../i18n";
import { renderPage } from "../test/render";
import DashboardPage from "./DashboardPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getDashboard: vi.fn(),
    getNextRaidDetails: vi.fn(),
}));

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

function raid(over: Partial<DashboardRaid> = {}): DashboardRaid {
    return {
        id: "1400",
        title: "Black Temple",
        startTime: now + 2 * DAY,
        channelId: "c1",
        channelName: "bt-donnerstag",
        categoryId: "cat1",
        icon: "achievement_boss_illidan",
        size: 25,
        signupCount: 20,
        setupCount: 0,
        roles: [{ key: "tank", label: "Tank", icon: "ability_warrior_defensivestance", filled: 2, target: 3 }],
        sheet: null,
        softres: null,
        ...over,
    };
}

function task(over: Partial<DashboardTask> = {}): DashboardTask {
    return {
        id: "logs",
        tone: "mid",
        icon: "inv_misc_pocketwatch_01",
        title: "Logs zuordnen",
        ref: { text: "2 Logs ohne Raid" },
        count: 2,
        href: "/cla",
        tip: "Logs warten auf einen Raid",
        tipSub: "Auf der Seite des Raids zuordnen.",
        ...over,
    };
}

function dashboard(over: Partial<DashboardData> = {}): DashboardData {
    return {
        kicker: { guild: "Pulse", realm: "Thunderstrike" },
        nextRaid: raid(),
        followingRaid: null,
        nextRaidError: null,
        tasks: [],
        areas: {
            lastReport: null,
            newLoot: { count: 0, since: 0 },
            recruitment: { posts: 0 },
            roster: { total: 40, withoutDiscord: 0 },
        },
        recentEvents: { events: [], error: null },
        topLoot: { items: [], configured: 0 },
        activeGuildId: "g1",
        ...over,
    };
}

function details(over: Partial<NextRaidDetails> = {}): NextRaidDetails {
    return {
        ...raid(),
        classes: [],
        notSignedUp: [],
        rolesConfigured: true,
        membersError: null,
        fetchedAt: Date.now(),
        ...over,
    };
}

async function showPage(data: DashboardData) {
    vi.mocked(api.getDashboard).mockResolvedValue(data);
    const view = renderPage(<DashboardPage />);
    await screen.findByText(t("dashboard.page.title"));
    return view;
}

beforeEach(() => {
    vi.mocked(api.getDashboard).mockReset();
    vi.mocked(api.getNextRaidDetails).mockReset();
});

describe("Übersicht (DashboardPage)", () => {
    it("is built from next raid, tasks, area tiles, loot and last raids, in that order", async () => {
        await showPage(dashboard());
        const parts = [
            t("dashboard.next.title"),
            t("dashboard.tasks.title"),
            t("dashboard.areas.lastReport"),
            t("dashboard.areas.newLoot"),
            t("dashboard.areas.recruitment"),
            t("dashboard.areas.roster"),
            t("dashboard.loot.title"),
            t("dashboard.recent.title"),
        ].map((text) => screen.getByText(text));
        for (let i = 1; i < parts.length; i++) {
            expect(parts[i - 1].compareDocumentPosition(parts[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        expect(screen.getByText("Pulse · Thunderstrike", { exact: false })).toBeInTheDocument();
    });

    it("offers a new raid event with a WoW icon, no line icon", async () => {
        await showPage(dashboard());
        const link = screen.getByRole("link", { name: t("dashboard.page.newRaid") });
        expect(link).toHaveAttribute("href", "/raids/new");
        expect(link.querySelector("img")?.getAttribute("src")).toContain("inv_misc_note_02");
        expect(link.querySelector("svg")).toBeNull();
    });

    it("shows 'Alles erledigt' when there are no open tasks", async () => {
        await showPage(dashboard({ tasks: [] }));
        expect(screen.getByText("Alles erledigt")).toBe(screen.getByText(t("dashboard.tasks.allDone")));
        expect(screen.getByText(t("dashboard.tasks.allDoneNote"))).toBeInTheDocument();
    });

    it("renders exactly the tasks the server sent, each explained in its tooltip", async () => {
        const tasks = [
            task(),
            task({ id: "sheet", tone: "bad", title: "Sheet füllen", ref: { title: "Karazhan" }, count: 0, href: "/raids/detail?event=9", tip: "Das Sheet fehlt", tipSub: "Aus dem Setup füllen." }),
        ];
        await showPage(dashboard({ tasks }));
        expect(screen.queryByText(t("dashboard.tasks.allDone"))).not.toBeInTheDocument();

        const logs = screen.getByText("Logs zuordnen").closest("a")!;
        expect(logs).toHaveAttribute("href", "/cla");
        expect(logs).toHaveAttribute("data-tip", "Logs warten auf einen Raid");
        expect(logs).toHaveAttribute("data-tip-sub", "Auf der Seite des Raids zuordnen.");
        expect(within(logs).getByText("2 Logs ohne Raid")).toBeInTheDocument();
        // the count badge only where there is a count
        expect(within(logs).getByText("2")).toBeInTheDocument();

        const sheet = screen.getByText("Sheet füllen").closest("a")!;
        expect(sheet).toHaveAttribute("href", "/raids/detail?event=9");
        expect(sheet).toHaveAttribute("data-tip", "Das Sheet fehlt");
        expect(within(sheet).queryByText("0")).not.toBeInTheDocument();

        // the head counts the tasks; no rows beyond the two sent
        expect(screen.queryByText("Addon-Inbox", { exact: false })).not.toBeInTheDocument();
        expect(screen.queryByText("Empfehlungen prüfen", { exact: false })).not.toBeInTheDocument();
    });

    it("links the next raid straight to its page: the title and an 'Öffnen' beside 'Details'", async () => {
        await showPage(dashboard({ nextRaid: raid({ id: "14 00" }) }));
        const href = "/raids/detail?event=14%2000";
        expect(screen.getByRole("link", { name: "Black Temple" })).toHaveAttribute("href", href);
        const open = screen.getByRole("link", { name: "Öffnen" });
        expect(open).toHaveAttribute("href", href);
        expect(open).toHaveAttribute("data-tip", t("dashboard.next.openTip"));
        expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });

    it("says 'Softres fehlt' for a softres raid without a list", async () => {
        await showPage(dashboard({ nextRaid: raid({ softres: null }) }));
        expect(screen.getByText("Softres fehlt")).toHaveAttribute("data-tip", t("dashboard.lootBadge.softresMissingTip"));
    });

    it("names the loot system instead of 'Softres fehlt' when the raid has no softres list", async () => {
        const lootSystem = {
            system: "lootcouncil" as const, label: "Loot-Council", source: "category" as const,
            categorySystem: "lootcouncil" as const, categoryLabel: "Loot-Council", softresExtra: false, softres: false,
        };
        await showPage(dashboard({ nextRaid: raid({ softres: null, lootSystem }) }));
        expect(screen.queryByText(t("dashboard.lootBadge.softresMissing"))).not.toBeInTheDocument();
        expect(screen.getByText("Loot-Council")).toHaveAttribute("data-tip", t("dashboard.lootBadge.systemTip", { label: "Loot-Council" }));
    });

    it("uses the tooltip box, never a native title", async () => {
        const { container } = await showPage(dashboard({ tasks: [task()] }));
        expect(container.querySelectorAll("[title]")).toHaveLength(0);
    });
});

describe("Raid-Details modal", () => {
    it("loads nothing until 'Details' opens it, then loads the next raid's details", async () => {
        vi.mocked(api.getNextRaidDetails).mockResolvedValue({ raid: details(), activeGuildId: "g1" });
        await showPage(dashboard());
        expect(api.getNextRaidDetails).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
        expect(api.getNextRaidDetails).toHaveBeenCalledWith("1400");
        const dialog = await screen.findByRole("dialog");
        expect(await within(dialog).findByText(t("dashboard.raidDetails.signups"))).toBeInTheDocument();
    });

    it("shows signups, preparation and who has not signed up, with a way to the raid", async () => {
        vi.mocked(api.getNextRaidDetails).mockResolvedValue({
            raid: details({
                notSignedUp: [{ id: "p1", name: "Thrall", className: "Shaman", classColor: "#0070de", role: "Heiler", status: "tentative", statusLabel: "Tentative" }],
                sheet: null,
            }),
            activeGuildId: "g1",
        });
        await showPage(dashboard());
        await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
        const dialog = await screen.findByRole("dialog");
        await within(dialog).findByText("Anmeldungen");
        expect(within(dialog).getByText("Vorbereitung")).toBeInTheDocument();
        expect(within(dialog).getByText("Noch nicht angemeldet")).toBeInTheDocument();
        expect(within(dialog).getByText("Thrall")).toBeInTheDocument();
        expect(within(dialog).getByText("Stand Raid-Helper:", { exact: false })).toBeInTheDocument();
        // no sheet yet: the way to the raid is "Sheet füllen"
        expect(within(dialog).getByRole("link", { name: "Sheet füllen" })).toHaveAttribute("href", "/raids/detail?event=1400");
        expect(within(dialog).queryByRole("link", { name: "Raid öffnen" })).not.toBeInTheDocument();
        expect(dialog.querySelectorAll("[title]")).toHaveLength(0);
    });

    it("offers 'Raid öffnen' once the sheet exists and closes on 'Schließen'", async () => {
        vi.mocked(api.getNextRaidDetails).mockResolvedValue({
            raid: details({ sheet: { url: "https://docs.google.com/x", playerCount: 25, filledAt: "" } }),
            activeGuildId: "g1",
        });
        await showPage(dashboard());
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Details" }));
        const dialog = await screen.findByRole("dialog");
        expect(await within(dialog).findByRole("link", { name: "Raid öffnen" })).toHaveAttribute("href", "/raids/detail?event=1400");
        // the footer button (the corner x carries the same name)
        await user.click(within(dialog).getByText("Schließen", { selector: "button" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("gives the softres row to the loot system where no list is used", async () => {
        const lootSystem = {
            system: "gdkp" as const, label: "GDKP", source: "event" as const,
            categorySystem: "softres" as const, categoryLabel: "Softres", softresExtra: false, softres: false,
        };
        vi.mocked(api.getNextRaidDetails).mockResolvedValue({ raid: details({ lootSystem }), activeGuildId: "g1" });
        await showPage(dashboard());
        await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
        const dialog = await screen.findByRole("dialog");
        expect(await within(dialog).findByText(t("dashboard.raidDetails.lootSystem"))).toBeInTheDocument();
        expect(within(dialog).getByText("GDKP")).toBeInTheDocument();
        expect(within(dialog).queryByText(t("dashboard.raidDetails.softres"))).not.toBeInTheDocument();
    });

    it("shows the error of a failed load", async () => {
        vi.mocked(api.getNextRaidDetails).mockRejectedValue({ code: "http_504", message: "Der Server antwortet gerade nicht" });
        await showPage(dashboard());
        await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
        expect(await screen.findByText("Der Server antwortet gerade nicht")).toBeInTheDocument();
    });
});
