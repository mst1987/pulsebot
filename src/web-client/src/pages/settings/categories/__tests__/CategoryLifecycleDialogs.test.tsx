// Einstellungen → Kategorien over a category's life (#744): the dialog that says
// what deactivating pauses, and "Kategorie abschließen" for a category deleted
// in Discord.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import { renderPage } from "../../../../test/render";
import CategoryDeactivateDialog from "../CategoryDeactivateDialog";
import CategoryCloseDialog from "../CategoryCloseDialog";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getCategoryDeactivate: vi.fn(),
    closeCategory: vi.fn(),
}));

const GONE: api.MissingCategory = {
    categoryId: "gone", name: "TBC Montag", active: true,
    series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true,
    settings: ["categoryRoles", "categoryRaidTemplate", "categoryReminders"], councilProfile: true,
    kaders: [{ kaderId: "k1", name: "Forever-Kader" }], rosters: [{ id: "ros1", name: "Montag-Roster" }], upcoming: 0,
};

beforeEach(() => {
    vi.mocked(api.getCategoryDeactivate).mockReset();
    vi.mocked(api.closeCategory).mockReset();
});

describe("CategoryDeactivateDialog (#744)", () => {
    it("lists per category what pauses and saves on confirm", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getCategoryDeactivate).mockResolvedValue({
            categories: [{ categoryId: "mon", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 2 }],
            emptyBlocked: false,
        });
        const onConfirm = vi.fn();
        renderPage(<CategoryDeactivateDialog next={["thu"]} names={new Map([["mon", "Montag"]])} onCancel={() => {}} onConfirm={onConfirm} />);
        expect(await screen.findByText("Serie (Mo 19:30) pausiert – legt keine Events an")).toBeInTheDocument();
        expect(api.getCategoryDeactivate).toHaveBeenCalledWith(["thu"], "");
        expect(screen.getByRole("heading", { name: "Montag" })).toBeInTheDocument();
        expect(screen.getByText("Erinnerungen pausieren")).toBeInTheDocument();
        expect(screen.getByText(/2 kommende Raids bleiben stehen/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Deaktivieren und speichern" }));
        expect(onConfirm).toHaveBeenCalled();
    });

    it("refuses to leave no active category while raids exist", async () => {
        vi.mocked(api.getCategoryDeactivate).mockResolvedValue({
            categories: [{ categoryId: "mon", series: null, reminders: false, upcoming: 0 }], emptyBlocked: true,
        });
        renderPage(<CategoryDeactivateDialog next={[]} names={new Map()} onCancel={() => {}} onConfirm={() => {}} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Mindestens eine Raid-Kategorie muss aktiv bleiben");
        expect(screen.getByText("Keine Serie")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Deaktivieren und speichern" })).toBeDisabled();
    });

    it("asks with the page's server and says so when another tab switched it (#926)", async () => {
        vi.mocked(api.getCategoryDeactivate).mockRejectedValue({ code: "server_switched", message: "raw" });
        renderPage(<CategoryDeactivateDialog next={["thu"]} guildId="g1" names={new Map()} onCancel={() => {}} onConfirm={() => {}} />);
        expect(await screen.findByText(/in einem anderen Tab gewechselt/)).toBeInTheDocument();
        expect(api.getCategoryDeactivate).toHaveBeenCalledWith(["thu"], "g1");
        expect(screen.getByRole("button", { name: "Deaktivieren und speichern" })).toBeDisabled();
    });
});

describe("CategoryCloseDialog (#744)", () => {
    it("says what goes and what stays, links the rosters and closes", async () => {
        const user = userEvent.setup();
        const result = { ok: true, name: "TBC Montag", removed: { series: true, reminders: true, settings: [], active: true, councilProfile: true, kaders: 1 }, rosters: [], config: {} as api.AdminConfig, missingCategories: [] } as api.CategoryCloseResult;
        vi.mocked(api.closeCategory).mockResolvedValue(result);
        const onClosed = vi.fn();
        renderPage(<CategoryCloseDialog category={GONE} onCancel={() => {}} onClosed={onClosed} />);
        expect(screen.getByText("TBC Montag abschließen")).toBeInTheDocument();
        expect(screen.getByText("Die Serie (Mo 19:30) wird gelöscht.")).toBeInTheDocument();
        expect(screen.getByText("Die Erinnerungen werden entfernt.")).toBeInTheDocument();
        // the reminders are named on their own, not counted with the other settings
        expect(screen.getByText(/2 Kategorie-Einstellungen werden entfernt/)).toBeInTheDocument();
        expect(screen.getByText("Sie zählt im Kader Forever-Kader nicht mehr zur Anwesenheit.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Montag-Roster" })).toHaveAttribute("href", "/roster/r/ros1");
        // #739: the rosters are closed with the category, nobody loses a role
        expect(screen.getByText(/werden abgeschlossen: Sie bleiben unter ihrer Version lesbar/)).toBeInTheDocument();
        expect(screen.queryByText("schon abgeschlossen")).not.toBeInTheDocument();
        expect(screen.getByText(/Raids, Loot, Logs sowie Version und Name/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Abschließen" }));
        expect(api.closeCategory).toHaveBeenCalledWith("gone");
        expect(onClosed).toHaveBeenCalledWith(result);
    });

    it("marks a roster an earlier switch already closed (#739)", () => {
        renderPage(<CategoryCloseDialog category={{ ...GONE, rosters: [{ id: "ros0", name: "Montag TBC", versionId: "tbc", closed: true }, { id: "ros1", name: "Montag-Roster", versionId: "forever", closed: false }] }} onCancel={() => {}} onClosed={() => {}} />);
        expect(screen.getByRole("link", { name: "Montag TBC" }).closest("li")).toHaveTextContent("schon abgeschlossen");
        expect(screen.getByRole("link", { name: "Montag-Roster" }).closest("li")).not.toHaveTextContent("schon abgeschlossen");
    });

    it("shows the server's refusal and stays open", async () => {
        const user = userEvent.setup();
        vi.mocked(api.closeCategory).mockRejectedValue(Object.assign(new Error("Die Kategorie gibt es in Discord noch."), { status: 409 }));
        const onClosed = vi.fn();
        renderPage(<CategoryCloseDialog category={{ ...GONE, series: null, reminders: false, settings: [], active: false, councilProfile: false, kaders: [], rosters: [] }} onCancel={() => {}} onClosed={onClosed} />);
        expect(screen.getByText("Es ist nichts mehr eingestellt.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Abschließen" }));
        expect(await screen.findByText("Die Kategorie gibt es in Discord noch.")).toBeInTheDocument();
        expect(onClosed).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Abschließen" })).toBeEnabled();
    });
});
