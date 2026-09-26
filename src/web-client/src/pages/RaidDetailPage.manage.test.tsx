// "Event verwalten" (#288) on the raid detail page as the orga uses it: one
// menu button in the head of an own event (raids write only), every entry a
// dialog or one question — moving with a preview, cancelling with a reason,
// deleting with its switches — plus the head's state badges and "Raider
// eintragen" in the roster. The API is mocked at its transport (api/client), so
// the tests also pin the requests. The rules behind menu and dialogs run in
// lib/eventManage.test.ts.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { ManageInfo, MovePlan, RaidCreateContext, RaidDetailData, SessionUser } from "../api";
import { t } from "../i18n";
import { cancelSummary, manageMenu } from "../lib/eventManage";
import { adminUser, renderPage } from "../test/render";
import { OWN_ID, raidDetail, raidhelperDetail } from "../test/fixtures/raidDetail";
import RaidDetailPage from "./RaidDetailPage";

vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), get: vi.fn(), send: vi.fn() }));

const READER = adminUser({ isAdmin: false, access: { raids: "read" } });

const INFO: ManageInfo = {
    event: {
        id: OWN_ID, title: "Karazhan Donnerstag", startTime: 0, when: "", signupDeadline: 0, status: "active", signupsClosed: false,
        cancel: null, channelId: "ch1", channelName: "kara-do-01-10", categoryId: "c1",
    },
    started: false,
    counts: { attending: 8, size: 10, tentative: 0, bench: 0, absence: 0 },
    recipients: [{ userId: "r1", name: "anna", character: "Anna", status: "signed" }, { userId: "r2", name: "ben", character: "", status: "signed" }],
    archive: { configured: false },
    log: [],
    deletion: { started: false, cancelled: false, signups: 8, recipients: 2, messages: 1, logs: 0, loot: 0, canNotify: true },
};

const PLAN: MovePlan = {
    eventId: OWN_ID, title: "Karazhan Donnerstag",
    from: { startTime: 0, label: "Do 01.10. 19:45" },
    to: { startTime: 0, label: "Fr 02.10. 20:00" },
    signupDeadline: 0, deadlineLabel: "",
    channel: { id: "ch1", current: "kara-do-01-10", next: "kara-fr-02-10", rename: true, label: "aus dem Schema", detail: "", reason: "" },
    recipients: 2,
};

const CREATE_CONTEXT: RaidCreateContext = {
    defaults: { templateId: "", channelId: "" }, categoryTemplates: {}, leaderId: "u1",
    leaderCandidates: [{ id: "u1", name: "Admin" }], channels: [], templates: [], reusableEvents: [],
};

let detail: RaidDetailData;
let info: ManageInfo;

beforeEach(() => {
    detail = raidDetail();
    info = INFO;
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/detail?")) return Promise.resolve(detail);
        if (path.startsWith("/api/raids/manage/move?")) return Promise.resolve(PLAN);
        if (path.startsWith("/api/raids/manage?")) return Promise.resolve(info);
        if (path.startsWith("/api/raids/new")) return Promise.resolve(CREATE_CONTEXT);
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockResolvedValue({ message: "erledigt" });
});

function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname}</output>;
}

async function show(data: RaidDetailData = detail, user: SessionUser = adminUser()) {
    detail = data;
    const view = renderPage(<><RaidDetailPage /><Where /></>, { route: `/raids/detail?event=${data.event.id}`, user });
    await screen.findByRole("heading", { name: data.event.title });
    return view;
}

const manageButton = () => screen.queryByRole("button", { name: t("raidDetail.manage.button") });
const calls = (method: string, path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);

async function choose(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(manageButton()!);
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: new RegExp(label) }));
}

const dialog = () => screen.getByRole("dialog");

