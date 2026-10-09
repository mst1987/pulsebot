// The member drawer (#655/#656): status as square fields, characters (order,
// remove, assign, typed by hand), the Discord roles as switches, attendance,
// the note, the person's history, "Aus dem Roster nehmen" behind a question -
// for a manager; read only for a reader; and in English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import MemberDrawer from "./MemberDrawer";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, historyEntry, member, memberChar, rosterHead } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterHistory: vi.fn(),
    saveRosterMember: vi.fn(),
    setRosterRole: vi.fn(),
    removeRosterMember: vi.fn(),
}));

const THORGRIM = member("Thorgrim", {
    userId: "u-thorgrim",
    note: "Kann Druide",
    heldRoles: ["role-main"],
    chars: [memberChar("Thorgrim"), memberChar("Grimbrew", { key: "grimbrew", className: "Druid", classColor: "#FF7D0A", specId: "Feral", specLabel: "Wildheit", specIcon: "ability_racial_bearform" })],
    otherChars: [memberChar("Thorshot", { key: "thorshot", className: "Hunter", specId: "Marksmanship", specLabel: "Treffsicherheit", specIcon: "ability_marksmanship" })],
    attendance: { attended: 2, total: 3, pct: 67, missed: [{ eventId: "e2", title: "BT", startTime: 1900100000, reason: "nicht im Log" }], present: [{ eventId: "e1", title: "BT", startTime: 1900000000 }, { eventId: "e3", title: "BT", startTime: 1900200000 }] },
});

const head = (over = {}) => rosterHead({ allowMultipleChars: true, trialRole: { id: "role-trial", name: "Probe", color: "" }, ...over });

function open(data = detail([THORGRIM], { canManage: true, roster: head() }), onChanged = vi.fn(async () => undefined), onClose = vi.fn()) {
    renderPage(<MemberDrawer data={data} userId="u-thorgrim" onClose={onClose} onChanged={onChanged} />);
    return { onChanged, onClose };
}

const drawer = () => screen.getByRole("complementary", { name: /Mitglied Thorgrim|Member Thorgrim/ });
const saved = (patch = {}) => ({ userId: "u-thorgrim", created: false, member: { status: "core", since: "", by: "", chars: [], charNames: {}, note: "", trialUntil: null, ...patch }, roles: { ok: true, results: [] } }) as Awaited<ReturnType<typeof api.saveRosterMember>>;

beforeEach(() => {
    vi.mocked(api.getRosterHistory).mockResolvedValue({ entries: [historyEntry({ what: "member", detail: "status trial → core" }), historyEntry()], total: 2, offset: 0, limit: 20 });
    vi.mocked(api.saveRosterMember).mockResolvedValue(saved());
});
afterEach(() => switchLang("de"));

