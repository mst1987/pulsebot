// The "Gewichtung" tab (#668) against a mocked weighting API: steppers instead
// of fields, item exceptions through the item search, one save, the reset that
// only fills the form, a category's own weighting behind a switch, and the
// read-only view.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CouncilWeightSettings, CouncilWeightsData } from "../../api";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import { WeightsTab } from "./WeightsTab";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getCouncilWeights: vi.fn(),
    saveCouncilWeights: vi.fn(),
    resetCouncilWeights: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

const settings = (over: Partial<CouncilWeightSettings> = {}): CouncilWeightSettings => ({
    classes: { trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
    items: {},
    need: { drought: 45, share: 30, need: 10, tenure: 15 },
    tenureDays: 90,
    at: 0,
    by: "",
    ...over,
});

const weightsData = (over: Partial<CouncilWeightsData> = {}): CouncilWeightsData => ({
    category: "",
    scope: "global",
    itemInfo: {},
    global: { ...settings(), stored: false },
    own: null,
    defaults: settings(),
    classIds: ["trinket", "bisWeapon", "weapon", "set", "normal", "frequent"],
    needIds: ["drought", "share", "need", "tenure"],
    limits: { weightMax: 5, needMax: 100, tenureMin: 7, tenureMax: 365, items: 200, name: 80 },
    ...over,
});

const readerUser = { id: "2", name: "Reader", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };

beforeEach(() => {
    vi.mocked(api.getCouncilWeights).mockResolvedValue(weightsData());
    vi.mocked(api.saveCouncilWeights).mockImplementation(async (_cat, w) => weightsData({ global: { ...settings(w), at: 9, stored: true } }));
    vi.mocked(api.resetCouncilWeights).mockResolvedValue(weightsData());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [{ id: 28789, name: "Eye of Magtheridon", iconUrl: "", quality: 4, contentId: "mag", boss: "Magtheridon", bisSpecs: [] }] });
});

