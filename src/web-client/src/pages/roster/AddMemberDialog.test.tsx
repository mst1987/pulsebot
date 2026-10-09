// "Mitglied hinzufügen" (#655): search a person, pick status and character,
// the note about the Discord role, the save with mode "add", a failed role
// write as a calm message, the prefilled variant from the Abgleich tab, English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import AddMemberDialog from "./AddMemberDialog";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, member, rosterHead } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    searchRosterMembers: vi.fn(),
    saveRosterMember: vi.fn(),
}));

const char = (name: string, over = {}) => ({ key: name.toLowerCase(), name, className: "Priest", spec: "Priest-Holy", specId: "Holy", specLabel: "Heilig", specIcon: "spell_holy_guardianspirit", classColor: "#FFFFFF", ...over });
const RESULTS = [
    { userId: "u-ely", displayName: "Elyndra", inRoster: false, chars: [char("Elyndra"), char("Elytwink", { className: "Mage", specId: "Fire", specLabel: "Feuer", specIcon: "" })] },
    { userId: "u-thorgrim", displayName: "Thorgrim", inRoster: true, chars: [] },
];

const data = (over = {}) => detail([member("Thorgrim", { userId: "u-thorgrim" })], { canManage: true, roster: rosterHead({ trialRole: { id: "role-trial", name: "Probe", color: "" }, ...over }) });

function open(props: Partial<Parameters<typeof AddMemberDialog>[0]> = {}) {
    const onClose = vi.fn();
    const onDone = vi.fn();
    renderPage(<AddMemberDialog data={data()} onClose={onClose} onDone={onDone} {...props} />);
    return { onClose, onDone };
}

const ok = (results = [{ roleId: "role-main", roleName: "Raider Mo/Do", give: true, ok: true, code: "done", changed: true }]) =>
    ({ userId: "u-ely", created: true, member: { status: "core", since: "", by: "", chars: [], charNames: {}, note: "", trialUntil: null }, roles: { ok: results.every((r) => r.ok), results } }) as Awaited<ReturnType<typeof api.saveRosterMember>>;

beforeEach(() => {
    vi.mocked(api.searchRosterMembers).mockResolvedValue({ results: RESULTS });
    vi.mocked(api.saveRosterMember).mockResolvedValue(ok());
});
afterEach(() => switchLang("de"));

describe("AddMemberDialog", () => {
    it("searches the server's members; someone in the roster cannot be picked", async () => {
        open();
        expect(screen.getByText("Mitglied hinzufügen")).toBeInTheDocument();
        await userEvent.type(screen.getByRole("searchbox"), "ely");
        await waitFor(() => expect(api.searchRosterMembers).toHaveBeenLastCalledWith({ id: "raid-mo-do-abc", q: "ely" }));
        expect(await screen.findByRole("button", { name: /Thorgrim.*schon im Roster/ })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Elyndra/ })).toBeEnabled();
    });

    it("takes the picked person in with status, the suggested character, trial end and note, and says the role is given", async () => {
        const { onDone, onClose } = open();
        await userEvent.click(await screen.findByRole("button", { name: /Elyndra/ }));
        const chars = screen.getByRole("radiogroup", { name: "Charakter (TBC)" });
        expect(within(chars).getByRole("radio", { name: /Elyndra/ })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("Ins Roster aufnehmen gibt die Discord-Rolle @Raider Mo/Do.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("radio", { name: "Probe" }));
        expect(screen.getByText("Ins Roster aufnehmen gibt die Discord-Rolle @Raider Mo/Do + @Probe.")).toBeInTheDocument();
        await userEvent.click(within(chars).getByRole("radio", { name: /Elytwink/ }));
        await userEvent.type(screen.getByLabelText("Probezeit bis"), "2026-11-01");
        await userEvent.type(screen.getByLabelText("Notiz der Orga"), "Heilt gern");
        await userEvent.click(screen.getByRole("button", { name: "Ins Roster aufnehmen" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-ely", { status: "trial", chars: ["elytwink"], note: "Heilt gern", trialUntil: "2026-11-01" }, "add");
        await waitFor(() => expect(onDone).toHaveBeenCalled());
        expect(onClose).toHaveBeenCalled();
        expect(await screen.findByText("Elyndra ist im Roster · @Raider Mo/Do gegeben")).toBeInTheDocument();
    });

    it("keeps the dialog open with a calm message when the role could not be given", async () => {
        vi.mocked(api.saveRosterMember).mockResolvedValue(ok([{ roleId: "role-main", roleName: "Raider Mo/Do", give: true, ok: false, code: "no_permission", changed: false }]));
        const { onClose } = open();
        await userEvent.click(await screen.findByRole("button", { name: /Elyndra/ }));
        await userEvent.click(screen.getByRole("button", { name: "Ins Roster aufnehmen" }));
        expect(await screen.findByText("Nicht alles hat im Discord geklappt")).toBeInTheDocument();
        expect(screen.getByText(/@Raider Mo\/Do konnte nicht gegeben werden: Dem Bot fehlt das Recht/)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Fertig" }));
        expect(onClose).toHaveBeenCalled();
    });

    it("takes a name typed by hand, and translates a refusal", async () => {
        vi.mocked(api.saveRosterMember).mockRejectedValue({ code: "member_limit", message: "x" });
        open();
        await userEvent.click(await screen.findByRole("button", { name: /Elyndra/ }));
        await userEvent.click(screen.getByRole("radio", { name: "Charakter von Hand zuweisen" }));
        await userEvent.type(screen.getByRole("textbox", { name: "Name des Charakters" }), "Neuling");
        await userEvent.click(screen.getByRole("button", { name: "Ins Roster aufnehmen" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-ely", { status: "core", chars: ["Neuling"] }, "add");
        expect(await screen.findByText("Ein Roster hat höchstens 500 Mitglieder.")).toBeInTheDocument();
    });

    it("starts with the person picked when it comes from the Abgleich tab", async () => {
        open({ prefill: { userId: "u-ely", displayName: "Elyndra" } });
        expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
        expect(screen.getByText("Elyndra", { selector: ".rn-picked b" })).toBeInTheDocument();
        expect(await screen.findByRole("radio", { name: /Elytwink/ })).toBeInTheDocument();
        expect(api.searchRosterMembers).toHaveBeenCalledWith({ id: "raid-mo-do-abc", q: "Elyndra" });
    });

    it("says when the member list cannot be read instead of 'nobody found'", async () => {
        vi.mocked(api.searchRosterMembers).mockRejectedValue({ code: "offline", message: "x" });
        open();
        expect(await screen.findByText("Der Bot ist gerade nicht mit Discord verbunden.")).toBeInTheDocument();
        expect(screen.queryByText("Niemand gefunden.")).not.toBeInTheDocument();
    });

    it("speaks English", async () => {
        await switchLang("en");
        open();
        await userEvent.click(await screen.findByRole("button", { name: /Elyndra/ }));
        expect(screen.getByText("Adding to the roster gives the Discord role @Raider Mo/Do.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add to roster" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Core" })).toHaveAttribute("aria-checked", "true");
    });
});
