// The peek (#setup-bar): a raider's info shows beside their line while the mouse
// rests on it (after a short delay, so passing over draws nothing) or the keyboard
// focus is on it — read only, gone at a drag, on leaving and on Esc; a click still
// pins the drawer with the actions. The API is mocked at its transport (api/client).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupAttendance, SetupCharacter, SetupEditorData } from "../../../../api";
import { t } from "../../../../i18n";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, editorData, person, setupCtx } from "../../../../test/fixtures/setupEditor";
import { PEEK_DELAY_MS } from "../peek";
import SetupEditor from "../SetupEditor";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const ATTENDANCE: SetupAttendance = { pct: 80, attended: 8, total: 10, link: "manual", inferred: 0, missed: [] };
const char = (character: string, spec: string, role: SetupCharacter["role"], priority: number, status = "signed", specLabel = ""): SetupCharacter => ({
    character, spec, role, priority, status: status as SetupCharacter["status"], classId: spec.split("-")[0], classColor: "#ffffff", classLabel: "", specLabel, specIcon: "",
});
/** Zibbo in "Angemeldet": a holy priest first, the protection warrior Zibbowar (late) second. */
const ZIBBO = person("u-zibbo", "Zibbo", {
    classId: "priest", spec: "priest-holy", role: "healer", specLabel: "Heilig",
    characters: [char("Zibbo", "priest-holy", "healer", 0, "signed", "Heilig"), char("Zibbowar", "warrior-protection", "tank", 1, "late", "Schutz")],
});

let page: SetupEditorData;

beforeEach(() => {
    page = editorData({ attendance: { [MAGE.userId]: ATTENDANCE } }, { pool: [ZIBBO] });
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
const peekName = () => t("setup.person.tip.peekAria");
const findPeek = () => screen.findByRole("complementary", { name: peekName() });
const noPeek = () => expect(screen.queryByRole("complementary", { name: peekName() })).not.toBeInTheDocument();
const drawer = () => screen.queryByRole("complementary", { name: t("setup.person.tip.aria") });
const rest = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("the peek: a raider's info on hover and focus", () => {
    it("shows beside the line once the mouse rests on it — read only, no drawer — and goes when it leaves", async () => {
        const user = userEvent.setup();
        await show();
        await user.hover(slot("Ignis"));
        // not at once: passing over draws nothing
        noPeek();
        const peek = await findPeek();
        expect(peek.closest(".se-peek")).toHaveAttribute("role", "tooltip");
        expect(within(peek).getByText("Ignis")).toBeInTheDocument();
        expect(within(peek).getByText("80 %")).toBeInTheDocument();
        // in a group: the hint names the double click that takes them out
        expect(within(peek).getByText(t("setup.person.tip.peekHintPlaced"))).toBeInTheDocument();
        // read only: the actions stay with the drawer a click opens
        expect(within(peek).queryByRole("button")).not.toBeInTheDocument();
        expect(drawer()).not.toBeInTheDocument();
        await user.unhover(slot("Ignis"));
        noPeek();
    });

    it("draws nothing when the pointer only passes over", async () => {
        const user = userEvent.setup();
        await show();
        await user.hover(slot("Ignis"));
        await user.unhover(slot("Ignis"));
        await rest(PEEK_DELAY_MS + 150);
        noPeek();
    });

    it("goes the moment a drag starts, so it never covers where the raider is dropped", async () => {
        const user = userEvent.setup();
        await show();
        await user.hover(slot("Bruno"));
        await findPeek();
        fireEvent.dragStart(slot("Bruno"), { dataTransfer: { setData: () => undefined } });
        noPeek();
        await rest(PEEK_DELAY_MS + 50);
        noPeek();
    });

    it("shows on keyboard focus and goes on blur", async () => {
        await show();
        act(() => slot("Lumen").focus());
        expect(within(await findPeek()).getByText("Lumen")).toBeInTheDocument();
        act(() => slot("Lumen").blur());
        noPeek();
    });

    it("gives way to the drawer a click pins — and never doubles the raider the drawer shows", async () => {
        const user = userEvent.setup();
        await show();
        await user.hover(slot("Ignis"));
        await findPeek();
        await user.click(slot("Ignis"));
        noPeek();
        expect(within(drawer()!).getByText("Ignis")).toBeInTheDocument();
        expect(within(drawer()!).getAllByRole("button").length).toBeGreaterThan(0);
        // resting on the pinned raider again: the drawer has them, no second box
        await user.unhover(slot("Ignis"));
        await user.hover(slot("Ignis"));
        await rest(PEEK_DELAY_MS + 100);
        noPeek();
        // another raider peeks beside the open drawer; Esc closes both
        await user.hover(slot("Lumen"));
        expect(within(await findPeek()).getByText("Lumen")).toBeInTheDocument();
        await user.keyboard("{Escape}");
        noPeek();
        await waitFor(() => expect(drawer()).not.toBeInTheDocument());
    });

    it("shows a further character's line as that character: its spec and its state", async () => {
        const user = userEvent.setup();
        await show();
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        const line = within(pool).getByRole("group", { name: t("setup.poolPanel.sections.tank") }).querySelector<HTMLElement>(".se-slot[data-character=\"Zibbowar\"]")!;
        await user.hover(line);
        const peek = await findPeek();
        expect(within(peek).getByText("Zibbowar")).toBeInTheDocument();
        expect(within(peek).getByText(t("signups.status.late"))).toBeInTheDocument();
        // in "Angemeldet" a double click takes nobody out: the plain hint
        expect(within(peek).getByText(t("setup.person.tip.peekHint"))).toBeInTheDocument();
    });

    it("names a tentative signup with the one word of the app — line, peek and pool alike — and drops the reason that only repeats it", async () => {
        const user = userEvent.setup();
        const BORK = person("u-bork", "Bork", { status: "tentative", reasons: ["Nur „Vielleicht“ angemeldet", "Bringt Arkane Brillanz"] });
        page = editorData({}, { pool: [BORK] });
        await show();
        const word = t("signups.status.tentative");
        expect(word).toBe("Vielleicht");
        // the line's field, the status chip and the divider
        expect(within(slot("Bork")).getByText(word)).toBeInTheDocument();
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(within(within(pool).getByRole("group", { name: t("setup.poolPanel.statusFilter") })).getByRole("button", { name: new RegExp(`^${word}`) })).toBeInTheDocument();
        expect(within(pool).getByRole("separator")).toHaveTextContent(`${word} · 1`);
        // the field has no tooltip of its own: the peek says it
        expect(within(slot("Bork")).getByText(word).closest(".se-sig")).not.toHaveAttribute("data-tip");
        await user.hover(slot("Bork"));
        const peek = await findPeek();
        expect(within(peek).getByText(word).closest(".se-sig")).toHaveClass("se-sigv-tentative");
        expect(within(peek).getByText("Bringt Arkane Brillanz")).toBeInTheDocument();
        expect(within(peek).queryByText("Nur „Vielleicht“ angemeldet")).not.toBeInTheDocument();
        expect(peek.textContent).not.toMatch(/Vorläufig/);
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            const user = userEvent.setup();
            await show();
            await user.hover(slot("Ignis"));
            const peek = await screen.findByRole("complementary", { name: "Raider info" });
            expect(peek).toHaveTextContent("Click to select, move, edit");
        } finally {
            await switchLang("de");
        }
    });
});
