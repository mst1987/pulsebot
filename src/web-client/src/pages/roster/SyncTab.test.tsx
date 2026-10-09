// The Abgleich tab (#656): four cards with one button per row, the bulk
// "Allen n die Rolle geben", taking a role behind a question, the profile's
// suggestion, a log character given to a person or hidden, the notes (only the
// roster's roles, mirrored roles, no member list) - read only for a reader, English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import SyncTab from "./SyncTab";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, member, memberChar, sync } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    setRosterRole: vi.fn(),
    saveRosterMember: vi.fn(),
    removeRosterMember: vi.fn(),
    setRosterHidden: vi.fn(),
}));

const MEMBERS = [
    member("Kaelthor", { userId: "u-kael", hasRole: false, chars: [memberChar("Kaelthor", { className: "Shaman" })] }),
    member("Brakk", { userId: "u-brakk", status: "trial", hasRole: false }),
    member("Syl", { userId: "u-syl", chars: [] }),
];

const FULL = sync({
    inRosterWithoutRole: [{ userId: "u-brakk", displayName: "Brakk", status: "trial" }, { userId: "u-kael", displayName: "Kaelthor", status: "core" }],
    roleWithoutRoster: [{ userId: "u-ely", displayName: "Elyndra", takeFailed: true }],
    withoutChar: [{ userId: "u-syl", displayName: "Syl", suggestion: { key: "sylvana", name: "Sylvana", className: "Warlock" } }],
    logCharsWithoutPerson: [{ key: "zarok", character: "Zarok", className: "Warrior", nights: 6, lastSeen: 1900000000, claimedBy: [{ userId: "u-kael", name: "Kaelthor" }] }],
});

function open(s = FULL, over = {}) {
    const props = { onChanged: vi.fn(), onAdd: vi.fn(), onOpen: vi.fn(), ...over };
    renderPage(<SyncTab data={detail(MEMBERS, { canManage: s.canManage })} sync={s} {...props} />);
    return props;
}

const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const row = (c: HTMLElement, name: string) => within(c).getByText(name).closest(".rn-sync-row") as HTMLElement;

beforeEach(() => {
    vi.mocked(api.setRosterRole).mockImplementation(async (rosterId, userId, give, roleId) => ({ result: { roleId: roleId || "role-main", roleName: "Raider Mo/Do", give, ok: true, code: "done", changed: true } }));
    vi.mocked(api.saveRosterMember).mockResolvedValue({ userId: "", created: false, member: { status: "core", since: "", by: "", chars: [], charNames: {}, note: "", trialUntil: null }, roles: { ok: true, results: [] } });
    vi.mocked(api.setRosterHidden).mockResolvedValue({ character: "Zarok", hidden: true });
});
afterEach(() => switchLang("de"));