describe("the Verwalten menu", () => {
    it("is one button in the head of an own event, opening the menu of lib/eventManage", async () => {
        const user = userEvent.setup();
        await show();
        const button = manageButton()!;
        expect(button).toHaveAttribute("aria-haspopup", "menu");
        // the old separate edit icon is gone — editing is a menu entry (or the step's deed)
        expect(screen.queryByRole("button", { name: "Event bearbeiten" })).not.toBeInTheDocument();
        await user.click(button);
        const expected = manageMenu({ cancelled: false, signupsClosed: false, isPast: false, logCount: 0, invite: false })
            .flatMap((e) => (e === "sep" ? [] : [e.label]));
        // each entry: its label, then the small line saying what it does
        const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent || "");
        expect(items).toHaveLength(expected.length);
        expected.forEach((label, i) => expect(items[i].startsWith(label)).toBe(true));
    });

    it("is not there for somebody who may only read the raids", async () => {
        await show(detail, READER);
        expect(manageButton()).not.toBeInTheDocument();
    });

    it("holds only the raid plan switch on a Raid-Helper event", async () => {
        const user = userEvent.setup();
        await show(raidhelperDetail());
        await user.click(manageButton()!);
        const labels = within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent || "");
        expect(labels.some((l) => l.includes(t("raidDetail.manage.move")))).toBe(false);
        expect(labels.some((l) => l.includes(t("raidDetail.manage.delete")))).toBe(false);
    });

    it.each([
        ["move", "raidManage.move.title"],
        ["raider", "raidManage.raider.title"],
        ["history", "raidManage.history.title"],
        ["cancel", "raidManage.cancel.title"],
        ["delete", "raidManage.delete.title"],
    ])("opens a dialog for %s", async (action, title) => {
        const user = userEvent.setup();
        await show();
        await choose(user, t(`raidDetail.manage.${action}`));
        expect(within(dialog()).getAllByText(t(title)).length).toBeGreaterThan(0);
    });

    it("asks once before closing the signup, then closes it", async () => {
        const user = userEvent.setup();
        await show();
        await choose(user, t("raidDetail.manage.signupsClose"));
        expect(within(dialog()).getByText(t("raidDetail.page.signups.closeTitle"))).toBeInTheDocument();
        expect(client.send).not.toHaveBeenCalled();
        // (the dialog's X is called "Schließen" as well — the action is the one with the word on it)
        const action = t("raidDetail.page.signups.closeAction");
        await user.click(within(dialog()).getAllByRole("button", { name: action }).find((b) => b.textContent === action)!);
        await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
        expect(vi.mocked(client.send).mock.calls[0][2]).toEqual({ event: OWN_ID, open: false });
    });

    it("asks once before taking a cancellation back", async () => {
        const user = userEvent.setup();
        await show(raidDetail({}, { status: "cancelled" }));
        await choose(user, t("raidDetail.manage.reopen"));
        expect(within(dialog()).getByText(t("raidDetail.page.reopen.title"))).toBeInTheDocument();
        await user.click(within(dialog()).getByRole("button", { name: t("common.cancel") }));
        expect(client.send).not.toHaveBeenCalled();

        await choose(user, t("raidDetail.manage.reopen"));
        await user.click(within(dialog()).getByRole("button", { name: t("raidDetail.page.reopen.action") }));
        await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
        expect(vi.mocked(client.send).mock.calls[0][2]).toEqual({ event: OWN_ID });
    });

    it("edits the event with the create dialog", async () => {
        const user = userEvent.setup();
        await show(raidDetail({}, { isPast: false }));
        // editing is the created step's deed on the step bar
        await user.click(screen.getByRole("button", { name: new RegExp(t("raidDetail.steps.deed.edit")) }));
        await waitFor(() => expect(client.get).toHaveBeenCalledWith(`/api/raids/new?event=${OWN_ID}`));
    });
});

