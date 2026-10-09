// The "Profile" tab (#676) against a mocked profile API: the list with how many
// rosters use each profile, create / copy / rename / delete (only an unused
// one), the picked profile's view and weighting (#668's steppers, exceptions
// through the item search) behind ONE save, the reset that only fills the form,
// and the read-only view.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CouncilProfileData, CouncilProfileRow, CouncilWeightSettings } from "../../api";
import { councilData } from "../../test/councilFixtures";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import { ProfilesTab } from "./ProfilesTab";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getCouncilProfiles: vi.fn(),
    getCouncilProfile: vi.fn(),
    createCouncilProfile: vi.fn(),
    updateCouncilProfile: vi.fn(),
    deleteCouncilProfile: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

const weights = (over: Partial<CouncilWeightSettings> = {}): CouncilWeightSettings => ({
    classes: { trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
    items: {},
    need: { drought: 45, share: 30, need: 10, tenure: 15 },
    tenureDays: 90,
    at: 0,
    by: "",
    ...over,
});
const VIEW = { role: "caster", tiers: [], contents: [], bisTier: "", version: "" };

const row = (over: Partial<CouncilProfileRow> = {}): CouncilProfileRow => ({
    id: "standard", name: "Standard", isDefault: true, rosters: [], otherRosters: [], categories: [], inUse: true, at: 0, by: "", ...over,
});
const ROWS = [
    row({ rosters: [{ id: "r2", name: "PuG-Roster" }] }),
    row({ id: "p-main", name: "Main T6", isDefault: false, rosters: [{ id: "r1", name: "Mittwoch-Roster" }, { id: "r3", name: "Donnerstag" }] }),
    row({ id: "p-free", name: "Frei", isDefault: false, inUse: false }),
];
const profileData = (id: string, over: Partial<CouncilProfileData["profile"]> = {}): CouncilProfileData => ({
    profile: { id, name: ROWS.find((r) => r.id === id)?.name || id, isDefault: id === "standard", weights: weights(), view: VIEW, ...over },
    itemInfo: {},
    defaults: { weights: weights(), view: VIEW },
    classIds: ["trinket", "bisWeapon", "weapon", "set", "normal", "frequent"],
    needIds: ["drought", "share", "need", "tenure"],
    limits: { weightMax: 5, needMax: 100, tenureMin: 7, tenureMax: 365, items: 200, name: 80 },
});
const options = councilData().options;
const readerUser = { id: "2", name: "Reader", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCouncilProfiles).mockResolvedValue({ defaultId: "standard", profiles: ROWS });
    vi.mocked(api.getCouncilProfile).mockImplementation(async (id) => profileData(id));
    vi.mocked(api.updateCouncilProfile).mockImplementation(async (id, patch) => profileData(id, { ...patch, weights: { ...weights(patch.weights), at: 9 } }));
    vi.mocked(api.createCouncilProfile).mockImplementation(async (name) => profileData("p-new", { name }));
    vi.mocked(api.deleteCouncilProfile).mockImplementation(async (id) => ({ id, deleted: true }));
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [{ id: 28789, name: "Eye of Magtheridon", iconUrl: "", quality: 4, contentId: "mag", boss: "Magtheridon", bisSpecs: [] }] });
});

function show(initialId = "p-main", canWrite = true, onSaved = vi.fn()) {
    renderPage(<ProfilesTab initialId={initialId} options={options} canWrite={canWrite} onSaved={onSaved} />, canWrite ? {} : { user: readerUser });
    return onSaved;
}

