// Signup states at a glance in the setup editor (#setup-bar): a late, tentative or
// bench signup is a labelled square field on the line (pool cards and group places,
// never just a dot), "Angemeldet" sorts each role block signed first, then late,
// tentative, bench — each after a divider with its name — and status chips beside the
// role chips show one state only. The API is mocked at its transport (api/client).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import type { SetupCharacter, SetupEditorData } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { renderPage } from "../../../test/render";
import { MAGE, PRIEST, TANK, editorData, person, setupCtx } from "../../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const healer = (userId: string, character: string, status: string) => person(userId, character, { classId: "priest", spec: "priest-holy", role: "healer", specLabel: "Heilig", status: status as SetupCharacter["status"] });
const char = (character: string, spec: string, role: SetupCharacter["role"], priority: number, status = "signed"): SetupCharacter => ({
    character, spec, role, priority, status: status as SetupCharacter["status"], classId: spec.split("-")[0], classColor: "#ffffff", classLabel: "", specLabel: "", specIcon: "",
});

const DAX = healer("u-dax", "Dax", "bench");
const BORK = healer("u-bork", "Bork", "tentative");
const AAL = healer("u-aal", "Aal", "signed");
const CID = healer("u-cid", "Cid", "late");
const EVE = person("u-eve", "Eve", { status: "tentative" });
/** Zibbo: a holy priest (signed) first, the protection warrior Zibbowar late. */
const ZIBBO = person("u-zibbo", "Zibbo", {
    classId: "priest", spec: "priest-holy", role: "healer", specLabel: "Heilig",
    characters: [char("Zibbo", "priest-holy", "healer", 0), char("Zibbowar", "warrior-protection", "tank", 1, "late")],
});

let page: SetupEditorData;

beforeEach(() => {
    page = editorData();
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

/** Group 1: Bruno, Ignis (tentative); group 2: Lumen — "Angemeldet" in the server's order Dax, Bork, Aal, Cid, Zibbo, Eve. */
async function show() {
    page = editorData({ signupCount: 9 }, {
        groups: [
            { index: 1, slots: [{ ...TANK, pos: 1 }, { ...MAGE, status: "tentative", pos: 2 }] },
            { index: 2, slots: [{ ...PRIEST, pos: 1 }] },
        ],
        bench: [],
        pool: [DAX, BORK, AAL, CID, ZIBBO, EVE],
    });
    renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
}

const pool = () => screen.getByRole("region", { name: t("setup.pool.aria") });
const block = (role: string) => within(pool()).getByRole("group", { name: t(`setup.poolPanel.sections.${role}`) });
const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });
/** A raider's line (inside one area when given). */
const line = (character: string, inside: HTMLElement = document.body) => {
    const el = [...inside.querySelectorAll<HTMLElement>(".se-slot[data-user]")].find((n) => n.querySelector(".se-name")?.textContent === character);
    if (!el) throw new Error(`no line for ${character}`);
    return el;
};
/** The names of a block's leading lines, top to bottom. */
const order = (el: HTMLElement) => [...el.querySelectorAll(".se-slot .se-name")].map((n) => n.textContent);
const statusChip = (s: string) => within(within(pool()).getByRole("group", { name: t("setup.poolPanel.statusFilter") })).getByRole("button", { name: new RegExp(`^${t(`signups.status.${s}`)}`) });

