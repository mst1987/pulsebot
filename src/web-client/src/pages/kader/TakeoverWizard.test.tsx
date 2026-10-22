// The Kader's takeover into Discord: the four steps of "In Discord übernehmen" on
// the composition page (role → channels → who → result), the switch that unlocks
// the start, the refusals (409 stale, 400), a takeover the server could not
// record, the role icon only where the server can show it, and "Rolle
// nachziehen (n)" in the head — rendered inside the real Kaderplaner against a
// mocked api.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { KaderTakeover, KaderTakeoverCheck, KaderTakeoverStart } from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import { U, kader, kaderView } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    getKaderTakeover: vi.fn(),
    startKaderTakeover: vi.fn(),
    pullKaderTakeoverRole: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const T = (k: string, v?: Record<string, unknown>) => t(`kader.takeover.${k}`, v);

const taken = (over: Partial<KaderTakeover> = {}): KaderTakeover => ({
    rosterId: "forever-raid", roleId: "role1", roleName: "Forever-Kader", categoryId: "cat1", channelIds: ["ch1", "ch2"],
    by: "u1", at: "2026-10-20T18:00:00.000Z", status: "done",
    results: { [U.tank]: "ok", [U.heal]: "ok", [U.sham]: "ok", [U.tent]: "ok" }, ...over,
});

function check(over: Partial<KaderTakeoverCheck> = {}): KaderTakeoverCheck {
    return {
        kader: { id: "k1", name: "Forever-Kader", versionId: "forever", rev: 4 },
        roster: { id: "forever-raid", name: "Forever-Raid", closed: false, roleIds: ["old"] },
        online: true, canManageRoles: true, canManageChannels: true, iconPossible: false, premiumTier: 1,
        blockers: [], notes: [], outsideCount: 2, takeover: null, role: null, category: null, running: false, aborted: false,
        pending: [], pendingCount: 0, pullCount: 0, pendingAway: 0,
        players: [
            { userId: U.heal, state: "provisional", onServer: true, hasRole: null, inRoster: false, result: null },
            { userId: U.tank, state: "roster", characterName: "Aldric Sturmwind", onServer: true, hasRole: null, inRoster: true, result: null },
            { userId: U.sham, state: "bench", onServer: true, hasRole: null, inRoster: false, result: null },
            { userId: U.tent, state: "tentative", onServer: false, hasRole: null, inRoster: false, result: null },
        ],
        categories: [{ id: "c-old", name: "Alte Kategorie" }],
        canStart: true,
        ...over,
    };
}

const STEPS: KaderTakeoverStart["steps"] = [
    { step: "role", ok: true, id: "role1", name: "Forever-Kader", icon: "none" },
    { step: "roster", ok: true },
    { step: "category", ok: true, id: "cat1", name: "forever-kader" },
    { step: "channel", ok: true, id: "ch1", name: "ankündigungen" },
    { step: "channel", ok: false, name: "chat", error: "missing_permissions" },
];

let current: KaderTakeover | undefined;

beforeEach(() => {
    localStorage.clear();
    current = undefined;
    vi.mocked(api.getKader).mockImplementation(async () => kaderView({ kader: kader({ takeover: current }) }));
    vi.mocked(api.getKaderTakeover).mockResolvedValue(check());
});

async function show(route = "/kader/k1/zusammensetzung", user = adminUser()) {
    renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

async function openWizard() {
    await userEvent.click(await screen.findByRole("button", { name: T("entry") }));
    return screen.findByRole("dialog");
}

async function toWho(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getByRole("button", { name: T("next") }));
    await userEvent.click(within(dialog).getByRole("button", { name: T("next") }));
    await within(dialog).findByText(T("title.who"));
}

