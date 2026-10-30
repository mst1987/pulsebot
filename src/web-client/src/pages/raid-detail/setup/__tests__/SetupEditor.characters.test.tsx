// Several characters per raider (#293) in the setup editor: "Angemeldet" shows ONE
// card per person with every signed character, a drag or pick of a further
// character places exactly that one, "Charakter wechseln" in the raider panel
// switches a placed raider without taking them out. The API is mocked at its
// transport (api/client), so the tests pin the requests. The moves behind it:
// lib/signups/__tests__/setupEditor.characters.test.ts.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupCharacter, SetupEditorData, SetupPlacementInput } from "../../../../api";
import { t } from "../../../../i18n";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, PRIEST, TANK, editorData, person, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const char = (character: string, spec: string, role: SetupCharacter["role"], priority: number, extra: Partial<SetupCharacter> = {}): SetupCharacter => ({
    character, spec, role, priority, status: "signed", classId: spec.split("-")[0], classColor: "#ffffff", classLabel: "", specLabel: "", specIcon: "", ...extra,
});

/** Zibbo: a holy priest first, then the protection warrior Zibbowar (late) and the fire mage Zibbomage. */
const ZIBBO_CHARS = [
    char("Zibbo", "priest-holy", "healer", 0, { specLabel: "Heilig" }),
    char("Zibbowar", "warrior-protection", "tank", 1, { specLabel: "Schutz", status: "late" }),
    char("Zibbomage", "mage-fire", "ranged", 2, { specLabel: "Feuer" }),
];
const ZIBBO = person("u-zibbo", "Zibbo", { classId: "priest", spec: "priest-holy", role: "healer", specLabel: "Heilig", characters: ZIBBO_CHARS });
const ROGUE = person("u-solo", "Messer", { classId: "rogue", spec: "rogue-combat", role: "melee", specLabel: "Kampf" });

let page: SetupEditorData;

beforeEach(() => {
    page = editorData();
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve({ ...page, setup: page.setup && { ...page.setup, version: page.setup.version + 1 } }));
});

async function show(data: SetupEditorData) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

const pool = () => screen.getByRole("region", { name: t("setup.pool.aria") });
const block = (role: string) => within(pool()).getByRole("group", { name: t(`setup.poolPanel.sections.${role}`) });
const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });
const panel = () => screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
const calls = (method: string, path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);
/** A further character's line in "Angemeldet" (inside one block, when given). */
const line = (character: string, inside: HTMLElement = pool()) => {
    const el = inside.querySelector<HTMLElement>(`.se-alt[data-character="${character}"]`);
    if (!el) throw new Error(`no line for ${character}`);
    return el;
};
const saved = () => {
    const put = calls("PUT", "/api/raids/setup");
    expect(put).toHaveLength(1);
    return put[0][2] as SetupPlacementInput;
};
const slotOf = (body: SetupPlacementInput, userId: string) => body.groups.flatMap((g) => g.slots).find((s) => s.userId === userId);

/** Group 1: Bruno, Ignis; group 2: Lumen — and Zibbo and Messer in "Angemeldet". */
const withPool = () => editorData({}, { pool: [ZIBBO, ROGUE] });

describe("Angemeldet: one card per person with every signed character", () => {
    it("shows the further characters under the first, quiet, with their order number and an own status dot", async () => {
        await show(withPool());
        const healers = block("healer");
        // the card's line: the first character, number 1
        expect(within(healers).getByText("Zibbo")).toBeInTheDocument();
        const war = line("Zibbowar", healers);
        expect(war).toHaveTextContent("Zibbowar");
        expect(war).toHaveTextContent("Schutz");
        expect(war).toHaveTextContent("2");
        expect(line("Zibbomage", healers)).toHaveTextContent("3");
        // "Spät" differs from the card's line: its own dot
        expect(within(war).getByRole("img", { name: t("signups.status.late") })).toBeInTheDocument();
        expect(within(line("Zibbomage", healers)).queryByRole("img")).not.toBeInTheDocument();
    });

    it("lists a person in every role block one of their characters fits, led there by it — the head counts persons", async () => {
        await show(withPool());
        // two persons, not four characters
        expect(within(pool()).getByText("2", { selector: ".se-pp-count" })).toBeInTheDocument();
        // the tank block is led by Zibbowar, the priest stands under it
        const tanks = block("tank");
        expect(tanks.querySelector(".se-slot .se-name")).toHaveTextContent("Zibbowar");
        expect(line("Zibbo", tanks)).toBeInTheDocument();
        expect(block("ranged").querySelector(".se-slot .se-name")).toHaveTextContent("Zibbomage");
        expect(block("melee").querySelector(".se-slot .se-name")).toHaveTextContent("Messer");
        // the role chips count persons who have a character for the role
        const chip = (f: string) => within(pool()).getByRole("button", { name: new RegExp(`^${t(`setup.poolPanel.filters.${f}`)}`) });
        expect(chip("all")).toHaveTextContent("2");
        expect(chip("tank")).toHaveTextContent("1");
        expect(chip("dps")).toHaveTextContent("2");
        await userEvent.setup().click(chip("tank"));
        expect(within(pool()).queryByRole("group", { name: t("setup.poolPanel.sections.healer") })).not.toBeInTheDocument();
        expect(block("tank")).toBeInTheDocument();
    });

    it("finds a person by any of their characters", async () => {
        const user = userEvent.setup();
        await show(withPool());
        await user.type(within(pool()).getByRole("searchbox", { name: t("setup.poolPanel.search") }), "zibbomage");
        expect(within(pool()).getAllByText("Zibbomage").length).toBeGreaterThan(0);
        expect(within(pool()).queryByText("Messer")).not.toBeInTheDocument();
    });
});