describe("the dialogs", () => {
    it("previews a move before it happens and shows the channel's new name", async () => {
        const user = userEvent.setup();
        await show();
        await choose(user, t("raidDetail.manage.move"));
        const confirm = within(dialog()).getByRole("button", { name: t("raidManage.move.confirm") });
        expect(confirm).toBeDisabled();
        expect(await within(dialog()).findByText("Fr 02.10. 20:00")).toBeInTheDocument();
        expect(client.get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/raids\/manage\/move\?event=own1&date=2026-10-01&time=19%3A45$/));
        expect(within(dialog()).getByText("#kara-fr-02-10")).toBeInTheDocument();
        expect(t("raidManage.move.rename")).toBe("Kanal umbenennen");
        const rename = within(dialog()).getByRole("checkbox", { name: t("raidManage.move.rename") });
        expect(rename).toBeChecked();
        await user.click(rename);
        // without the rename the channel keeps its name
        expect(within(dialog()).getByText("#kara-do-01-10")).toBeInTheDocument();
        expect(confirm).toBeEnabled();
        await user.click(confirm);
        await waitFor(() => expect(calls("POST", "/api/raids/manage/move")).toHaveLength(1));
        expect(calls("POST", "/api/raids/manage/move")[0][2]).toEqual({ event: OWN_ID, date: "2026-10-01", time: "19:45", renameChannel: false, notify: true });
    });

    it("wants a reason to cancel, says who gets a DM and offers the archive only when there is one", async () => {
        const user = userEvent.setup();
        await show();
        await choose(user, t("raidDetail.manage.cancel"));
        const confirm = within(dialog()).getByRole("button", { name: t("raidManage.cancel.confirm") });
        await waitFor(() => expect(within(dialog()).getByText(t("raidManage.archive.none"))).toBeInTheDocument());
        expect(confirm).toBeDisabled();
        expect(confirm.className).toMatch(/danger/);
        expect(within(dialog()).getByText(cancelSummary(2, true, false))).toBeInTheDocument();
        expect(within(dialog()).getByText("2").closest("[data-tip-sub]")).toHaveAttribute("data-tip-sub", "Anna, ben");
        await user.type(within(dialog()).getByRole("textbox"), "Zu wenige Heiler");
        expect(confirm).toBeEnabled();
        await user.click(confirm);
        await waitFor(() => expect(calls("POST", "/api/raids/manage/cancel")).toHaveLength(1));
        expect(calls("POST", "/api/raids/manage/cancel")[0][2]).toEqual({ event: OWN_ID, reason: "Zu wenige Heiler", notify: true, archiveChannel: false });
    });

    it("offers the archive switch where an archive is set up", async () => {
        const user = userEvent.setup();
        info = { ...INFO, archive: { configured: true } };
        await show();
        await choose(user, t("raidDetail.manage.cancel"));
        expect(await within(dialog()).findByRole("checkbox", { name: t("raidManage.archive.label") })).not.toBeChecked();
    });

    it("deletes after one dialog, with both switches off and the started-raid switch first, then goes back to the raid list", async () => {
        const user = userEvent.setup();
        info = { ...INFO, archive: { configured: true }, deletion: { ...INFO.deletion, started: true } };
        await show();
        await choose(user, t("raidDetail.manage.delete"));
        const started = await within(dialog()).findByRole("checkbox", { name: t("raidManage.delete.startedLabel") });
        const notify = within(dialog()).getByRole("checkbox", { name: t("raidManage.delete.notifyLabel", { count: 2 }) });
        const archive = within(dialog()).getByRole("checkbox", { name: t("raidManage.archive.label") });
        expect([started, notify, archive].map((c) => (c as HTMLInputElement).checked)).toEqual([false, false, false]);
        const confirm = within(dialog()).getByRole("button", { name: t("raidManage.delete.confirm") });
        expect(confirm).toBeDisabled();
        await user.click(started);
        expect(confirm).toBeEnabled();
        await user.click(confirm);
        await waitFor(() => expect(calls("POST", "/api/raids/manage/delete")).toHaveLength(1));
        expect(calls("POST", "/api/raids/manage/delete")[0][2]).toMatchObject({ event: OWN_ID, notify: false, archiveChannel: false, confirmStarted: true });
        await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/raids$/));
    });

    it("offers no DM when deleting a raid nobody can be told about", async () => {
        const user = userEvent.setup();
        info = { ...INFO, deletion: { ...INFO.deletion, canNotify: false } };
        await show();
        await choose(user, t("raidDetail.manage.delete"));
        await within(dialog()).findByText(t("raidManage.archive.none"));
        expect(within(dialog()).queryByRole("checkbox", { name: t("raidManage.delete.notifyLabel", { count: 2 }) })).not.toBeInTheDocument();
        expect(within(dialog()).getByRole("button", { name: t("raidManage.delete.confirm") })).toBeEnabled();
    });
});

describe("the head and the roster of an own event", () => {
    it("marks a cancelled event", async () => {
        await show(raidDetail({}, { status: "cancelled", cancelReason: "Zu wenige" }));
        expect(t("raidDetail.hero.cancelled")).toBe("abgesagt");
        const badge = screen.getAllByText("abgesagt").find((e) => e.closest("[data-tip]"));
        expect(badge?.closest("[data-tip-sub]")).toHaveAttribute("data-tip-sub", "Zu wenige");
        expect(screen.queryByText(t("raidDetail.hero.signupsClosed"))).not.toBeInTheDocument();
    });

    it("marks a closed signup", async () => {
        await show(raidDetail({}, { signupsClosed: true }));
        expect(t("raidDetail.hero.signupsClosed")).toBe("Anmeldung geschlossen");
        expect(screen.getByText("Anmeldung geschlossen")).toBeInTheDocument();
    });

    it("offers Raider eintragen in the roster to the orga, which opens its dialog", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: t("raidDetail.roster.addRaider") }));
        expect(within(dialog()).getByText(t("raidManage.raider.title"))).toBeInTheDocument();
    });

    it("does not offer Raider eintragen for a cancelled event or to a reader", async () => {
        const view = await show(raidDetail({}, { status: "cancelled" }));
        expect(screen.queryByRole("button", { name: t("raidDetail.roster.addRaider") })).not.toBeInTheDocument();
        view.unmount();
        await show(raidDetail(), READER);
        expect(screen.queryByRole("button", { name: t("raidDetail.roster.addRaider") })).not.toBeInTheDocument();
    });
});
