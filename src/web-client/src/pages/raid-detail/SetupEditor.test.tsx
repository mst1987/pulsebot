// The setup editor of an own event (#263) as the orga uses it: group cards and
// the bench as targets (drag or pick-and-target), the raid size in the bar, the
// compact view, the side column, the state badges, approving and posting, the
// "nicht zusammen" question and the ping text. The API is mocked at its
// transport (api/client), so every test also pins the request that is sent.
// The raider panel, "Suche" and the extra roles: SetupEditor.panel.test.tsx.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { SetupEditorData, SetupPlacementInput } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { EVENT_ID, MAGE, ROGUE, TANK, editorData, person, setupCtx } from "../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

let page: SetupEditorData;

beforeEach(() => {
    page = editorData();
    vi.mocked(client.get).mockImplementation((path: string) => (path.startsWith("/api/raids/setup?")
        ? Promise.resolve(page)
        : Promise.reject({ code: "not_mocked", message: path })));
    // a save answers with the lineup it was sent, one version further
    vi.mocked(client.send).mockImplementation((_method: string, path: string) => (path === "/api/raids/setup/ping-text"
        ? Promise.resolve({ ...page, pingText: "neu" })
        : Promise.resolve({ ...page, setup: page.setup && { ...page.setup, version: page.setup.version + 1 } })));
});

async function show(data: SetupEditorData = page) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });

/** A raider's line: the element that is picked, dragged and dropped on. */
function slot(character: string): HTMLElement {
    // the raider panel repeats the name of the raider touched last; the line is the one with data-user
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}

/** The calls of one request, by method and path. */
function calls(method: string, path: string) {
    return vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);
}

/** The body of the one save request (PUT /api/raids/setup). */
function savedBody(): SetupPlacementInput & { event: string } {
    const put = calls("PUT", "/api/raids/setup");
    expect(put).toHaveLength(1);
    return put[0][2] as SetupPlacementInput & { event: string };
}

const groupOf = (body: SetupPlacementInput, userId: string) => body.groups.find((g) => g.slots.some((s) => s.userId === userId))?.index;

