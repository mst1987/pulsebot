// The archive tab of the Kanäle page (#259): channels wait there until an
// admin deletes them — by name, never on their own; the page only reminds.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ChannelsPage from "./ChannelsPage";
import { adminUser, renderPage } from "../test/render";
import { ARCHIVE, channelsData } from "./ChannelsPage.fixture";
import type { ChannelsData } from "../api";
import { switchLang } from "../test/i18n";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getChannels: vi.fn(),
    deleteChannels: vi.fn(),
}));

async function openPage(data: ChannelsData = channelsData(), route = "/channels?tab=archive", user = adminUser()) {
    vi.mocked(api.getChannels).mockResolvedValue(data);
    renderPage(<ChannelsPage />, { route, user });
    await screen.findByRole("radiogroup", { name: "Ansicht" });
}

beforeEach(() => {
    vi.mocked(api.deleteChannels).mockResolvedValue({ results: [], done: 1, failed: 0, message: "1 Kanal gelöscht" });
});

describe("ChannelsPage — archive tab", () => {
    it("opens from the url and lists the archived channels with how long they wait", async () => {
        await openPage();
        expect(screen.getByRole("radio", { name: "Archiv · 1" })).toHaveAttribute("aria-checked", "true");
        const name = screen.getByText("alt-raid", { selector: ".kn-name" });
        expect(name).toHaveAttribute("data-tip-sub", "archiviert am 03.09.2026 von Nerathil · aus Raids");
        expect(screen.getByText("3 Tage")).toBeInTheDocument();
        expect(screen.getByText("Archiv", { selector: ".kn-cat-title" })).toHaveAttribute("data-tip-sub", expect.stringContaining("Gelöscht wird nie automatisch"));
        expect(screen.getByRole("button", { name: "Archiv-Einstellungen" })).toBeInTheDocument();
        // the tree is not shown
        expect(screen.queryByText("regeln")).not.toBeInTheDocument();
    });

    it("switches between the tabs, from the switch and from the archive figure", async () => {
        const user = userEvent.setup();
        await openPage(channelsData(), "/channels");
        expect(screen.getByText("regeln", { selector: ".kn-name" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Im Archiv, warten auf Löschung/ }));
        expect(screen.getByText("alt-raid", { selector: ".kn-name" })).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: "Kanäle · 7" }));
        expect(screen.queryByText("alt-raid")).not.toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: "Archiv · 1" }));
        expect(screen.getByText("alt-raid", { selector: ".kn-name" })).toBeInTheDocument();
    });

    it("deletes from the archive only with the name typed", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Löschen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("#alt-raid löschen")).toBeInTheDocument();
        expect(within(dialog).getByText("Archiv", { selector: ".kicker" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Endgültig löschen" })).toBeDisabled();
        await user.type(within(dialog).getByRole("textbox", { name: /Zum Bestätigen/ }), "alt-raid");
        await user.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
        await waitFor(() => expect(api.deleteChannels).toHaveBeenCalledWith(["c-arch"], "alt-raid", false));
        expect(await screen.findByText("1 Kanal gelöscht")).toBeInTheDocument();
    });

    it("deletes a selection from the bar with 'Löschen …' instead of archiving", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("checkbox", { name: "Alle im Archiv wählen" }));
        const bar = screen.getByRole("toolbar", { name: "Auswahl bearbeiten" });
        expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual(["Löschen …", "Auswahl aufheben"]);
        await user.click(within(bar).getByRole("button", { name: "Löschen …" }));
        expect(within(screen.getByRole("dialog")).getByText("#alt-raid löschen")).toBeInTheDocument();
    });

    it("offers to set up an archive when there is none", async () => {
        const user = userEvent.setup();
        await openPage(channelsData({ archive: { categoryId: "", count: 0, overdue: 0, hintDays: 14, rows: [] } }));
        expect(screen.getByText(/Noch keine Archiv-Kategorie/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Archiv festlegen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByRole("option", { name: "+ neue Kategorie anlegen" })).toBeInTheDocument();
    });

    it("gives a reader the list without check boxes, bin or settings", async () => {
        await openPage(channelsData(), "/channels?tab=archive", adminUser({ isAdmin: false, access: { channels: { read: true, write: false } } }));
        expect(screen.getByText("alt-raid", { selector: ".kn-name" })).toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Archiv-Einstellungen" })).not.toBeInTheDocument();
    });
});

describe("ChannelsPage — reminds of waiting channels, never deletes by itself", () => {
    const overdue = () => channelsData({
        archive: {
            categoryId: ARCHIVE, count: 1, overdue: 1, hintDays: 14,
            rows: [{ id: "c-arch", name: "alt-raid", at: Date.UTC(2026, 7, 1), by: "", fromCategory: "", waitingDays: 20, overdue: true }],
        },
    });

    it("shows a yellow reminder beside the tabs once a channel waits too long", async () => {
        await openPage(overdue(), "/channels");
        const badge = screen.getByText("1 warten auf Löschung");
        expect(badge).toHaveClass("badge", "mid");
        expect(badge).toHaveAttribute("data-tip-sub", "1 davon länger als 14 Tage. Gelöscht wird nie automatisch.");
        expect(screen.getByRole("button", { name: /Im Archiv, warten auf Löschung/ }).querySelector(".kn-figure-val")).toHaveClass("mid");
    });

    it("marks the overdue row in the archive", async () => {
        await openPage(overdue());
        const waiting = screen.getByText("20 Tage");
        expect(waiting).toHaveClass("mid");
        expect(waiting).toHaveAttribute("data-tip", "Wartet auf Löschung");
        expect(screen.getByText("1 über 14 Tage")).toBeInTheDocument();
        expect(screen.getByText("alt-raid", { selector: ".kn-name" })).toHaveAttribute("data-tip-sub", "archiviert am 01.08.2026");
    });

    it("shows no reminder while nothing is overdue", async () => {
        await openPage(channelsData(), "/channels");
        expect(screen.queryByText(/warten auf Löschung$/, { selector: ".badge" })).not.toBeInTheDocument();
        expect(api.deleteChannels).not.toHaveBeenCalled();
    });
});

describe("ChannelsPage — archive tab in English", () => {
    afterEach(() => switchLang("de"));

    it("lists the archive and asks for the name in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        vi.mocked(api.getChannels).mockResolvedValue(channelsData());
        renderPage(<ChannelsPage />, { route: "/channels?tab=archive", user: adminUser() });
        await screen.findByRole("radiogroup", { name: "View" });
        expect(screen.getByText("alt-raid", { selector: ".kn-name" })).toHaveAttribute("data-tip-sub", expect.stringMatching(/^archived on .+ by Nerathil · from Raids$/));
        expect(screen.getByText("3 days")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Archive settings" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Delete" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Delete #alt-raid")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Delete for good" })).toBeDisabled();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
});
