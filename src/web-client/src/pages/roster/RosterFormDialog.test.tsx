// "Roster anlegen" and the roster's "Einstellungen" (#657): the create dialog
// prefilled from a category (name, version, places from its raid template),
// role chips with the ones the bot cannot give greyed out, the source of the
// first members, the summary after the create; the settings for an admin
// (everything, delete behind a question) and for a manager (admin fields
// greyed out, only his fields sent); English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import RosterFormDialog from "./RosterFormDialog";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, member, options, rosterHead, settings } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterOptions: vi.fn(),
    searchRosterMembers: vi.fn(),
    createRoster: vi.fn(),
    updateRoster: vi.fn(),
    deleteRoster: vi.fn(),
}));

/** The open roster dialog; throws until it is there, so waitFor() waits for it. */
const dialog = (): HTMLElement => {
    const el = document.querySelector("dialog.rn-dlg");
    if (!el) throw new Error("no roster dialog yet");
    return el as HTMLElement;
};

function create(presetCategory = "cat2", opts = options()) {
    vi.mocked(api.getRosterOptions).mockResolvedValue(opts);
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    renderPage(<RosterFormDialog mode="create" presetCategory={presetCategory} {...props} />);
    return props;
}

function settingsOf(over: { isAdmin?: boolean } = {}) {
    const isAdmin = over.isAdmin ?? true;
    vi.mocked(api.getRosterOptions).mockResolvedValue(options({ isAdmin }));
    const data = detail([member("Thorgrim")], { canManage: true, isAdmin, settings: settings({ trialRoleId: "role-trial" }), roster: rosterHead() });
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    renderPage(<RosterFormDialog mode="settings" data={data} {...props} />);
    return props;
}

beforeEach(() => {
    vi.mocked(api.searchRosterMembers).mockResolvedValue({ results: [{ userId: "u-luna", displayName: "Lunaria", inRoster: false, chars: [] }] });
    vi.mocked(api.createRoster).mockResolvedValue({
        roster: { id: "pug-kara-x", name: "PuG Karazhan", categoryId: "cat2", versionId: "tbc", guildId: "g1" },
        initial: { source: "role", added: 8, skipped: 1, roleFailures: [{ userId: "u1", roleId: "role-kara", code: "role_too_high" }], error: null },
    });
    vi.mocked(api.updateRoster).mockResolvedValue({ roster: { id: "raid-mo-do-abc", name: "Neu", categoryId: "cat1", versionId: "tbc", guildId: "g1" }, trimmedChars: 0 });
});
afterEach(() => switchLang("de"));