describe("placing a further character", () => {
    it("drags exactly that character into a group: its name, spec and role, locked", async () => {
        await show(withPool());
        fireEvent.dragStart(line("Zibbowar", block("healer")), { dataTransfer: { setData: () => undefined } });
        await act(() => new Promise((r) => setTimeout(r, 5)));
        fireEvent.drop(group(2), { dataTransfer: { getData: () => ZIBBO.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(slotOf(saved(), ZIBBO.userId)).toMatchObject({ character: "Zibbowar", spec: "warrior-protection", role: "tank", locked: true });
    });

    it("drags the leading line of a block as that block's character", async () => {
        await show(withPool());
        const lead = block("ranged").querySelector<HTMLElement>(".se-slot")!;
        fireEvent.dragStart(lead, { dataTransfer: { setData: () => undefined } });
        await act(() => new Promise((r) => setTimeout(r, 5)));
        fireEvent.drop(group(3), { dataTransfer: { getData: () => ZIBBO.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(slotOf(saved(), ZIBBO.userId)).toMatchObject({ character: "Zibbomage", spec: "mage-fire", role: "ranged" });
    });

    it("places it without a mouse: pick the line, then a free place", async () => {
        const user = userEvent.setup();
        await show(withPool());
        line("Zibbomage", block("healer")).focus();
        await user.keyboard("{Enter}");
        expect(line("Zibbomage", block("healer"))).toHaveAttribute("aria-pressed", "true");
        await user.click(within(group(2)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) })[0]);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(slotOf(saved(), ZIBBO.userId)).toMatchObject({ character: "Zibbomage", spec: "mage-fire", role: "ranged", locked: true });
        // one seat: the person is in the request once
        expect(saved().groups.flatMap((g) => g.slots).filter((s) => s.userId === ZIBBO.userId)).toHaveLength(1);
    });
});

describe("Charakter wechseln — a placed raider plays another signed character", () => {
    it("lists the other characters in the raider panel and switches without taking them out", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { groups: [{ index: 1, slots: [{ ...TANK, pos: 1 }, { ...ZIBBO, pos: 4 }] }, { index: 2, slots: [{ ...PRIEST, pos: 1 }, { ...MAGE, pos: 2 }] }], bench: [] }));
        const zibbo = within(group(1)).getByText("Zibbo").closest<HTMLElement>("[data-user]")!;
        await user.click(zibbo);
        expect(within(panel()).getByText(t("setup.chars.switch"))).toBeInTheDocument();
        expect(within(panel()).queryByRole("button", { name: new RegExp("^" + t("setup.chars.switchTo", { character: "Zibbo", spec: ".*" })) })).not.toBeInTheDocument();
        await user.click(within(panel()).getByRole("button", { name: t("setup.chars.switchTo", { character: "Zibbowar", spec: "Schutz" }) }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(slotOf(saved(), ZIBBO.userId)).toEqual({ userId: ZIBBO.userId, character: "Zibbowar", spec: "warrior-protection", role: "tank", locked: true, pos: 4 });
    });

    it("switches the character waiting on the bench, and offers nothing for somebody with one character", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { groups: [{ index: 1, slots: [{ ...TANK, pos: 1 }] }], bench: [ZIBBO] }));
        await user.click(screen.getByText("Zibbo").closest<HTMLElement>("[data-user]")!);
        await user.click(within(panel()).getByRole("button", { name: t("setup.chars.switchTo", { character: "Zibbomage", spec: "Feuer" }) }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(saved().bench).toEqual([{ userId: ZIBBO.userId, character: "Zibbomage", locked: false }]);
        await user.keyboard("{Escape}");
        await user.click(screen.getByText("Bruno").closest<HTMLElement>("[data-user]")!);
        expect(within(panel()).queryByText(t("setup.chars.switch"))).not.toBeInTheDocument();
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("names the switch, the lines and the order numbers in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        await show(editorData({}, { groups: [{ index: 1, slots: [{ ...ZIBBO, pos: 1 }] }], bench: [], pool: [{ ...ZIBBO, userId: "u-other", character: "Zibbo", characters: ZIBBO_CHARS }] }));
        expect(within(pool()).getAllByRole("button", { name: "Zibbowar · Schutz (choice 2) – drag or click to place exactly this character" }).length).toBeGreaterThan(0);
        await user.click(within(group(1)).getByText("Zibbo").closest<HTMLElement>("[data-user]")!);
        expect(within(panel()).getByText("Switch character")).toBeInTheDocument();
        expect(within(panel()).getByRole("button", { name: "Play Zibbowar (Schutz)" })).toBeInTheDocument();
        expect(t("setup.chars.also", { n: 2 })).toBe("Can also come with – choice 2");
    });
});