describe("SyncTab — a manager", () => {
    it("draws four cards with their counts and the note that only this roster's roles change", () => {
        open();
        expect(screen.getByText(/Der Bot ändert hier nur die Rollen dieses Rosters: @Raider Mo\/Do/)).toBeInTheDocument();
        expect(within(card("Im Roster, aber ohne Discord-Rolle")).getByText("2 Personen")).toBeInTheDocument();
        expect(within(card("Hat die Rolle, ist aber nicht im Roster")).getByText("1 Person")).toBeInTheDocument();
        expect(within(card("Im Roster, aber ohne Charakter")).getByText("1 Person")).toBeInTheDocument();
        expect(within(card("In den Logs dieser Kategorie, aber keiner Person zugeordnet")).getByText("1 Charakter")).toBeInTheDocument();
    });

    it("gives the role to one person and to all at once", async () => {
        const { onChanged } = open();
        const c = card("Im Roster, aber ohne Discord-Rolle");
        await userEvent.click(within(row(c, "Brakk")).getByRole("button", { name: "Rolle geben" }));
        expect(api.setRosterRole).toHaveBeenCalledWith("raid-mo-do-abc", "u-brakk", true);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        await userEvent.click(within(c).getByRole("button", { name: "Allen 2 die Rolle geben" }));
        await waitFor(() => expect(api.setRosterRole).toHaveBeenCalledTimes(3));
        expect(api.setRosterRole).toHaveBeenLastCalledWith("raid-mo-do-abc", "u-kael", true);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    });

    it("takes a holder in through the add dialog, or takes the role after a question", async () => {
        const { onAdd, onChanged } = open();
        const r = row(card("Hat die Rolle, ist aber nicht im Roster"), "Elyndra");
        expect(within(r).getByText("Der Bot konnte ihr die Rolle beim Entfernen nicht nehmen")).toBeInTheDocument();
        await userEvent.click(within(r).getByRole("button", { name: "Ins Roster aufnehmen" }));
        expect(onAdd).toHaveBeenCalledWith({ userId: "u-ely", displayName: "Elyndra" });
        await userEvent.click(within(r).getByRole("button", { name: "Rolle nehmen" }));
        const dialog = (await screen.findByText("Elyndra die Rolle nehmen?")).closest("dialog") as HTMLElement;
        await userEvent.click(within(dialog).getByRole("button", { name: "Rolle nehmen" }));
        await waitFor(() => expect(api.setRosterRole).toHaveBeenCalledWith("raid-mo-do-abc", "u-ely", false, "role-main"));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it("takes the profile's suggestion or opens the member to pick another", async () => {
        const { onOpen } = open();
        const r = row(card("Im Roster, aber ohne Charakter"), "Syl");
        expect(within(r).getByText("Sylvana")).toBeInTheDocument();
        await userEvent.click(within(r).getByRole("button", { name: "Vorschlag übernehmen" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-syl", { chars: ["sylvana"] }, "update");
        await userEvent.click(within(r).getByRole("button", { name: "Anderen wählen" }));
        expect(onOpen).toHaveBeenCalledWith("u-syl");
    });

    it("gives a log character to a member (the profile's owner first) or hides it", async () => {
        open();
        const r = row(card("In den Logs dieser Kategorie, aber keiner Person zugeordnet"), "Zarok");
        expect(within(r).getByText(/in 6 Raids im Log/)).toBeInTheDocument();
        await userEvent.click(within(r).getByRole("button", { name: "Person zuordnen" }));
        const dialog = (await screen.findByText("Wer spielt Zarok?")).closest("dialog") as HTMLElement;
        const options = within(dialog).getAllByRole("button", { pressed: false });
        expect(options[0]).toHaveTextContent("Kaelthor");
        expect(options[0]).toHaveTextContent("im Profil");
        await userEvent.click(options[0]);
        expect(within(dialog).getByText("Dieses Roster erlaubt einen Charakter je Person: Kaelthor wird ersetzt.")).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Zuordnen" }));
        expect(api.saveRosterMember).toHaveBeenCalledWith("raid-mo-do-abc", "u-kael", { chars: ["Zarok"] }, "update");
        await userEvent.click(within(r).getByRole("button", { name: "Ausblenden" }));
        expect(api.setRosterHidden).toHaveBeenCalledWith("Zarok", true);
    });

    it("warns about mirrored roles, a missing member list and a missing permission", () => {
        open(sync({
            membersError: "offline",
            mirrored: [{ roleId: "role-main", otherRoleId: "x", direction: "both", side: "event", incoming: true, outgoing: true }],
        }));
        expect(screen.getByText(/auf den anderen Server übertragen/)).toBeInTheDocument();
        expect(screen.getByText(/kommt per Rollen-Abgleich vom anderen Server/)).toBeInTheDocument();
        expect(screen.getByText(/Der Bot ist gerade nicht mit Discord verbunden. Wer die Rolle hat/)).toBeInTheDocument();
        expect(screen.getAllByText("Nichts zu tun.")).toHaveLength(4);
    });
});

describe("SyncTab — someone not on the server", () => {
    it("gets no \"Rolle geben\", only \"Aus dem Roster nehmen\", and does not count for all", () => {
        const members = [MEMBERS[0], { ...MEMBERS[1], onServer: false }, MEMBERS[2]];
        renderPage(<SyncTab data={detail(members, { canManage: true })} sync={FULL} onChanged={vi.fn()} onAdd={vi.fn()} onOpen={vi.fn()} />);
        const brakk = row(card("Im Roster, aber ohne Discord-Rolle"), "Brakk");
        expect(within(brakk).queryByRole("button", { name: "Rolle geben" })).not.toBeInTheDocument();
        expect(within(brakk).getByRole("button", { name: "Aus dem Roster nehmen" })).toBeInTheDocument();
        expect(within(brakk).getByText(/nicht auf dem Server/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Allen \d+ die Rolle geben/ })).not.toBeInTheDocument();
    });
});

describe("SyncTab — a reader", () => {
    it("shows the lists without a button", () => {
        open({ ...FULL, canManage: false });
        expect(screen.getByText("Brakk")).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
});

describe("SyncTab — in English", () => {
    it("translates the cards and buttons", async () => {
        await switchLang("en");
        open();
        expect(screen.getByRole("heading", { name: "In the roster, but without the Discord role" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Give the role to all 2" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Give role" })).toHaveLength(2);
        expect(screen.getByRole("button", { name: "Use suggestion" })).toBeInTheDocument();
    });
});