describe("weighting tab (German)", () => {
    it("shows the four sections with the stored values, spoken with their words", async () => {
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={() => {}} />);
        expect(await screen.findByRole("heading", { name: "Item-Gewichte" })).toBeInTheDocument();
        for (const h of ["Ausnahmen", "Bedarf", "Zugehörigkeit"]) expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
        const trinket = screen.getByRole("group", { name: "Trinket" });
        expect(within(trinket).getByText("2 Punkte")).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Häufiger Drop" })).getByText("0,5 Punkte")).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Wartezeit" })).getByText("45 · 45 %")).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Voll nach" })).getByText("90 Tage")).toBeInTheDocument();
        expect(screen.getByText("Gilt für den Server")).toBeInTheDocument();
        // nothing changed yet: nothing to save
        expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    });

    it("changes a class weight with − and saves it once for the server", async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={onSaved} />);
        const trinket = await screen.findByRole("group", { name: "Trinket" });
        await user.click(within(trinket).getByRole("button", { name: "Trinket verringern" }));
        expect(within(trinket).getByText("1,9 Punkte")).toBeInTheDocument();
        expect(screen.getByText("Nicht gespeichert")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.saveCouncilWeights).toHaveBeenCalledTimes(1));
        expect(api.saveCouncilWeights).toHaveBeenCalledWith("", expect.objectContaining({ classes: expect.objectContaining({ trinket: 1.9 }) }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it("adds an exception through the item search and removes it again", async () => {
        const user = userEvent.setup();
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={() => {}} />);
        expect(await screen.findByText("Noch keine Ausnahmen.")).toBeInTheDocument();
        await user.type(screen.getByPlaceholderText("Item suchen, um eine Ausnahme anzulegen …"), "Eye");
        await user.click(await screen.findByText("Eye of Magtheridon"));
        const row = screen.getByRole("group", { name: "Eye of Magtheridon" });
        expect(within(row).getByText("1 Punkt")).toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Eye of Magtheridon erhöhen" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.saveCouncilWeights).toHaveBeenCalledWith("", expect.objectContaining({
            items: { 28789: { weight: 1.1, name: "Eye of Magtheridon" } },
        })));
    });

    it("says which class a stored exception replaces", async () => {
        vi.mocked(api.getCouncilWeights).mockResolvedValue(weightsData({
            global: { ...settings({ items: { 28789: { weight: 0.5, name: "Eye of Magtheridon" } } }), stored: true },
            itemInfo: { 28789: { name: "Eye of Magtheridon", iconUrl: "", quality: 4, autoClass: "trinket" } },
        }));
        const user = userEvent.setup();
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={() => {}} />);
        expect(await screen.findByText("statt Trinket · 2")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Ausnahme für Eye of Magtheridon entfernen" }));
        expect(screen.getByText("Noch keine Ausnahmen.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.saveCouncilWeights).toHaveBeenCalledWith("", expect.objectContaining({ items: {} })));
    });

    it("fills the form with the defaults only after asking, and saves nothing by itself", async () => {
        vi.mocked(api.getCouncilWeights).mockResolvedValue(weightsData({ global: { ...settings({ tenureDays: 30 }), stored: true } }));
        const user = userEvent.setup();
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={() => {}} />);
        expect(await screen.findByText("30 Tage")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Auf Vorgaben zurücksetzen" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Auf Vorgaben zurücksetzen" }));
        expect(await screen.findByText("90 Tage")).toBeInTheDocument();
        expect(api.saveCouncilWeights).not.toHaveBeenCalled();
        expect(api.resetCouncilWeights).not.toHaveBeenCalled();
    });

    it("gives a picked category its own weighting behind a switch", async () => {
        vi.mocked(api.getCouncilWeights).mockResolvedValue(weightsData({ category: "c1" }));
        const user = userEvent.setup();
        renderPage(<WeightsTab category="c1" categoryName="Mittwoch" canWrite onSaved={() => {}} />);
        const sw = await screen.findByRole("switch", { name: "Eigene Gewichtung für Mittwoch" });
        expect(sw).not.toBeChecked();
        await user.click(sw);
        expect(screen.getByText("Eigene für Mittwoch")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.saveCouncilWeights).toHaveBeenCalledWith("c1", expect.any(Object)));
        expect(api.getCouncilWeights).toHaveBeenCalledWith("c1");
    });

    it("lets a category with its own weighting follow the server again", async () => {
        vi.mocked(api.getCouncilWeights).mockResolvedValue(weightsData({ category: "c1", scope: "category", own: settings({ tenureDays: 30 }) }));
        const user = userEvent.setup();
        renderPage(<WeightsTab category="c1" categoryName="Mittwoch" canWrite onSaved={() => {}} />);
        const sw = await screen.findByRole("switch", { name: "Eigene Gewichtung für Mittwoch" });
        expect(sw).toBeChecked();
        await user.click(sw);
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.resetCouncilWeights).toHaveBeenCalledWith("c1"));
        expect(api.saveCouncilWeights).not.toHaveBeenCalled();
    });

    it("shows a reader the weighting without any control", async () => {
        renderPage(<WeightsTab category="c1" categoryName="Mittwoch" canWrite={false} onSaved={() => {}} />, { user: readerUser });
        expect(await screen.findByText("Nur lesen — Ändern braucht Schreibrecht im Loot-Council")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Auf Vorgaben zurücksetzen" })).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText("Item suchen, um eine Ausnahme anzulegen …")).not.toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Trinket" })).getByRole("button", { name: "Trinket erhöhen" })).toBeDisabled();
        expect(screen.getByRole("switch", { name: "Eigene Gewichtung für Mittwoch" })).toBeDisabled();
    });
});

describe("weighting tab (English)", () => {
    beforeEach(() => switchLang("en"));
    afterEach(() => switchLang("de"));

    it("translates the sections and the values", async () => {
        renderPage(<WeightsTab category="" categoryName="" canWrite onSaved={() => {}} />);
        expect(await screen.findByRole("heading", { name: "Item weights" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Belonging" })).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Frequent drop" })).getByText("0.5 points")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeInTheDocument();
    });
});