describe("MemberDrawer — a manager", () => {
    it("shows the person, the status, the characters, the roles, the attendance, the note and the history", async () => {
        open();
        const d = within(drawer());
        expect(d.getByRole("heading", { name: "Thorgrim" })).toBeInTheDocument();
        expect(d.getByRole("radio", { name: "Stamm" })).toHaveAttribute("aria-checked", "true");
        expect(d.getByText("Grimbrew")).toBeInTheDocument();
        expect(d.getByText("Thorshot")).toBeInTheDocument();
        expect(d.getByRole("switch", { name: /@Raider Mo\/Do/ })).toBeChecked();
        expect(d.getByRole("switch", { name: /@Probe/ })).not.toBeChecked();
        expect(d.getByText("2 von 3 Raids dabei")).toBeInTheDocument();
        expect(d.getByRole("textbox", { name: "Notiz der Orga" })).toHaveValue("Kann Druide");
        expect(await d.findByText("Status Probe → Stamm")).toBeInTheDocument();
        expect(api.getRosterHistory).toHaveBeenCalledWith("raid-mo-do-abc", { userId: "u-thorgrim", limit: 20 });
        expect(d.getByRole("button", { name: /Aus dem Roster nehmen/ })).toBeInTheDocument();
    });

    it("saves a status at once and reloads", async () => {
        const { onChanged } = open();
        await userEvent.click(within(drawer()).getByRole("radio", { name: "Ersatz" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-thorgrim", { status: "bench" }, "update");
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(await screen.findByText(/Gespeichert/)).toBeInTheDocument();
    });

    it("reorders, removes and assigns characters, and one typed by hand", async () => {
        open();
        const d = within(drawer());
        await userEvent.click(d.getByRole("button", { name: "Grimbrew nach oben" }));
        expect(api.saveRosterMember).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-thorgrim", { chars: ["grimbrew", "thorgrim"] }, "update");
        await userEvent.click(d.getByRole("button", { name: "Grimbrew aus diesem Roster nehmen" }));
        expect(api.saveRosterMember).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-thorgrim", { chars: ["thorgrim"] }, "update");
        await userEvent.click(d.getByRole("button", { name: "Zuweisen" }));
        expect(api.saveRosterMember).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-thorgrim", { chars: ["thorgrim", "grimbrew", "thorshot"] }, "update");
        await userEvent.click(d.getByRole("button", { name: "Charakter von Hand zuweisen" }));
        await userEvent.type(d.getByRole("textbox", { name: "Name des Charakters" }), "Neuling");
        await userEvent.click(d.getAllByRole("button", { name: "Zuweisen" }).slice(-1)[0]);
        expect(api.saveRosterMember).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-thorgrim", { chars: ["thorgrim", "grimbrew", "Neuling"] }, "update");
    });

    it("replaces the character when the roster allows only one", async () => {
        open(detail([{ ...THORGRIM, chars: [THORGRIM.chars[0]] }], { canManage: true, roster: head({ allowMultipleChars: false }) }));
        const d = within(drawer());
        expect(d.getByText(/Dieses Roster erlaubt einen Charakter je Person/)).toBeInTheDocument();
        await userEvent.click(d.getByRole("button", { name: "Zuweisen" }));
        expect(api.saveRosterMember).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-thorgrim", { chars: ["thorshot"] }, "update");
    });

    it("gives the trial role by its switch and says calmly when a role write failed", async () => {
        vi.mocked(api.setRosterRole).mockResolvedValue({ result: { roleId: "role-trial", roleName: "Probe", give: true, ok: true, code: "done", changed: true } });
        open();
        await userEvent.click(within(drawer()).getByRole("switch", { name: /@Probe/ }));
        expect(api.setRosterRole).toHaveBeenCalledWith("raid-mo-do-abc", "u-thorgrim", true, "role-trial");
        expect(await screen.findByText("@Probe gegeben")).toBeInTheDocument();

        vi.mocked(api.saveRosterMember).mockResolvedValue({ ...saved({ status: "trial" }), roles: { ok: false, results: [{ roleId: "role-trial", roleName: "Probe", give: true, ok: false, code: "role_too_high", changed: false }] } });
        await userEvent.click(within(drawer()).getByRole("radio", { name: "Probe" }));
        expect(await screen.findByText("Nicht alles hat im Discord geklappt")).toBeInTheDocument();
        expect(screen.getByText(/@Probe konnte nicht gegeben werden: Die Rolle liegt über der höchsten Rolle des Bots/)).toBeInTheDocument();
    });

    it("asks before taking the roster's last role", async () => {
        open();
        await userEvent.click(within(drawer()).getByRole("switch", { name: /@Raider Mo\/Do/ }));
        expect(await screen.findByText("Letzte Rolle des Rosters nehmen?")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
        expect(api.setRosterRole).not.toHaveBeenCalled();
    });

    it("saves the note only on its button", async () => {
        open();
        const note = within(drawer()).getByRole("textbox", { name: "Notiz der Orga" });
        await userEvent.clear(note);
        await userEvent.type(note, "Neu");
        expect(api.saveRosterMember).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Notiz speichern" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-thorgrim", { note: "Neu" }, "update");
    });

    it("takes the person out only after the question, which says the Discord role goes too", async () => {
        vi.mocked(api.removeRosterMember).mockResolvedValue({ userId: "u-thorgrim", removed: true, roles: { ok: true, results: [] } });
        const { onClose, onChanged } = open();
        await userEvent.click(within(drawer()).getByRole("button", { name: /Aus dem Roster nehmen/ }));
        expect(await screen.findByText(/nimmt dabei auch die Discord-Rollen des Rosters \(@Raider Mo\/Do, @Probe\)/)).toBeInTheDocument();
        const dialog = screen.getByText("Thorgrim aus dem Roster nehmen?").closest("dialog") as HTMLElement;
        await userEvent.click(within(dialog).getByRole("button", { name: "Aus dem Roster nehmen" }));
        expect(api.removeRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-thorgrim");
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onChanged).toHaveBeenCalled();
    });

    it("closes on Escape and on the shade", async () => {
        const { onClose } = open();
        await userEvent.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalledTimes(1);
        await userEvent.click(document.querySelector(".rn-shade") as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe("MemberDrawer — a reader", () => {
    it("shows the facts without a control and without the note", async () => {
        const plain = { ...THORGRIM, note: undefined, otherChars: undefined };
        open(detail([plain], { canManage: false, roster: head() }));
        const d = within(drawer());
        expect(d.getByText("nur lesen")).toBeInTheDocument();
        expect(d.getByRole("radio", { name: "Stamm" })).toBeDisabled();
        expect(d.queryByRole("switch")).not.toBeInTheDocument();
        expect(d.getAllByText("hat die Rolle").length).toBeGreaterThan(0);
        expect(d.queryByRole("textbox")).not.toBeInTheDocument();
        expect(d.queryByRole("button", { name: /Aus dem Roster nehmen|Zuweisen|von Hand/ })).not.toBeInTheDocument();
        expect(await d.findByText("Status Probe → Stamm")).toBeInTheDocument();
    });

    it("says so when the person left the roster meanwhile", () => {
        open(detail([], { canManage: true, roster: head() }));
        expect(screen.getByRole("heading", { name: "Nicht mehr im Roster" })).toBeInTheDocument();
    });
});

describe("MemberDrawer — in English", () => {
    it("translates the sections", async () => {
        await switchLang("en");
        open();
        const d = within(drawer());
        for (const text of ["Status in this roster", "Characters in this roster", "Discord roles", "Attendance", "Officers' note", "History"]) expect(d.getByText(text)).toBeInTheDocument();
        expect(d.getByRole("radio", { name: "Bench" })).toBeInTheDocument();
        expect(d.getByText("present in 2 of 3 raids")).toBeInTheDocument();
        expect(d.getByRole("button", { name: /Remove from roster/ })).toBeInTheDocument();
        expect(await d.findByText("Status Trial → Core")).toBeInTheDocument();
    });
});
