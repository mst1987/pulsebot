// Wiederkehrende Events (#289): the series page as the orga sees it — one line
// per category with the next date, and the modal with weekdays and the next
// four dates. German by default, English after a language switch.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { EventSeriesData, SeriesDate } from "../api";
import { renderPage } from "../test/render";
import { switchLang } from "../test/i18n";
import EventSeriesPage from "./EventSeriesPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getEventSeries: vi.fn(),
    previewEventSeries: vi.fn(),
}));

const ms = (iso: string) => Date.parse(iso);

function planned(date: string, createAt: string): SeriesDate {
    return {
        date, startTime: ms(`${date}T17:30:00Z`) / 1000, createAt: ms(createAt), skipped: false, state: "planned",
        eventId: "", channelName: "", previewName: "mi-23-09-ssc", error: "", at: 0, attempts: 0, willRetry: false,
    };
}

const UPCOMING = [planned("2026-09-23", "2026-09-17T17:30:00Z")];

const DATA: EventSeriesData = {
    categories: [
        {
            id: "c1", name: "Mittwochsraid", source: "eventhelper", template: null, summary: "Mi 19:30 · SSC · 6 Tage vorher",
            series: {
                categoryId: "c1", enabled: true, weekdays: [3], time: "19:30", raidTemplateId: "", daysBefore: 6, title: "", skipDates: [],
                guildId: "g1", leaderId: "", updatedAt: 0, updatedBy: "", updatedByName: "",
            },
            upcoming: UPCOMING, lastCreated: null,
        },
        { id: "c2", name: "Pug", source: "eventhelper", template: null, summary: "", series: null, upcoming: [], lastCreated: null },
    ],
    templates: [],
    lastRun: null,
    canWrite: true,
    limits: { minDaysBefore: 1, maxDaysBefore: 14 },
};

beforeEach(() => {
    vi.mocked(api.getEventSeries).mockReset().mockResolvedValue(DATA);
    vi.mocked(api.previewEventSeries).mockReset().mockResolvedValue({ error: "", summary: "Mi 19:30", upcoming: UPCOMING, template: null });
});

afterEach(() => switchLang("de"));

describe("the series page", () => {
    it("shows one line per category with the next date and what happens to it", async () => {
        renderPage(<EventSeriesPage />, { route: "/raids/series" });
        expect(await screen.findByRole("heading", { name: "Serien" })).toBeInTheDocument();
        expect(screen.getByText("Nächster Termin")).toBeInTheDocument();
        expect(screen.getByText("wird am Do 17.09. um 19:30 angelegt")).toBeInTheDocument();
        expect(screen.getByText("keine Serie")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Serie einrichten" })).toBeInTheDocument();
    });

    it("names the weekdays and the next four dates in the modal", async () => {
        renderPage(<EventSeriesPage />, { route: "/raids/series?edit=c1" });
        const dialog = await screen.findByRole("dialog");
        const days = within(dialog).getByRole("group", { name: "Wochentage" });
        expect(within(days).getByRole("button", { name: "Mi" })).toHaveAttribute("aria-pressed", "true");
        expect(within(days).getByRole("button", { name: "Mi" })).toHaveAttribute("data-tip", "Mittwoch");
        expect(within(dialog).getByText("Nächste 4 Termine")).toBeInTheDocument();
        expect(await within(dialog).findByText("überspringen")).toBeInTheDocument();
    });
});

describe("the series page in English", () => {
    it("reads in English, dates included", async () => {
        await switchLang("en");
        renderPage(<EventSeriesPage />, { route: "/raids/series" });
        expect(await screen.findByRole("heading", { name: "Series" })).toBeInTheDocument();
        expect(screen.getByText("Next date")).toBeInTheDocument();
        expect(screen.getByText("Wed 23/09")).toBeInTheDocument();
        expect(screen.getByText("will be created on Thu 17/09 at 19:30")).toBeInTheDocument();
        expect(screen.getByText("no series")).toBeInTheDocument();
    });

    it("names the weekdays in English in the modal", async () => {
        await switchLang("en");
        renderPage(<EventSeriesPage />, { route: "/raids/series?edit=c1" });
        const dialog = await screen.findByRole("dialog");
        const days = within(dialog).getByRole("group", { name: "Weekdays" });
        expect(within(days).getByRole("button", { name: "Wed" })).toHaveAttribute("data-tip", "Wednesday");
        expect(within(dialog).getByText("Next 4 dates")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
});
