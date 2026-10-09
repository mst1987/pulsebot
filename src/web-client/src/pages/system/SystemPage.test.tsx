// The "Systemstatus" page (docs/system-status.md) as an admin sees it: the
// verdict on top, the five tiles, the sortable table of the slowest requests,
// the processes (only when measured) and the disk.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import SystemPage from "./SystemPage";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { systemStatus } from "./SystemPage.fixture";
import { t } from "../../i18n";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getSystemStatus: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus());
});

async function open() {
    renderPage(<SystemPage />, { route: "/system" });
    await screen.findByRole("heading", { level: 2 });
}

const table = () => screen.getByRole("table");
const routeOrder = () => within(table()).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("SystemPage", () => {
    it("asks for the processes on opening and shows the calm verdict", async () => {
        await open();
        expect(api.getSystemStatus).toHaveBeenCalledWith({ processes: true });
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Alles im grünen Bereich");
        expect(screen.getByText(t("system.verdict.okText"))).toBeInTheDocument();
    });

    it("says each finding with its numbers and the recommendation, worst level in the head", async () => {
        vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus({
            assessment: {
                level: "bad", warmingUp: false,
                findings: [
                    { id: "otherProcess", level: "bad", values: { hostCpu: 94, botCpu: 5, process: "mysqld", processCpu: 340 } },
                    { id: "diskLow", level: "warn", values: { freePct: 7.5, free: 3 * 1024 ** 3, total: 40 * 1024 ** 3 } },
                ],
            },
        }));
        await open();
        const verdict = screen.getByRole("region", { name: "Einschätzung" });
        expect(within(verdict).getByRole("heading")).toHaveTextContent("Engpass gefunden");
        expect(verdict).toHaveTextContent("„mysqld“ braucht 340 % CPU, insgesamt sind es 94 %, der Bot selbst nur 5 %.");
        expect(verdict).toHaveTextContent("nur 7,5 % frei (3 GB von 40 GB)");
        expect(within(verdict).getAllByText("Empfehlung")).toHaveLength(2);
    });

    it("shows the five tiles with value, unit and label", async () => {
        await open();
        const tiles = screen.getByRole("region", { name: "Kennzahlen" });
        expect(within(tiles).getByText("Server-CPU").parentElement).toHaveTextContent("27 %");
        expect(within(tiles).getByText("Server-CPU").parentElement).toHaveTextContent("4 Kerne · Load 0,42");
        expect(within(tiles).getByText("Bot-CPU").parentElement).toHaveTextContent("12 %");
        expect(within(tiles).getByText("RAM verfügbar").parentElement).toHaveTextContent("4,5 GB");
        expect(within(tiles).getByText("Verzögerung p99").parentElement).toHaveTextContent("14 ms");
        expect(within(tiles).getByText("Datenträger frei").parentElement).toHaveTextContent("60 %");
        // a sparkline per tile with a history
        expect(tiles.querySelectorAll("svg.sy-spark")).toHaveLength(5);
    });

    it("colours a tile only when its figure needs a look", async () => {
        vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus({ current: { ...systemStatus().current!, hostCpu: 91 } }));
        await open();
        expect(screen.getByText("Server-CPU").parentElement).toHaveClass("sy-tone-bad");
        expect(screen.getByText("Bot-CPU").parentElement).not.toHaveClass("sy-tone-bad");
        expect(screen.getByText("Bot-CPU").parentElement).not.toHaveClass("sy-tone-mid");
    });

    it("lists the routes of the last hour slowest first, and sorts on a header click", async () => {
        await open();
        // /api/cla did not run in the last hour
        expect(routeOrder()).toEqual(["/r/:id", "/api/raids"]);
        await userEvent.click(within(table()).getByRole("button", { name: /Anfragen/ }));
        expect(routeOrder()).toEqual(["/api/raids", "/r/:id"]);
        await userEvent.click(screen.getByRole("radio", { name: "Seit Start" }));
        expect(routeOrder()).toContain("/api/cla");
    });

    it("folds the last slow requests open", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Letzte langsame Anfrage/ }));
        expect(screen.getByText("GET /r/:id")).toBeInTheDocument();
        expect(screen.getAllByText("5,2 s").length).toBeGreaterThan(0);
    });

    it("shows the processes with the bot marked, and leaves the part out without a list", async () => {
        const view = renderPage(<SystemPage />, { route: "/system" });
        expect(await screen.findByText("Prozesse auf dem Server")).toBeInTheDocument();
        expect(screen.getByText("mysqld")).toBeInTheDocument();
        expect(screen.getByText("Bot")).toBeInTheDocument();
        view.unmount();

        vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus({ processes: { at: 1, source: "", list: [] } }));
        await open();
        expect(screen.queryByText("Prozesse auf dem Server")).not.toBeInTheDocument();
        vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus({ processes: null }));
    });

    it("shows what takes the space under data/", async () => {
        await open();
        expect(screen.getByText("Speicherplatz")).toBeInTheDocument();
        expect(screen.getByText("reports/")).toBeInTheDocument();
        expect(screen.getByText("340 Dateien")).toBeInTheDocument();
    });

    it("measures again on the refresh button", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: "Neu messen" }));
        await waitFor(() => expect(api.getSystemStatus).toHaveBeenLastCalledWith({ processes: true, disk: true }));
    });

    it("says it is still warming up instead of judging", async () => {
        vi.mocked(api.getSystemStatus).mockResolvedValue(systemStatus({ current: null, assessment: { level: "ok", warmingUp: true, findings: [] } }));
        await open();
        expect(screen.getByText(t("system.verdict.warmingUp"))).toBeInTheDocument();
        expect(screen.getByText(t("system.tiles.noSample"))).toBeInTheDocument();
    });

    describe("in English", () => {
        beforeEach(() => switchLang("en"));
        afterEach(() => switchLang("de"));

        it("speaks English", async () => {
            await open();
            expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("All good");
            expect(screen.getByText("Server CPU")).toBeInTheDocument();
            expect(screen.getByText("Slowest requests")).toBeInTheDocument();
        });
    });
});
