// Even raids (#1038): the tabs of a raid group show a calm strength per raid and one
// summary in the meta line, red only for the clearly weaker raid. Without strength
// data nothing is shown. The API is mocked at its transport.
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { RaidGroup, SetupBalanceCheck, SetupEditorData } from "../../../../api";
import { t } from "../../../../i18n";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { EVENT_ID, editorData, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";
import { WEAKER_BY, raidBalance, underfilledRaid, weightLabels } from "../setupText";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const GROUP: RaidGroup = {
    id: EVENT_ID, primaryId: EVENT_ID, count: 2, places: 20,
    raids: [
        { id: EVENT_ID, title: "Kara 1", index: 1, size: 10, placed: 10, status: "draft", approved: false, posted: false, cancelled: false },
        { id: "ev2", title: "Kara 2", index: 2, size: 10, placed: 10, status: "draft", approved: false, posted: false, cancelled: false },
    ],
};

const check = (a: number | null, b: number | null, known = 20, placedB = 10): SetupBalanceCheck => ({
    spread: a !== null && b !== null ? Math.abs(a - b) : 0, known,
    raids: [{ eventId: EVENT_ID, strength: a, placed: 10, size: 10 }, { eventId: "ev2", strength: b, placed: placedB, size: 10 }],
});
const full = (eventId: string, strength: number) => ({ eventId, strength, placed: 10, size: 10 });

let page: SetupEditorData;
beforeEach(() => {
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

async function show(balance?: SetupBalanceCheck, group: RaidGroup = GROUP) {
    const base = editorData();
    page = editorData({ raidGroup: group },{ checks: { ...base.setup!.checks, ...(balance ? { balance } : {}) } });
    renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return screen.getByRole("tablist", { name: t("setup.raidGroup.aria") });
}

describe("raidBalance (#1038)", () => {
    it("is null without data, with one raid or without a known raider", () => {
        expect(raidBalance(undefined)).toBeNull();
        expect(raidBalance(check(60, 40, 0))).toBeNull();
        expect(raidBalance({ spread: 0, known: 3, raids: [full("a", 50)] })).toBeNull();
        expect(raidBalance(check(60, null))).toBeNull();
    });

    it("marks a raid only when it lies WEAKER_BY points below the mean of the others", () => {
        expect(raidBalance(check(60, 60 - WEAKER_BY + 1))!.weakId).toBeNull();
        expect(raidBalance(check(60, 60 - WEAKER_BY))!.weakId).toBe("ev2");
        const three: SetupBalanceCheck = { spread: 30, known: 30, raids: [full("a", 70), full("b", 40), full("c", 65)] };
        expect(raidBalance(three)).toEqual({ byId: { a: 70, b: 40, c: 65 }, weakId: "b" });
    });

    it("names no weaker raid while one is not filled (underfilled before weaker)", () => {
        expect(raidBalance(check(62, 40, 20, 7))).toEqual({ byId: { [EVENT_ID]: 62, ev2: 40 }, weakId: null });
    });

    it("names the first raid that is not filled yet", () => {
        expect(underfilledRaid(undefined)).toBeNull();
        expect(underfilledRaid(check(60, 50))).toBeNull();
        expect(underfilledRaid(check(60, 50, 20, 7))).toEqual({ eventId: "ev2", placed: 7, size: 10 });
    });

    it("has a slider label for the weight", () => {
        expect(weightLabels().some((w) => w.key === "balance" && w.label === t("setup.weights.balance.label"))).toBe(true);
    });
});

describe("strength in the raid tabs (#1038)", () => {
    it("shows nothing without strength data", async () => {
        const tabs = await show();
        expect(within(tabs).queryAllByTestId("se-raidtab-strength")).toHaveLength(0);
        expect(within(tabs).queryByTestId("se-raidtabs-balance")).toBeNull();
    });

    it("shows a calm number per raid and the even summary when even", async () => {
        const tabs = await show(check(55, 52));
        const values = within(tabs).getAllByTestId("se-raidtab-strength");
        expect(values.map((v) => v.textContent)).toEqual([t("setup.raidGroup.strength", { value: 55 }), t("setup.raidGroup.strength", { value: 52 })]);
        values.forEach((v) => expect(v).not.toHaveClass("se-weak"));
        const summary = within(tabs).getByTestId("se-raidtabs-balance");
        expect(summary).toHaveTextContent(t("setup.raidGroup.balanced"));
        expect(summary).not.toHaveClass("se-weak");
        expect(summary).toHaveAttribute("data-tip-side", "right");
        values.forEach((v) => expect(v).toHaveAttribute("data-tip", t("setup.raidGroup.strengthTip")));
    });

    it("does not call the raids even while one is not filled", async () => {
        const tabs = await show(check(55, 52, 20, 7));
        const summary = within(tabs).getByTestId("se-raidtabs-balance");
        expect(summary).toHaveTextContent(t("setup.raidGroup.underfilled", { name: "Kara 2", placed: 7, size: 10 }));
        expect(summary).not.toHaveTextContent(t("setup.raidGroup.balanced"));
        expect(summary).not.toHaveClass("se-weak");
    });

    it("names the clearly weaker raid, red only there", async () => {
        const tabs = await show(check(62, 40));
        const [a, b] = within(tabs).getAllByTestId("se-raidtab-strength");
        expect(a).not.toHaveClass("se-weak");
        expect(b).toHaveClass("se-weak");
        const summary = within(tabs).getByTestId("se-raidtabs-balance");
        expect(summary).toHaveTextContent(t("setup.raidGroup.weaker", { name: "Kara 2" }));
        expect(summary).toHaveClass("se-weak");
    });

    it("shows the open places, not red, when the weak raid is just not filled (3 raids, raid 3 at 5/10)", async () => {
        // the review case: 30 raiders alternating ilvl 110/140, raid 3 holds only 5 - its strength
        // (34) lies 12 below the others (46) only because places are open
        const three: RaidGroup = {
            ...GROUP, count: 25, places: 30,
            raids: [...GROUP.raids, { id: "ev3", title: "Kara 3", index: 3, size: 10, placed: 5, status: "draft", approved: false, posted: false, cancelled: false }],
        };
        const balance: SetupBalanceCheck = {
            spread: 12, known: 25,
            raids: [full(EVENT_ID, 46), full("ev2", 46), { eventId: "ev3", strength: 34, placed: 5, size: 10 }],
        };
        const tabs = await show(balance, three);
        const values = within(tabs).getAllByTestId("se-raidtab-strength");
        expect(values.map((v) => v.textContent)).toEqual([46, 46, 34].map((value) => t("setup.raidGroup.strength", { value })));
        values.forEach((v) => expect(v).not.toHaveClass("se-weak"));
        const summary = within(tabs).getByTestId("se-raidtabs-balance");
        expect(summary).toHaveTextContent(t("setup.raidGroup.underfilled", { name: "Kara 3", placed: 5, size: 10 }));
        expect(summary).not.toHaveTextContent(t("setup.raidGroup.weaker", { name: "Kara 3" }));
        expect(summary).not.toHaveClass("se-weak");
    });

    it("speaks English", async () => {
        await switchLang("en");
        try {
            const tabs = await show(check(62, 40));
            expect(within(tabs).getByTestId("se-raidtabs-balance")).toHaveTextContent("Kara 2 clearly weaker");
            expect(within(tabs).getAllByTestId("se-raidtab-strength")[0]).toHaveTextContent("Strength 62");
            expect(within(tabs).getAllByTestId("se-raidtab-strength")[0]).toHaveAttribute("data-tip", "Strength 0–100 from the gear and attendance of the placed raiders");
        } finally {
            await switchLang("de");
        }
    });
});