describe("Kaderplaner · In Discord übernehmen", () => {
    it("goes role → channels → who → result, and starts only after the switch", async () => {
        vi.mocked(api.startKaderTakeover).mockImplementation(async () => {
            current = taken({ status: "running", results: { [U.tank]: "ok", [U.heal]: "ok" } });
            return { takeover: current, steps: STEPS, assigning: 4 };
        });
        await show();
        const dialog = await openWizard();
        // step 1: the role, named after the Kader, replacing the roster's old role
        expect(within(dialog).getByText(T("title.role"))).toBeInTheDocument();
        expect(within(dialog).getByLabelText(T("role.name"))).toHaveValue("Forever-Kader");
        expect(within(dialog).getByText(T("role.becomes", { roster: "Forever-Raid" }), { exact: false })).toBeInTheDocument();
        expect(within(dialog).getByText(T("role.replaces", { count: 1 }), { exact: false })).toBeInTheDocument();
        // an empty name keeps the step
        await userEvent.clear(within(dialog).getByLabelText(T("role.name")));
        expect(within(dialog).getByRole("button", { name: T("next") })).toBeDisabled();
        expect(within(dialog).getByRole("alert")).toHaveTextContent(T("problem.role_name"));
        await userEvent.type(within(dialog).getByLabelText(T("role.name")), "Forever-Kader");
        await userEvent.click(within(dialog).getByRole("button", { name: T("next") }));

        // step 2: a new category and two channels, the announcements only for the orga
        expect(within(dialog).getByText(T("title.channels"))).toBeInTheDocument();
        expect(within(dialog).getByLabelText(T("channels.categoryName"))).toHaveValue("forever-kader");
        expect(within(dialog).getByLabelText(T("channels.name", { n: 1 }))).toHaveValue(T("channels.announce"));
        expect(within(dialog).getAllByRole("switch", { name: T("channels.orgaOnly") }).map((s) => (s as HTMLInputElement).checked)).toEqual([true, false]);
        await userEvent.click(within(dialog).getByRole("button", { name: T("next") }));

        // step 3: who, with the counts in words; the start waits for the switch
        expect(within(dialog).getByText(T("who.count", { count: 4 }))).toBeInTheDocument();
        expect(within(dialog).getByText(T("who.outside", { count: 2 }))).toBeInTheDocument();
        expect(within(dialog).getByText(T("who.away", { count: 1 }))).toBeInTheDocument();
        expect(within(dialog).getByText(T("who.inRoster", { count: 1 }))).toBeInTheDocument();
        expect(within(dialog).getAllByRole("row")).toHaveLength(5);
        const startBtn = within(dialog).getByRole("button", { name: T("start") });
        expect(startBtn).toBeDisabled();
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        expect(startBtn).toBeEnabled();
        await userEvent.click(startBtn);

        expect(api.startKaderTakeover).toHaveBeenCalledWith("k1", {
            baseRev: 4,
            role: { name: "Forever-Kader" },
            category: { name: "forever-kader" },
            channels: [{ name: T("channels.announce"), orgaOnlyWrite: true }, { name: T("channels.chat"), orgaOnlyWrite: false }],
        });
        // step 4: each Discord step, a failed one with its reason, then the hand-out
        await waitFor(() => expect(dialog.querySelector(".dlg-title")).toHaveTextContent(T("title.result")));
        const items = within(dialog).getAllByRole("listitem");
        expect(items.some((li) => li.className.includes("kp-tk-bad") && li.textContent?.includes("chat"))).toBe(true);
        // while the role goes out: the loader with its line, no "0 of n … still open"
        expect(await within(dialog).findByText(T("lineRunning"))).toBeInTheDocument();
        expect(within(dialog).queryByText(T("progress", { given: 2, total: 4 }))).not.toBeInTheDocument();
        expect(within(dialog).queryByText(T("result.open", { count: 2 }), { exact: false })).not.toBeInTheDocument();
        await userEvent.click(within(dialog).getAllByRole("button", { name: T("close") }).at(-1)!);
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("once done shows the final count and names the players not on the server apart, not as open", async () => {
        vi.mocked(api.startKaderTakeover).mockImplementation(async () => {
            current = taken({ results: { [U.tank]: "ok", [U.heal]: "ok", [U.sham]: "ok", [U.tent]: "missing" } });
            return { takeover: current, steps: STEPS, assigning: 4 };
        });
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText(T("progress", { given: 3, total: 4 }))).toBeInTheDocument();
        const sum = within(dialog).getByText(T("result.finished"), { exact: false });
        expect(sum).toHaveTextContent(T("result.missing", { count: 1 }));
        expect(sum).not.toHaveTextContent(T("result.open", { count: 1 }));
        expect(within(dialog).queryByText(T("lineRunning"))).not.toBeInTheDocument();
    });

    it("keeps \"not on the server\" in one short line in the who table, the whole text as tooltip", async () => {
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        const cell = dialog.querySelector(".kp-tk-away");
        expect(cell).toHaveAttribute("data-tip", T("who.notOnServer"));
        expect(cell?.querySelector(".kp-tk-short")).toHaveTextContent(T("who.notOnServerShort"));
    });

    it("offers the role icon only where the server can show one", async () => {
        await show();
        let dialog = await openWizard();
        expect(within(dialog).getByRole("button", { name: T("role.iconPick") })).toBeDisabled();
        expect(within(dialog).getByText(T("role.iconOff", { tier: 1 }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        cleanup();

        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({ iconPossible: true, premiumTier: 2 }));
        await show();
        dialog = await openWizard();
        expect(within(dialog).getByRole("button", { name: T("role.iconPick") })).toBeEnabled();
        expect(within(dialog).getByText(T("role.iconHint"))).toBeInTheDocument();
    });

    it("on 409 stale says so, loads again and wants the switch once more", async () => {
        vi.mocked(api.startKaderTakeover).mockRejectedValue({ code: "stale", message: "stale" });
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        const calls = vi.mocked(api.getKaderTakeover).mock.calls.length;
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText(T("error.stale"))).toBeInTheDocument();
        expect(within(dialog).getByRole("switch", { name: T("who.confirm") })).not.toBeChecked();
        expect(within(dialog).getByRole("button", { name: T("start") })).toBeDisabled();
        await waitFor(() => expect(vi.mocked(api.getKaderTakeover).mock.calls.length).toBeGreaterThan(calls));
    });

    it("says a 400 in its own words, an unknown one with the server's message", async () => {
        vi.mocked(api.startKaderTakeover).mockRejectedValueOnce({ code: "role_too_high", message: "x" }).mockRejectedValueOnce({ code: "brand_new", message: "Discord sagt nein" });
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText(T("error.role_too_high"))).toBeInTheDocument();
        // the switch stays on: nothing changed in the Kader
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText("Discord sagt nein")).toBeInTheDocument();
        expect(within(dialog).getByText(T("title.who"))).toBeInTheDocument();
    });

    it("warns when Discord was changed but the takeover not recorded", async () => {
        vi.mocked(api.startKaderTakeover).mockResolvedValue({ takeover: null, steps: STEPS.slice(0, 2), assigning: 0 });
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText(T("result.notRecorded"))).toBeInTheDocument();
        expect(within(dialog).queryByText(/von \d+ Eingeplanten/)).not.toBeInTheDocument();
    });

    it("locks the entry with the reason when it cannot start", async () => {
        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({ canStart: false }));
        await show();
        const btn = await screen.findByRole("button", { name: T("entry") });
        expect(btn).toBeDisabled();
        expect(btn.closest("[data-tip]")).toHaveAttribute("data-tip", T("blocker.no_rights"));
    });

    it("with a linked roster offers no new roster", async () => {
        await show();
        const dialog = await openWizard();
        expect(within(dialog).queryByLabelText(T("roster.name"))).not.toBeInTheDocument();
        expect(within(dialog).queryByLabelText(T("roster.category"))).not.toBeInTheDocument();
    });
});