describe("signup states at a glance", () => {
    it("marks late, tentative and bench with a labelled square field on the card — a plain signup with none", async () => {
        await show();
        for (const [character, status] of [["Bork", "tentative"], ["Cid", "late"], ["Dax", "bench"]] as const) {
            const badge = within(line(character, pool())).getByText(t(`signups.status.${status}`)).closest<HTMLElement>(".se-sig")!;
            expect(badge).toHaveClass(`se-sigv-${status}`);
            // no tooltip of its own: the peek beside the line names the state
            expect(badge).not.toHaveAttribute("data-tip");
            expect(line(character, pool())).toHaveClass("se-has-sig");
        }
        expect(t("signups.status.tentative")).toBe("Vielleicht");
        expect(t("signups.status.late")).toBe("Spät");
        expect(t("signups.status.bench")).toBe("Bank");
        expect(line("Aal", pool()).querySelector(".se-sig")).toBeNull();
        expect(line("Aal", pool())).not.toHaveClass("se-has-sig");
        // no dot any more
        expect(document.querySelector(".rd-sig")).toBeNull();
    });

    it("shows the same field on a placed raider who signed up tentative", async () => {
        await show();
        expect(within(line("Ignis", group(1))).getByText(t("signups.status.tentative"))).toBeInTheDocument();
        expect(line("Bruno", group(1)).querySelector(".se-sig")).toBeNull();
    });

    it("sorts each role block: signed first, then late, tentative, bench — each after a divider with its name", async () => {
        await show();
        expect(order(block("healer"))).toEqual(["Aal", "Zibbo", "Cid", "Bork", "Dax"]);
        const dividers = within(block("healer")).getAllByRole("separator");
        expect(dividers.map((d) => d.getAttribute("aria-label"))).toEqual([
            t("setup.poolPanel.statusHead", { status: "Spät", count: 1 }),
            t("setup.poolPanel.statusHead", { status: "Vielleicht", count: 1 }),
            t("setup.poolPanel.statusHead", { status: "Bank", count: 1 }),
        ]);
        expect(dividers[0]).toHaveTextContent("Spät · 1");
        // a block of plain signups has no divider; a block that starts late starts with one
        expect(within(block("tank")).getAllByRole("separator")).toHaveLength(1);
        expect(order(block("tank"))).toEqual(["Zibbowar"]);
    });

    it("keeps a small field on a further character's line only where its state differs", async () => {
        await show();
        // healer block: Zibbo leads (signed), Zibbowar under him is late
        const healerAlt = block("healer").querySelector<HTMLElement>(".se-alt[data-character=\"Zibbowar\"]")!;
        expect(within(healerAlt).getByRole("img", { name: t("signups.status.late") })).toBeInTheDocument();
        // tank block: Zibbowar leads with the full field, Zibbo under him is a plain signup — that differs too
        expect(within(line("Zibbowar", block("tank"))).getByText(t("signups.status.late"))).toBeInTheDocument();
        const tankAlt = block("tank").querySelector<HTMLElement>(".se-alt[data-character=\"Zibbo\"]")!;
        expect(within(tankAlt).getByRole("img", { name: t("signups.status.signed") })).toBeInTheDocument();
    });

    it("filters by state with chips beside the role chips — counted by person, a second click shows everybody again", async () => {
        const user = userEvent.setup();
        await show();
        // late: Cid and Zibbo (his warrior), tentative: Bork and Eve, bench: Dax
        expect(statusChip("late")).toHaveTextContent("2");
        expect(statusChip("tentative")).toHaveTextContent("2");
        expect(statusChip("bench")).toHaveTextContent("1");
        await user.click(statusChip("tentative"));
        expect(statusChip("tentative")).toHaveAttribute("aria-pressed", "true");
        expect(order(pool())).toEqual(["Bork", "Eve"]);
        // combined with a role chip
        await user.click(within(pool()).getByRole("button", { name: new RegExp(`^${t("setup.poolPanel.filters.dps")}`) }));
        expect(order(pool())).toEqual(["Eve"]);
        await user.click(within(pool()).getByRole("button", { name: new RegExp(`^${t("setup.poolPanel.filters.all")}`) }));
        await user.click(statusChip("tentative"));
        expect(statusChip("tentative")).toHaveAttribute("aria-pressed", "false");
        expect(order(pool())).toHaveLength(7);
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            await show();
            expect(within(line("Bork", pool())).getByText("Tentative")).toBeInTheDocument();
            expect(statusChip("bench")).toHaveTextContent("Bench 1");
            expect(within(block("healer")).getAllByRole("separator")[0]).toHaveTextContent("Late · 1");
        } finally {
            await switchLang("de");
        }
    });
});