describe("profiles tab (German)", () => {
    it("lists the profiles with their use, the council's profile picked first", async () => {
        show();
        const list = await screen.findByRole("complementary", { name: "Profile" });
        expect(within(list).getByText("3 Profile")).toBeInTheDocument();
        expect(within(list).getByRole("button", { name: /Main T6.*von 2 Rostern genutzt/ })).toHaveAttribute("aria-pressed", "true");
        expect(within(list).getByRole("button", { name: /Standard.*von 1 Roster genutzt/ })).toBeInTheDocument();
        expect(within(list).getByRole("button", { name: /Frei.*nicht genutzt/ })).toBeInTheDocument();
        expect(await screen.findByText("Genutzt von: Mittwoch-Roster, Donnerstag")).toBeInTheDocument();
        expect(api.getCouncilProfile).toHaveBeenCalledWith("p-main");
        for (const h of ["Ansicht", "Item-Gewichte", "Ausnahmen", "Bedarf", "Zugehörigkeit"]) expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    });

    it("saves view and weighting of the picked profile with ONE button", async () => {
        const user = userEvent.setup();
        const onSaved = show();
        const trinket = await screen.findByRole("group", { name: "Trinket" });
        await user.click(within(trinket).getByRole("button", { name: "Trinket verringern" }));
        expect(within(trinket).getByText("1,9 Punkte")).toBeInTheDocument();
        await user.click(within(screen.getByRole("radiogroup", { name: "Rolle des Profils" })).getByRole("radio", { name: /Heiler/ }));
        await user.click(screen.getByRole("button", { name: "T5" }));
        expect(screen.getByText("Nicht gespeichert")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateCouncilProfile).toHaveBeenCalledTimes(1));
        expect(api.updateCouncilProfile).toHaveBeenCalledWith("p-main", {
            weights: expect.objectContaining({ classes: expect.objectContaining({ trinket: 1.9 }) }),
            view: { role: "healer", tiers: ["t5"], contents: [], bisTier: "", version: "" },
        });
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it("adds an exception through the item search", async () => {
        const user = userEvent.setup();
        show();
        expect(await screen.findByText("Noch keine Ausnahmen.")).toBeInTheDocument();
        await user.type(screen.getByPlaceholderText("Item suchen, um eine Ausnahme anzulegen …"), "Eye");
        await user.click(await screen.findByText("Eye of Magtheridon"));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateCouncilProfile).toHaveBeenCalledWith("p-main", expect.objectContaining({
            weights: expect.objectContaining({ items: { 28789: { weight: 1, name: "Eye of Magtheridon" } } }),
        })));
    });

    it("fills the form with the defaults only after asking, and saves nothing by itself", async () => {
        vi.mocked(api.getCouncilProfile).mockImplementation(async (id) => profileData(id, { weights: weights({ tenureDays: 30 }) }));
        const user = userEvent.setup();
        show();
        expect(await screen.findByText("30 Tage")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Auf Vorgaben zurücksetzen" }));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Auf Vorgaben zurücksetzen" }));
        expect(await screen.findByText("90 Tage")).toBeInTheDocument();
        expect(api.updateCouncilProfile).not.toHaveBeenCalled();
    });

    it("creates a profile and picks it", async () => {
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("button", { name: "Neues Profil" }));
        const dialog = await screen.findByRole("dialog");
        await user.type(within(dialog).getByLabelText("Name"), "PuG-Nacht");
        await user.click(within(dialog).getByRole("button", { name: "Anlegen" }));
        await waitFor(() => expect(api.createCouncilProfile).toHaveBeenCalledWith("PuG-Nacht"));
        await waitFor(() => expect(api.getCouncilProfiles).toHaveBeenCalledTimes(2));
    });

    it("says a taken name in words", async () => {
        vi.mocked(api.createCouncilProfile).mockRejectedValue(Object.assign(new Error("x"), { code: "name_taken" }));
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("button", { name: "Neues Profil" }));
        const dialog = await screen.findByRole("dialog");
        await user.type(within(dialog).getByLabelText("Name"), "Standard");
        await user.click(within(dialog).getByRole("button", { name: "Anlegen" }));
        expect(await within(dialog).findByText("Diesen Namen hat schon ein Profil.")).toBeInTheDocument();
    });

    it("copies and renames the picked profile", async () => {
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("button", { name: "Kopieren" }));
        let dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByLabelText("Name")).toHaveValue("Main T6 (Kopie)");
        await user.click(within(dialog).getByRole("button", { name: "Kopieren" }));
        await waitFor(() => expect(api.createCouncilProfile).toHaveBeenCalledWith("Main T6 (Kopie)", "p-main"));

        await user.click(await screen.findByRole("button", { name: "Umbenennen" }));
        dialog = await screen.findByRole("dialog");
        const input = within(dialog).getByLabelText("Name");
        await user.clear(input);
        await user.type(input, "Main T6.5");
        await user.click(within(dialog).getByRole("button", { name: "Umbenennen" }));
        await waitFor(() => expect(api.updateCouncilProfile).toHaveBeenCalledWith(expect.any(String), { name: "Main T6.5" }));
    });

    it("deletes only an unused profile, after asking", async () => {
        const user = userEvent.setup();
        show();
        expect(await screen.findByRole("button", { name: "Löschen" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: /Frei/ }));
        await waitFor(() => expect(api.getCouncilProfile).toHaveBeenCalledWith("p-free"));
        const del = await screen.findByRole("button", { name: "Löschen" });
        await waitFor(() => expect(del).toBeEnabled());
        await user.click(del);
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Löschen" }));
        await waitFor(() => expect(api.deleteCouncilProfile).toHaveBeenCalledWith("p-free"));
    });

    it("shows a reader everything without any control", async () => {
        show("p-main", false);
        expect(await screen.findByText("Nur lesen — Ändern braucht Schreibrecht im Loot-Council")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Neues Profil" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Trinket" })).getByRole("button", { name: "Trinket erhöhen" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "T5" })).toBeDisabled();
    });
});

describe("profiles tab (English)", () => {
    beforeEach(() => switchLang("en"));
    afterEach(() => switchLang("de"));

    it("translates the list, the sections and the values", async () => {
        show();
        expect(await screen.findByText("3 profiles")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Main T6.*used by 2 rosters/ })).toBeInTheDocument();
        expect(await screen.findByRole("heading", { name: "Item weights" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "View" })).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "Frequent drop" })).getByText("0.5 points")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "New profile" })).toBeInTheDocument();
    });
});