describe("Kaderplaner · Übernahme ohne Roster", () => {
    const noRoster = (over: Partial<KaderTakeoverCheck> = {}) => check({
        roster: null, createsRoster: true, notes: ["creates_roster"],
        newRoster: { name: "Forever-Kader", versionId: "forever" },
        rosterCategories: [{ id: "rc1", name: "Donnerstag", suggested: true }, { id: "rc2", name: "Sonntag", suggested: false }],
        ...over,
    });

    it("creates a roster named after the Kader, the raid category optional, and sends both", async () => {
        vi.mocked(api.getKaderTakeover).mockResolvedValue(noRoster());
        vi.mocked(api.startKaderTakeover).mockImplementation(async () => {
            current = taken({ rosterId: "new-roster" });
            return { takeover: current, steps: [{ step: "role", ok: true, id: "role1", name: "Forever-Kader", icon: "none" }, { step: "roster", ok: true, created: true, name: "Forever-Kader" }], assigning: 4 };
        });
        await show();
        const entryTip = (await screen.findByRole("button", { name: T("entry") })).closest("[data-tip-sub]");
        expect(entryTip).toHaveAttribute("data-tip-sub", T("entryTipSubNew"));
        const dialog = await openWizard();
        expect(within(dialog).getByLabelText(T("roster.name"))).toHaveValue("Forever-Kader");
        const cat = within(dialog).getByLabelText(T("roster.category")) as HTMLSelectElement;
        expect(cat).toHaveValue("");
        expect([...cat.options].map((o) => o.textContent)).toEqual([T("roster.noCategory"), T("roster.suggested", { name: "Donnerstag" }), "Sonntag"]);
        expect(within(dialog).getByText(T("role.createsRoster", { roster: "Forever-Kader" }), { exact: false })).toBeInTheDocument();
        // an empty roster name keeps the step
        await userEvent.clear(within(dialog).getByLabelText(T("roster.name")));
        expect(within(dialog).getByRole("button", { name: T("next") })).toBeDisabled();
        expect(within(dialog).getByRole("alert")).toHaveTextContent(T("problem.roster_name"));
        await userEvent.type(within(dialog).getByLabelText(T("roster.name")), "Forever-Raid");
        await userEvent.selectOptions(cat, "rc2");
        await toWho(dialog);
        expect(within(dialog).getByText(T("who.newRosterIn", { roster: "Forever-Raid", category: "Sonntag" }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(api.startKaderTakeover).toHaveBeenCalledWith("k1", expect.objectContaining({ roster: { name: "Forever-Raid", categoryId: "rc2" } }));
        expect(await within(dialog).findByText(T("result.step.rosterCreated"), { exact: false })).toBeInTheDocument();
    });

    it("without a free category keeps the select off and sends no category", async () => {
        vi.mocked(api.getKaderTakeover).mockResolvedValue(noRoster({ rosterCategories: [] }));
        vi.mocked(api.startKaderTakeover).mockResolvedValue({ takeover: null, steps: [], assigning: 0 });
        await show();
        const dialog = await openWizard();
        expect(within(dialog).getByLabelText(T("roster.category"))).toBeDisabled();
        expect(within(dialog).getByText(T("roster.noFreeCategory"))).toBeInTheDocument();
        await toWho(dialog);
        expect(within(dialog).getByText(T("who.newRoster", { roster: "Forever-Kader" }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(api.startKaderTakeover).toHaveBeenCalledWith("k1", expect.objectContaining({ roster: { name: "Forever-Kader", categoryId: null } }));
    });

    it("on 409 roster_linked loads again, drops the new roster and wants the switch once more", async () => {
        vi.mocked(api.getKaderTakeover).mockResolvedValueOnce(noRoster()).mockResolvedValue(check());
        vi.mocked(api.startKaderTakeover).mockRejectedValueOnce({ code: "roster_linked", message: "linked" }).mockResolvedValue({ takeover: null, steps: [], assigning: 0 });
        await show();
        const dialog = await openWizard();
        await toWho(dialog);
        expect(within(dialog).getByText(T("who.newRoster", { roster: "Forever-Kader" }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(await within(dialog).findByText(T("error.roster_linked"))).toBeInTheDocument();
        await waitFor(() => expect(within(dialog).queryByText(T("who.newRoster", { roster: "Forever-Kader" }))).not.toBeInTheDocument());
        expect(within(dialog).getByRole("switch", { name: T("who.confirm") })).not.toBeChecked();
        await userEvent.click(within(dialog).getByRole("switch", { name: T("who.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: T("start") }));
        expect(vi.mocked(api.startKaderTakeover).mock.calls[1][1]).not.toHaveProperty("roster");
    });

    it("locks the entry for anyone but full admins with its own reason", async () => {
        vi.mocked(api.getKaderTakeover).mockResolvedValue(noRoster({ canStart: false, rosterCategories: undefined }));
        await show();
        const btn = await screen.findByRole("button", { name: T("entry") });
        expect(btn).toBeDisabled();
        expect(btn.closest("[data-tip]")).toHaveAttribute("data-tip", T("blocker.admin_only"));
    });
});

describe("Kaderplaner · Kopf nach der Übernahme", () => {
    const waiting = () => taken({ results: { [U.tank]: "ok", [U.sham]: "ok", [U.tent]: "missing" } });

    it("shows role, count and category, and pulls the role after asking", async () => {
        current = waiting();
        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({
            takeover: current, blockers: ["already_taken"], role: { id: "role1", name: "Forever-Kader", color: "#3366cc", gone: false },
            category: { id: "cat1", name: "forever-kader", gone: false }, pending: [U.heal, U.tent], pendingCount: 2, pullCount: 2, pendingAway: 0,
        }));
        vi.mocked(api.pullKaderTakeoverRole).mockImplementation(async () => {
            current = taken();
            return { count: 2, away: 0 };
        });
        await show("/kader/k1/pool");
        expect(await screen.findByText(T("progress", { given: 2, total: 4 }))).toBeInTheDocument();
        expect(screen.getByText(T("lineCategory", { name: "forever-kader" }))).toBeInTheDocument();
        // no entry any more once taken over
        expect(screen.queryByRole("button", { name: T("entry") })).not.toBeInTheDocument();
        await userEvent.click(await screen.findByRole("button", { name: T("pull", { count: 2 }) }));
        const ask = await screen.findByRole("dialog");
        expect(ask).toHaveTextContent(T("pullText", { count: 2 }));
        await userEvent.click(within(ask).getByRole("button", { name: T("pullAction") }));
        expect(api.pullKaderTakeoverRole).toHaveBeenCalledWith("k1");
        expect(await screen.findByText(T("pulled", { count: 2 }))).toBeInTheDocument();
    });

    it("shows no pull button without the right, nor when nobody waits; marks an aborted hand-out", async () => {
        current = waiting();
        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({ takeover: current, canStart: false, aborted: true, pending: [U.heal], pendingCount: 1, pullCount: 1, pendingAway: 0 }));
        await show("/kader/k1/pool");
        expect(await screen.findByText(T("lineAborted"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /nachziehen/ })).not.toBeInTheDocument();
    });

    it("counts only players on the server for the pull; the others as text without a button", async () => {
        current = waiting();
        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({
            takeover: current, blockers: ["already_taken"], role: { id: "role1", name: "Forever-Kader", color: "", gone: false },
            pending: [U.heal, U.tent], pendingCount: 2, pullCount: 1, pendingAway: 1,
        }));
        await show("/kader/k1/pool");
        expect(await screen.findByRole("button", { name: T("pull", { count: 1 }) })).toBeInTheDocument();
        const away = screen.getByText(T("lineAway", { count: 1 }));
        expect(away).toHaveAttribute("data-tip", T("lineAwayTip"));
        cleanup();

        // nobody on the server waits: no green button, only the text
        vi.mocked(api.getKaderTakeover).mockResolvedValue(check({
            takeover: current, blockers: ["already_taken"], role: { id: "role1", name: "Forever-Kader", color: "", gone: false },
            pending: [U.tent], pendingCount: 1, pullCount: 0, pendingAway: 1,
        }));
        await show("/kader/k1/pool");
        expect(await screen.findByText(T("lineAway", { count: 1 }))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /nachziehen/ })).not.toBeInTheDocument();
    });
});
