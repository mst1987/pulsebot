// The Log-Auswertung is one click from the start page: the "Letzte Auswertung"
// tile leads to the last report, or - before the first evaluation - to the
// page that makes one (design issue #217).
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { DashboardData, DashboardLastReport } from "../api";
import { t } from "../i18n";
import { renderPage } from "../test/render";
import DashboardPage from "./DashboardPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getDashboard: vi.fn(),
}));

function dashboard(lastReport: DashboardLastReport | null): DashboardData {
    return {
        kicker: { guild: "Pulse", realm: "Thunderstrike" },
        nextRaid: null,
        followingRaid: null,
        nextRaidError: null,
        tasks: [],
        areas: {
            lastReport,
            newLoot: { count: 0, since: 0 },
            recruitment: { posts: 0 },
            roster: { total: 40, withoutDiscord: 0 },
        },
        recentEvents: { events: [], error: null },
        topLoot: { items: [], configured: 0 },
        activeGuildId: "g1",
    };
}

/** The area tile headed "Letzte Auswertung". */
async function tile(): Promise<HTMLElement> {
    const label = await screen.findByText(t("dashboard.areas.lastReport"));
    const link = label.closest("a");
    if (!link) throw new Error("the tile is no link");
    return link;
}

beforeEach(() => {
    vi.mocked(api.getDashboard).mockReset();
});

describe("Übersicht: the Log-Auswertung tile", () => {
    it("leads to the Log-Auswertung before the first evaluation", async () => {
        vi.mocked(api.getDashboard).mockResolvedValue(dashboard(null));
        renderPage(<DashboardPage />);
        const link = await tile();
        expect(link).toHaveAttribute("href", "/cla");
        expect(link).toHaveTextContent(t("dashboard.areas.evaluate"));
        expect(link).toHaveAttribute("data-tip", t("dashboard.areas.noReportTip"));
    });

    it("leads to the last report once there is one", async () => {
        vi.mocked(api.getDashboard).mockResolvedValue(dashboard({
            id: "r 1", title: "Hyjal Mittwoch", zone: "Hyjal", icon: "", generatedAt: Date.UTC(2026, 8, 16, 21, 0),
            bosses: 5, kills: 5, deaths: 3, avoidableDeaths: 1, gear: 2, consumables: 4, buffs: 0, problems: 7, open: 0,
        }));
        renderPage(<DashboardPage />);
        const link = await tile();
        expect(link).toHaveAttribute("href", "/r/r%201");
        expect(link).toHaveTextContent("Hyjal");
        expect(link).not.toHaveTextContent(t("dashboard.areas.evaluate"));
    });
});
