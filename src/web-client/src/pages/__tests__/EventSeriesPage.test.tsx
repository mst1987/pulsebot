// Wiederkehrende Events (#289): the series page as the orga sees it — one line
// per category with the next date, and the modal with weekdays and the next
// four dates. German by default, English after a language switch.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { EventSeriesData, SeriesDate } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import EventSeriesPage from "../EventSeriesPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
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

    it("marks the series of a deactivated category as paused (#744)", async () => {
        vi.mocked(api.getEventSeries).mockResolvedValue({ ...DATA, categories: [{ ...DATA.categories[0], inactive: true }] });
        renderPage(<EventSeriesPage />, { route: "/raids/series" });
        const row = (await screen.findByText("Mittwochsraid")).closest("li") as HTMLElement;
        expect(within(row).getByText("Kategorie inaktiv")).toBeInTheDocument();
        expect(row).toHaveClass("sr-off");
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

    it("offers \"Jetzt prüfen\" (every series at once) only where the server allows it (canRunAll, #728)", async () => {
        const first = renderPage(<EventSeriesPage />, { route: "/raids/series" });
        expect(await screen.findByRole("button", { name: "Jetzt prüfen" })).toBeInTheDocument();
        first.unmount();
        // the orga of a category writes their series but sweeps no others
        vi.mocked(api.getEventSeries).mockResolvedValue({ ...DATA, canRunAll: false });
        renderPage(<EventSeriesPage />, { route: "/raids/series" });
        expect(await screen.findByRole("heading", { name: "Serien" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Jetzt prüfen" })).toBeNull();
        expect(screen.getByRole("button", { name: "Serie einrichten" })).toBeInTheDocument();
    });

    it("offers the buttons per row: a global orga reading only writes only its own categories (writableCategoryIds, #728)", async () => {
        const c1 = { ...DATA.categories[1], id: "c1", name: "Eigene" };
        const c2 = { ...DATA.categories[1], id: "c2", name: "Fremde" };
        vi.mocked(api.getEventSeries).mockResolvedValue({ ...DATA, categories: [c1, c2], canRunAll: false, writableCategoryIds: ["c1"] });
        renderPage(<EventSeriesPage />, { route: "/raids/series" });
        const own = (await screen.findByText("Eigene")).closest("li") as HTMLElement;
        const foreign = screen.getByText("Fremde").closest("li") as HTMLElement;
        expect(within(own).getByRole("button", { name: "Serie einrichten" })).toBeInTheDocument();
        expect(within(foreign).queryByRole("button", { name: "Serie einrichten" })).toBeNull();
    });

    it("opens a foreign row's series read only (writableCategoryIds, #728)", async () => {
        vi.mocked(api.getEventSeries).mockResolvedValue({ ...DATA, writableCategoryIds: ["c2"] });
        renderPage(<EventSeriesPage />, { route: "/raids/series?edit=c1" });
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByRole("button", { name: "Speichern" })).toBeNull();
        expect(within(dialog).getByLabelText("Uhrzeit")).toBeDisabled();
    });

    it("gives the fields the shared control look and skips a date with a switch, not a checkbox", async () => {
        renderPage(<EventSeriesPage />, { route: "/raids/series?edit=c1" });
        const dialog = await screen.findByRole("dialog");
        for (const name of ["Uhrzeit", "Tage vorher anlegen", "Titel"]) {
            expect(within(dialog).getByLabelText(name)).toHaveClass("inp-sm");
        }
        expect(await within(dialog).findByRole("switch", { name: "überspringen" })).not.toBeChecked();
        expect(within(dialog).queryByRole("checkbox")).toBeNull();
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