describe("RosterFormDialog — create", () => {
    it("starts from the category: name, title, places from its raid template", async () => {
        create();
        expect(await screen.findByText("PuG Karazhan bekommt ein Roster")).toBeInTheDocument();
        const d = within(dialog());
        // The title is in the DOM before the <dialog> is open, and a closed one has no accessible roles: wait for it.
        expect(await d.findByRole("combobox", { name: "Kategorie" })).toHaveValue("cat2");
        expect(d.getByLabelText("Name des Rosters")).toHaveValue("PuG Karazhan");
        expect(d.getByRole("group", { name: "Gesamt" })).toHaveTextContent("10");
        expect(d.getByRole("group", { name: "Tanks" })).toHaveTextContent("2");
        expect(d.getByText("DPS ergibt sich: 5 Plätze. Vorbelegt aus der Raid-Vorlage „Karazhan“.")).toBeInTheDocument();
        // a category that already has a roster cannot be picked
        expect(d.getByRole("option", { name: /Raid Mo \/ Do \(hat schon/ })).toBeDisabled();
        expect(d.getByText(/gleicht alle 10 Minuten ab/, { selector: ".rn-dlg-sec .rn-sub" })).toBeInTheDocument();
    });

    it("greys out a role the bot cannot give and makes the first picked role the main role", async () => {
        create();
        const d = within(await waitFor(() => dialog()));
        const roles = within(await d.findByRole("group", { name: "Discord-Rolle des Rosters" }));
        expect(roles.getByRole("button", { name: /@Raidlead/ })).toBeDisabled();
        await userEvent.click(roles.getByRole("button", { name: /@Kara-Team/ }));
        await userEvent.click(roles.getByRole("button", { name: /@Raider Mo\/Do/ }));
        expect(roles.getByRole("button", { name: /@Kara-Team · Hauptrolle/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("needs a role for 'Alle mit der Rolle' and sends the whole form", async () => {
        const { onSaved } = create();
        const d = within(await waitFor(() => dialog()));
        await d.findByText("Wer kommt zuerst hinein?");
        expect(d.getByRole("radio", { name: /Alle mit der Rolle/ })).toBeDisabled();
        const submit = d.getByRole("button", { name: "Roster anlegen" });
        expect(submit).toBeDisabled();
        await userEvent.click(within(d.getByRole("group", { name: "Discord-Rolle des Rosters" })).getByRole("button", { name: /@Kara-Team/ }));
        expect(submit).toBeEnabled();
        await userEvent.click(within(d.getByRole("group", { name: "Probe-Rolle (optional)" })).getByRole("button", { name: /@Probe/ }));
        await userEvent.click(within(d.getByRole("group", { name: "Heiler" })).getByRole("button", { name: "Heiler: mehr" }));
        await userEvent.click(d.getByRole("switch", { name: "Mehrere Charaktere je Person" }));
        await userEvent.type(d.getByRole("searchbox", { name: "Konto suchen" }), "lun");
        await userEvent.click(await d.findByRole("button", { name: "+ Lunaria" }));
        await userEvent.click(submit);
        expect(api.createRoster).toHaveBeenCalledWith({
            name: "PuG Karazhan", slots: { total: 10, tank: 2, healer: 4, bench: 2 }, allowMultipleChars: true, signupOnly: false, publicRaids: false,
            categoryId: "cat2", versionId: "tbc", roleIds: ["role-kara"], trialRoleId: "role-trial", managers: { roleIds: [], userIds: ["u-luna"] }, source: "role",
        });
        expect(await screen.findByText("Das Roster „PuG Karazhan“ ist angelegt.")).toBeInTheDocument();
        expect(screen.getByText(/8 Personen mit der Rolle aufgenommen. 1 übersprungen./)).toBeInTheDocument();
        expect(screen.getByText("1 Rolle konnte nicht gegeben werden")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Zum Roster" })).toBeInTheDocument();
        expect(onSaved).toHaveBeenCalledWith("pug-kara-x");
    });

    it("offers the Kaderplaner only with Kader and asks which one", async () => {
        create("", options({ kaders: [{ id: "k1", name: "Forever-Kader", inRoster: 12, candidates: 30 }] }));
        const d = within(await waitFor(() => dialog()));
        await userEvent.click(await d.findByRole("radio", { name: /Aus dem Kaderplaner/ }));
        expect(d.getByRole("radio", { name: /Aus den letzten Raids/ })).toBeDisabled();
        await userEvent.selectOptions(d.getByRole("combobox", { name: "Kader" }), "k1");
        await userEvent.type(d.getByLabelText("Name des Rosters"), "Forever");
        await userEvent.click(d.getByRole("button", { name: "Roster anlegen" }));
        expect(api.createRoster).toHaveBeenCalledWith(expect.objectContaining({ name: "Forever", categoryId: null, source: "kader", kaderId: "k1" }));
    });
});

describe("RosterFormDialog — settings", () => {
    it("lets an admin change everything and sends only what changed", async () => {
        const { onSaved, onClose } = settingsOf();
        const d = within(await waitFor(() => dialog()));
        expect(await d.findByText("Raid Mo / Do einstellen")).toBeInTheDocument();
        expect(d.queryByText("Wer kommt zuerst hinein?")).not.toBeInTheDocument();
        expect(d.getByRole("button", { name: "Speichern" })).toBeDisabled();
        await userEvent.clear(d.getByLabelText("Name des Rosters"));
        await userEvent.type(d.getByLabelText("Name des Rosters"), "Neu");
        await userEvent.click(within(d.getByRole("group", { name: "Probe-Rolle (optional)" })).getByRole("button", { name: "Keine" }));
        await userEvent.click(d.getByRole("button", { name: "Speichern" }));
        expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { name: "Neu", trialRoleId: null });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onSaved).toHaveBeenCalledWith("raid-mo-do-abc");
    });

    it("deletes only after the question, which says the Discord roles stay", async () => {
        vi.mocked(api.deleteRoster).mockResolvedValue({ rosterId: "raid-mo-do-abc", deleted: true });
        settingsOf();
        const d = within(await waitFor(() => dialog()));
        await userEvent.click(await d.findByRole("button", { name: "Roster löschen" }));
        expect(await screen.findByText(/die Rollen bleiben, niemandem wird eine genommen/)).toBeInTheDocument();
        const confirm = screen.getByText("„Raid Mo / Do“ löschen?").closest("dialog") as HTMLElement;
        await userEvent.click(within(confirm).getByRole("button", { name: "Roster löschen" }));
        expect(api.deleteRoster).toHaveBeenCalledWith("raid-mo-do-abc");
    });

    it("greys out what only admins change for a manager and sends only his fields", async () => {
        settingsOf({ isAdmin: false });
        const d = within(await waitFor(() => dialog()));
        await d.findByText("Raid Mo / Do einstellen");
        expect(d.getByRole("combobox", { name: "Kategorie" })).toBeDisabled();
        expect(within(d.getByRole("group", { name: "Discord-Rolle des Rosters" })).getByRole("button", { name: /@Raider Mo\/Do/ })).toBeDisabled();
        expect(d.queryByRole("searchbox", { name: "Konto suchen" })).not.toBeInTheDocument();
        expect(d.queryByRole("button", { name: "Roster löschen" })).not.toBeInTheDocument();
        expect(d.getAllByText("Das ändern nur Admins.").length).toBeGreaterThan(0);
        await userEvent.click(within(d.getByRole("group", { name: "Tanks" })).getByRole("button", { name: "Tanks: weniger" }));
        await userEvent.click(d.getByRole("switch", { name: "Anmeldung nur für Roster-Mitglieder" }));
        // publicRaids: a manager may switch it too (epic #723)
        await userEvent.click(d.getByRole("switch", { name: "Raids für alle Raider sichtbar" }));
        await userEvent.click(d.getByRole("button", { name: "Speichern" }));
        expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { slots: { total: 25, tank: 2, healer: 7, bench: 0 }, signupOnly: true, publicRaids: true });
    });

    it("translates a refusal", async () => {
        vi.mocked(api.updateRoster).mockRejectedValue({ code: "category_taken", message: "x" });
        settingsOf();
        const d = within(await waitFor(() => dialog()));
        await d.findByText("Raid Mo / Do einstellen");
        await userEvent.selectOptions(d.getByRole("combobox", { name: "Kategorie" }), "");
        await userEvent.click(d.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText("Diese Kategorie hat schon ein Roster.")).toBeInTheDocument();
    });
});

describe("RosterFormDialog — Kader im Kaderplaner", () => {
    const KADERS = [
        { id: "k1", name: "Forever-Kader", inRoster: 12, candidates: 30, rosterId: null, rosterName: "" },
        { id: "k2", name: "Alter Kader", inRoster: 3, candidates: 5, rosterId: "other", rosterName: "PuG" },
    ];
    function linkSettings(isAdmin = true, kaderId: string | null = null) {
        vi.mocked(api.getRosterOptions).mockResolvedValue(options({ isAdmin, kaders: KADERS }));
        const data = detail([member("Thorgrim")], { canManage: true, isAdmin, settings: settings({ kaderId }), roster: rosterHead() });
        renderPage(<RosterFormDialog mode="settings" data={data} onClose={vi.fn()} onSaved={vi.fn()} />);
    }

    it("links a Kader for an admin and greys out one another roster holds", async () => {
        linkSettings();
        const d = within(await waitFor(() => dialog()));
        const select = await d.findByRole("combobox", { name: "Kader im Kaderplaner" });
        expect(within(select).getByRole("option", { name: "Alter Kader – verknüpft mit PuG" })).toBeDisabled();
        await userEvent.selectOptions(select, "k1");
        await userEvent.click(d.getByRole("button", { name: "Speichern" }));
        expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { kaderId: "k1" });
    });

    it("unlinks with \"Kein Kader\"", async () => {
        linkSettings(true, "k1");
        const d = within(await waitFor(() => dialog()));
        const select = await d.findByRole("combobox", { name: "Kader im Kaderplaner" });
        expect(select).toHaveValue("k1");
        await userEvent.selectOptions(select, "");
        await userEvent.click(d.getByRole("button", { name: "Speichern" }));
        expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { kaderId: null });
    });

    it("shows no picker to a manager who is no admin", async () => {
        linkSettings(false);
        const d = within(await waitFor(() => dialog()));
        await d.findByText("Raid Mo / Do einstellen");
        expect(d.queryByRole("combobox", { name: "Kader im Kaderplaner" })).not.toBeInTheDocument();
    });
});

describe("RosterFormDialog — Loot (#676)", () => {
    const lootOptions = (isAdmin: boolean) => options({
        isAdmin,
        lootSystems: ["softres", "lootcouncil", "gdkp", "other"],
        lootProfiles: [{ id: "standard", name: "Standard", isDefault: true }, { id: "p-main", name: "Main T6", isDefault: false }],
        canOpenCouncil: true,
    });
    function open(isAdmin: boolean, over: Parameters<typeof settings>[0] = {}) {
        vi.mocked(api.getRosterOptions).mockResolvedValue(lootOptions(isAdmin));
        const data = detail([member("Thorgrim")], { canManage: true, isAdmin, settings: settings({ lootSystem: "softres", lootProfileId: "", ...over }), roster: rosterHead() });
        renderPage(<RosterFormDialog mode="settings" data={data} onClose={vi.fn()} onSaved={vi.fn()} />);
    }

    it("lets a full admin switch to Loot-Council and pick a profile, sending both", async () => {
        const user = userEvent.setup();
        open(true);
        const d = within(await waitFor(() => dialog()));
        expect(d.getByRole("heading", { name: "Loot" })).toBeInTheDocument();
        expect(d.queryByLabelText("Loot-Council-Profil")).not.toBeInTheDocument();
        await user.click(within(d.getByRole("radiogroup", { name: "Lootsystem" })).getByRole("radio", { name: "Loot-Council" }));
        const select = d.getByLabelText("Loot-Council-Profil");
        expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Standard (Vorgabe)", "Main T6"]);
        await user.selectOptions(select, "p-main");
        expect(d.getByRole("link", { name: "Profile verwalten" })).toHaveAttribute("href", "/lootcouncil?roster=raid-mo-do-abc&tab=profiles");
        await user.click(d.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { lootSystem: "lootcouncil", lootProfileId: "p-main" }));
    });

    it("shows a manager the loot system read-only but lets him pick the profile", async () => {
        const user = userEvent.setup();
        open(false, { lootSystem: "lootcouncil" });
        const d = within(await waitFor(() => dialog()));
        expect(d.queryByRole("radiogroup", { name: "Lootsystem" })).not.toBeInTheDocument();
        expect(d.getByText("Loot-Council", { selector: "b" })).toBeInTheDocument();
        await user.selectOptions(d.getByLabelText("Loot-Council-Profil"), "p-main");
        await user.click(d.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateRoster).toHaveBeenCalledWith("raid-mo-do-abc", { lootProfileId: "p-main" }));
    });
});

describe("RosterFormDialog — in English", () => {
    it("translates the form", async () => {
        await switchLang("en");
        create();
        expect(await screen.findByText("PuG Karazhan gets a roster")).toBeInTheDocument();
        const d = within(dialog());
        expect(d.getByLabelText("Roster name")).toBeInTheDocument();
        expect(d.getByText("Who comes in first?")).toBeInTheDocument();
        expect(d.getByRole("switch", { name: "Several characters per person" })).toBeInTheDocument();
        expect(d.getByText("Damage follows: 5 places. Prefilled from the raid template “Karazhan”.")).toBeInTheDocument();
        expect(d.getByRole("button", { name: "Create roster" })).toBeInTheDocument();
    });
});