describe("the setup editor: moving raiders", () => {
    it("draws every group with its five places and the bench as cards of a group's size", async () => {
        await show(editorData({}, { bench: [ROGUE, person("b2", "Zwei"), person("b3", "Drei"), person("b4", "Vier"), person("b5", "Fuenf"), person("b6", "Sechs")] }));
        // the event's size decides how many groups are drawn, empty ones too
        for (const i of [1, 2, 3, 4, 5]) expect(group(i)).toBeInTheDocument();
        expect(within(group(1)).getByText("Bruno")).toBeInTheDocument();
        // free places are numbered boxes, never the word "leer"
        expect(within(group(2)).getByText("5")).toBeInTheDocument();
        expect(screen.queryByText(/leer/i)).not.toBeInTheDocument();
        // six on the bench: two bench cards, "Bank 1" and "Bank 2" — never named like a raid group
        const bench = screen.getByRole("region", { name: t("setup.bench.aria") });
        expect(within(bench).getByRole("region", { name: t("setup.bench.chunkTitle", { index: 1 }) })).toBeInTheDocument();
        expect(within(bench).getByRole("region", { name: t("setup.bench.chunkTitle", { index: 2 }) })).toBeInTheDocument();
        expect(t("setup.bench.chunkTitle", { index: 2 })).toBe("Bank 2");
        // the bench sits under the groups
        expect(group(5).compareDocumentPosition(bench) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("moves a picked raider onto the exact free place that is chosen", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        expect(slot("Ignis")).toHaveAttribute("aria-pressed", "true");
        // every free place of another group now offers "Hierher"; the last one of group 2 is place 5
        const here = within(group(2)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) });
        expect(here).toHaveLength(4);
        await user.click(here[3]);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(body.event).toBe(EVENT_ID);
        expect(body.version).toBe(3);
        expect(body.groups.find((g) => g.index === 2)?.slots.find((s) => s.userId === MAGE.userId)?.pos).toBe(5);
    });

    it("moves a raider picked with the keyboard onto the bench, and Escape drops the pick", async () => {
        const user = userEvent.setup();
        await show();
        slot("Bruno").focus();
        await user.keyboard("{Enter}");
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "true");
        await user.keyboard("{Escape}");
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "false");
        expect(client.send).not.toHaveBeenCalled();

        await user.click(slot("Bruno"));
        const benchCard = screen.getByRole("region", { name: t("setup.bench.chunkTitle", { index: 1 }) });
        await user.click(within(benchCard).getByRole("button", { name: t("setup.group.here") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().bench.map((b) => b.userId)).toContain(TANK.userId);
    });

    it("takes a drop on a group card, and a drop on a raider swaps the two", async () => {
        await show();
        fireEvent.drop(group(2), { dataTransfer: { getData: () => ROGUE.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(groupOf(savedBody(), ROGUE.userId)).toBe(2);

        vi.mocked(client.send).mockClear();
        fireEvent.drop(slot("Lumen"), { dataTransfer: { getData: () => TANK.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(groupOf(body, TANK.userId)).toBe(2);
        expect(groupOf(body, "u-priest")).toBe(1);
    });

    it("locks a raider with the small lock, without picking them", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(within(slot("Bruno")).getByRole("button", { name: t("setup.slot.lock") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().groups[0].slots.find((s) => s.userId === TANK.userId)?.locked).toBe(true);
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "false");
    });
});

describe("the setup editor: the bar", () => {
    it("changes the raid size as a number of groups, reshuffles at once and then saves size and lineup", async () => {
        let answerSize: (v: unknown) => void = () => {};
        vi.mocked(client.send).mockImplementation((method: string) => (method === "PATCH"
            ? new Promise((resolve) => { answerSize = resolve; })
            : Promise.resolve({ ...page, event: { ...page.event, size: 5 }, groupCount: 1 })));
        await show();
        const size = screen.getByRole("spinbutton", { name: t("setup.editor.sizeLabel") });
        expect(size).toHaveValue(5);
        expect(t("setup.editor.sizeLabel")).toBe("Gruppen");
        expect(screen.getByText("× 5 = 25 Spieler")).toBeInTheDocument();

        fireEvent.change(size, { target: { value: "1" } });
        // only a typed number: nothing sent, nothing reshuffled yet
        expect(client.send).not.toHaveBeenCalled();
        expect(screen.getByText(t("setup.editor.sizeTotal", { perGroup: 5, size: 5 }))).toBeInTheDocument();
        fireEvent.blur(size);

        // reshuffled in the browser before the server answered: one group left, Lumen on the bench
        await waitFor(() => expect(screen.queryByRole("region", { name: t("setup.group.title", { index: 2 }) })).not.toBeInTheDocument());
        const bench = screen.getByRole("region", { name: t("setup.bench.aria") });
        expect(within(bench).getByText("Lumen")).toBeInTheDocument();
        // the size goes through the event's own PATCH, the lineup follows once it is stored
        expect(calls("PATCH", "/api/raids")[0][2]).toEqual({ id: EVENT_ID, size: 5 });
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(0);
        await act(async () => answerSize({ id: EVENT_ID }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().groups.map((g) => g.index)).toEqual([1]);
    });

    it("offers a compact view, off by default and remembered in the browser", async () => {
        const user = userEvent.setup();
        const view = await show();
        const compact = () => screen.getByRole("button", { name: t("setup.editor.compact") });
        expect(t("setup.editor.compact")).toBe("Kompakt");
        expect(compact()).toHaveAttribute("aria-pressed", "false");
        await user.click(compact());
        expect(compact()).toHaveAttribute("aria-pressed", "true");
        expect(localStorage.getItem("eh-setup-compact")).toBe("1");

        view.unmount();
        await show();
        expect(compact()).toHaveAttribute("aria-pressed", "true");
    });

    it("puts the ping text over the numbers on the left and the raider panel on the right, with no native title anywhere", async () => {
        const { container } = await show();
        const ping = screen.getByRole("textbox", { name: t("setup.pingText.label") });
        const summary = screen.getByRole("complementary", { name: t("setup.summary.aria") });
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(ping.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(summary.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText(t("setup.pingText.hint"))).toBeInTheDocument();
        // tooltips are data-tip, never the browser's title
        expect(container.querySelector("[title]")).toBeNull();
    });

    it("keeps one line per raider: why they stand there is only in the panel", async () => {
        const user = userEvent.setup();
        await show();
        expect(screen.queryByText("Bringt Arkane Brillanz")).not.toBeInTheDocument();
        await user.hover(slot("Ignis"));
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(within(panel).getByText(t("setup.person.tip.why"))).toBeInTheDocument();
        expect(within(panel).getByText("Bringt Arkane Brillanz")).toBeInTheDocument();
        expect(within(slot("Ignis")).queryByText("Bringt Arkane Brillanz")).not.toBeInTheDocument();
    });
});

describe("the setup editor: the side column and the dialogs", () => {
    it("holds roles, buffs, fairness and wishes — no weight sliders", async () => {
        await show();
        const side = screen.getByRole("complementary", { name: t("setup.summary.aria") });
        for (const label of [t("wow.rolePlural.tank"), t("wow.rolePlural.healer"), t("setup.summary.dps"), t("setup.summary.buffs"), t("setup.summary.fairness"), t("setup.summary.wishes")]) {
            expect(within(side).getByText(label)).toBeInTheDocument();
        }
        expect([t("setup.summary.dps"), t("setup.summary.wishes"), t("setup.summary.weights")]).toEqual(["DD", "Wünsche", "Gewichte…"]);
        expect(within(side).getByText("Aus – hier einschalten")).toBeInTheDocument();
        expect(within(side).queryByRole("slider")).not.toBeInTheDocument();
    });

    it("saves the wishes switch through the usual save request", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("checkbox", { name: t("setup.summary.wishesAria") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody()).toMatchObject({ wishes: true, event: EVENT_ID });
    });

    it("opens the weights and the explanation as dialogs from the bar", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.summary.weights") }));
        const weights = screen.getByRole("dialog");
        expect(within(weights).getByText("Gewichte")).toBeInTheDocument();
        expect(within(weights).getAllByRole("slider").length).toBeGreaterThan(5);
        await user.click(within(weights).getByRole("button", { name: t("common.close") }));

        await user.click(screen.getByRole("button", { name: t("setup.editor.explain") }));
        expect(within(screen.getByRole("dialog")).getByText("KI-Begründung")).toBeInTheDocument();
    });
});

describe("the setup editor: state, approval and posting", () => {
    it.each([
        ["an approved setup", { status: "approved" as const }, ["Freigegeben"], ["Entwurf"]],
        ["a setup changed after its approval", { changedSinceApproval: true }, ["geändert seit Freigabe"], ["Freigegeben"]],
        ["a proposal", { origin: "proposal" as const }, ["Entwurf"], ["automatischer Vorschlag"]],
        ["a draft made at the deadline", { origin: "auto" as const }, ["Entwurf", "automatischer Vorschlag"], []],
    ])("says what state %s is in", async (_name, setup, shown, hidden) => {
        await show(editorData({}, setup));
        // (the approve button of an approved setup says "Freigegeben" as well)
        for (const text of shown) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
        for (const text of hidden) expect(screen.queryAllByText(text)).toHaveLength(0);
    });

    it("asks before approving a setup whose checks fail, then approves the version shown", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { checks: { ...editorData().setup!.checks, ok: false } }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.approve") }));
        const question = screen.getByRole("dialog");
        expect(within(question).getByText("Trotzdem freigeben?")).toBeInTheDocument();
        expect(client.send).not.toHaveBeenCalled();
        await user.click(within(question).getByRole("button", { name: t("setup.editor.approve") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/approve")[0][2]).toEqual({ event: EVENT_ID, version: 3 });
    });

    it("approves only after the moves still on their way, with the version the server confirmed", async () => {
        const user = userEvent.setup();
        let answerSave: (v: unknown) => void = () => {};
        vi.mocked(client.send).mockImplementation((method: string) => (method === "PUT"
            ? new Promise((resolve) => { answerSave = resolve; })
            : Promise.resolve(page)));
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(group(2)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) })[0]);
        await user.click(screen.getByRole("button", { name: t("setup.editor.approve") }));
        expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(0);
        await act(async () => answerSave({ ...page, setup: { ...page.setup, version: 4 } }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/approve")[0][2]).toEqual({ event: EVENT_ID, version: 4 });
    });

    it("shows a reader only the approved lineup, without anything to move", async () => {
        page = editorData({ canWrite: false, setup: undefined, approved: { version: 2, approvedAt: 0, approvedBy: "", groups: [{ index: 1, slots: [TANK] }], bench: [] } });
        renderPage(<SetupEditor ctx={setupCtx()} />);
        expect(await screen.findByText("Bruno")).toBeInTheDocument();
        expect(screen.getByText("Bruno").closest("[data-user]")).not.toHaveAttribute("role");
        expect(screen.queryByRole("button", { name: t("setup.editor.approve") })).not.toBeInTheDocument();
        expect(screen.queryByRole("complementary", { name: t("setup.summary.aria") })).not.toBeInTheDocument();
    });

    it("tells a reader when nothing is approved yet", async () => {
        page = editorData({ canWrite: false, setup: undefined, approved: null });
        renderPage(<SetupEditor ctx={setupCtx()} />);
        expect(await screen.findByText(t("setup.readOnly.notApproved"))).toBeInTheDocument();
    });

    it("shows the setup message's state under the bar and posts it with one button", async () => {
        const user = userEvent.setup();
        const publish = { channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: true, recipients: 3, pendingDms: 3, posted: null, outdated: false, error: "", errorAt: 0, dms: null };
        await show(editorData({ publish }, { status: "approved" }));
        expect(screen.getByText(t("setup.publish.notPosted", { channel: "#kara-do" }))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("setup.publishLine.post") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/post")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/post")[0][2]).toEqual({ event: EVENT_ID });
    });

    describe("while the DMs are being sent", () => {
        afterEach(() => { vi.useRealTimers(); });

        it("polls only their state, never the lineup", async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const posted = { messageUrl: "", version: 3, postedAt: 1, editedAt: 0 };
            const publish = { channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: true, recipients: 3, pendingDms: 0, posted, outdated: false, error: "", errorAt: 0, dms: { status: "running" as const, version: 3, at: 1, total: 3, sent: 1, failed: [], unchanged: 0 } };
            await show(editorData({ publish }, { status: "approved" }));
            expect(screen.getByText(new RegExp(t("setup.publish.dmsRunning", { done: 1, total: 3 })))).toBeInTheDocument();
            // meanwhile the server holds another lineup (Bruno on the bench) and the DMs are done
            page = editorData({ publish: { ...publish, dms: { ...publish.dms, status: "done", sent: 3 } } }, { status: "approved", groups: [], bench: [TANK] });
            await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
            await waitFor(() => expect(screen.getByText(new RegExp(t("setup.publish.dmsSent", { count: 3 })))).toBeInTheDocument());
            expect(within(group(1)).getByText("Bruno")).toBeInTheDocument();
        });
    });
});

describe("the setup editor: „nicht zusammen“", () => {
    it("asks once before a proposal when such pairs stand among the signups", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 2 }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.repropose") }));
        const question = await screen.findByRole("dialog");
        expect(within(question).getByText(/2 Raider-Paare/)).toBeInTheDocument();
        await user.click(within(question).getByRole("button", { name: "Nicht berücksichtigen" }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID, avoid: false });
    });

    it("does not ask again once the answer is stored, nor without such pairs", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 2 }, { options: { weights: {}, fairness: false, wishes: false, avoid: true } }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.repropose") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID });
        expect(screen.queryByText(/Raider-Paare/)).not.toBeInTheDocument();
    });

    it("shows a switch with the count in the side column — never who named whom", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 1 }));
        const side = screen.getByRole("complementary", { name: t("setup.summary.aria") });
        const label = within(side).getByText(t("setup.summary.avoid"));
        expect(label.getAttribute("data-tip-sub")).toMatch(/Wer wen genannt hat, sieht niemand/);
        await user.click(within(side).getByRole("checkbox", { name: t("setup.summary.avoidAria") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody()).toMatchObject({ avoid: true });
    });

    it("has no such switch while nobody named anybody", async () => {
        await show();
        expect(screen.queryByRole("checkbox", { name: t("setup.summary.avoidAria") })).not.toBeInTheDocument();
    });
});

describe("the setup editor: the ping text", () => {
    it("saves the edited text on blur to its own endpoint — never per keystroke", async () => {
        const user = userEvent.setup();
        await show();
        const field = screen.getByRole("textbox", { name: t("setup.pingText.label") });
        expect(field).toHaveValue("Setup steht!");
        await user.type(field, " Los");
        expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(0);
        await user.tab();
        await waitFor(() => expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/ping-text")[0][2]).toEqual({ event: EVENT_ID, text: "Setup steht! Los" });
    });

    it("commits on Enter, and an unchanged text is not sent at all", async () => {
        const user = userEvent.setup();
        await show();
        const field = screen.getByRole("textbox", { name: t("setup.pingText.label") });
        await user.click(field);
        await user.keyboard("{Enter}");
        expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(0);
        await user.clear(field);
        await user.type(field, "Invite in 5{Enter}");
        await waitFor(() => expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/ping-text")[0][2]).toEqual({ event: EVENT_ID, text: "Invite in 5" });
    });
});
