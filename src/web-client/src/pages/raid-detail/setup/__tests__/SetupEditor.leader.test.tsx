// One leader per raid in the setup editor (#1036): the crown on the leader's slot, "Leader 1/1" in the bar
// (green with one, red without), the "Leader" chip in "Angemeldet" and "Als Leader setzen" in the raider panel —
// asked first for somebody without the lead flag, saved as `leaderUserId`. The API is mocked at its transport.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupEditorData, SetupPlacementInput, StoredSetup } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, PRIEST, ROGUE, TANK, editorData, person, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";
import { leaderFigure } from "../summaryFigures";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const ZIBBO = person("u-zibbo", "Zibbo");

/** Group 1: Bruno (the leader, when `led`), Ignis; group 2: Lumen; Zibbo in "Angemeldet". Bruno and Zibbo may lead. */
function leaderData({ led = true, candidates = [TANK.userId, ZIBBO.userId] } = {}): SetupEditorData {
    const base = editorData();
    const checks: StoredSetup["checks"] = { ...base.setup!.checks, leader: { count: led ? 1 : 0, ok: led, candidates } };
    return editorData({}, {
        groups: [
            { index: 1, slots: [{ ...TANK, pos: 1, leader: led || undefined }, { ...MAGE, pos: 2 }] },
            { index: 2, slots: [{ ...PRIEST, pos: 1 }] },
        ],
        bench: [ROGUE],
        pool: [ZIBBO],
        checks,
    });
}

let page: SetupEditorData;

beforeEach(() => {
    page = leaderData();
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

async function show() {
    renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
}

function slot(character: string): HTMLElement {
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}

const panel = () => screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
const puts = () => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === "PUT" && p === "/api/raids/setup");

describe("Leader je Raid (#1036)", () => {
    it("crowns only the leader's slot and counts 'Leader 1/1' green in the bar", async () => {
        await show();
        expect(slot("Bruno").querySelector(".se-lead-mark")).not.toBeNull();
        expect(slot("Ignis").querySelector(".se-lead-mark")).toBeNull();
        expect(document.querySelectorAll(".se-lead-mark")).toHaveLength(1);
        const count = document.querySelector<HTMLElement>("[data-count=\"leader\"], .se-count-leader")
            ?? [...document.querySelectorAll<HTMLElement>(".se-bar *")].find((e) => e.children.length < 4 && /Leader\s*1\/1/.test(e.textContent || ""));
        expect(count).toBeTruthy();
    });

    it("says red 'Leader 0/1' without a leader, and nothing at all without a leader rule", () => {
        const none = leaderFigure(leaderData({ led: false }).setup!);
        expect(none).toMatchObject({ key: "leader", value: 0, target: "1", ok: false });
        expect(none!.tip).toBe(t("setup.leader.figureMissing", { count: 2 }));
        expect(leaderFigure(editorData().setup!)).toBeNull();
    });

    it("filters 'Angemeldet' to who may lead", async () => {
        const user = userEvent.setup();
        page = { ...leaderData(), setup: { ...leaderData().setup!, pool: [ZIBBO, person("u-other", "Nobody")] } };
        await show();
        const chip = screen.getByRole("button", { name: new RegExp(t("setup.leader.filter")) });
        expect(chip).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText("Nobody")).toBeInTheDocument();
        await user.click(chip);
        expect(chip).toHaveAttribute("aria-pressed", "true");
        expect(screen.queryByText("Nobody")).toBeNull();
        expect(screen.getAllByText("Zibbo").length).toBeGreaterThan(0);
    });

    it("sets a flagged raider as leader without asking, saved as leaderUserId", async () => {
        const user = userEvent.setup();
        page = leaderData({ led: false, candidates: [MAGE.userId] });
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.set")) }));
        await waitFor(() => expect(puts()).toHaveLength(1));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect((puts()[0][2] as SetupPlacementInput).leaderUserId).toBe(MAGE.userId);
    });

    it("asks first for somebody without the lead flag — and saves nothing when declined", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.set")) }));
        const question = screen.getByRole("dialog");
        expect(within(question).getByText(t("setup.leader.askTitle"))).toBeInTheDocument();
        await user.click(within(question).getByRole("button", { name: t("common.cancel") }));
        expect(puts()).toHaveLength(0);

        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.set")) }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("setup.leader.set") }));
        await waitFor(() => expect(puts()).toHaveLength(1));
        expect((puts()[0][2] as SetupPlacementInput).leaderUserId).toBe(MAGE.userId);
    });

    it("shows the leader's own button as set, doing nothing; no button on the bench", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Bruno"));
        const on = within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.is")) });
        expect(on).toHaveAttribute("aria-pressed", "true");
        await user.click(on);
        expect(puts()).toHaveLength(0);
        await user.click(slot("Schatten"));
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.leader.set")) })).toBeNull();
    });

    it("undoes the orga's leader choice with leaderUserId '' - only on the leader the orga picked", async () => {
        const user = userEvent.setup();
        page = { ...leaderData(), setup: { ...leaderData().setup!, leaderUserId: TANK.userId } };
        await show();
        await user.click(slot("Bruno"));
        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.unset")) }));
        await waitFor(() => expect(puts()).toHaveLength(1));
        expect((puts()[0][2] as SetupPlacementInput).leaderUserId).toBe("");
    });

    it("has no undo button on anybody else", async () => {
        const user = userEvent.setup();
        page = { ...leaderData(), setup: { ...leaderData().setup!, leaderUserId: TANK.userId } };
        await show();
        await user.click(slot("Ignis"));
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.leader.unset")) })).toBeNull();
    });

    it("without a leader rule: no crown, no 'set' and no 'undo' - even with a stored choice", async () => {
        const user = userEvent.setup();
        const plain = editorData();
        page = { ...leaderData(), setup: { ...leaderData({ led: false }).setup!, checks: plain.setup!.checks, leaderUserId: TANK.userId } };
        await show();
        expect(document.querySelectorAll(".se-lead-mark")).toHaveLength(0);
        await user.click(slot("Bruno"));
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.leader.unset")) })).toBeNull();
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.leader.set")) })).toBeNull();
    });

    it("has no undo button when the proposal picked the leader itself", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Bruno"));
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.leader.unset")) })).toBeNull();
    });

    it("shows the crown in the panel head for who leads this raid", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Bruno"));
        expect(panel().querySelector(".se-tip-lead")).not.toBeNull();
    });

    it("shows no crown in the panel head for a raider who does not lead this raid", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        expect(panel().querySelector(".se-tip-lead")).toBeNull();
    });

    it("fills the names into the question - no raw placeholder", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.leader.set")) }));
        const text = screen.getByRole("dialog").textContent || "";
        expect(text).toContain("Ignis");
        expect(text).not.toMatch(/[{}]/);
    });
});
