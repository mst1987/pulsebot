// The setup editor's raider panel (the box of the top row that shows the
// raider touched last), the drag glow, "Im Setup als", the extra tank/healer
// marks and the "Suche" dialog. The API is mocked at its transport
// (api/client), so the tests also pin the requests. The rest of the editor:
// SetupEditor.test.tsx.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { SetupAttendance, SetupEditorData, SetupPerson, SetupPlacementInput, SetupSearch } from "../../api";
import { t } from "../../i18n";
import { roleLabel, specLabel } from "../../lib/wowNames";
import { inLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import { EVENT_ID, MAGE, PRIEST, ROGUE, TANK, editorData, person, setupCtx } from "../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

/** A feral druid: plays melee, could also tank or heal. */
const DRUID = person("u-druid", "Fell", {
    classId: "druid", spec: "druid-feral", role: "melee", classLabel: "Druide", specLabel: "Wildheit", classColor: "#ff7c0a",
    classSpecs: [
        { key: "druid-feral", label: "Wildheit", icon: "ability_racial_bearform", role: "melee" },
        { key: "druid-guardian", label: "Wächter", icon: "ability_racial_bearform", role: "tank" },
        { key: "druid-restoration", label: "Wiederherstellung", icon: "spell_nature_healingtouch", role: "healer" },
    ],
});

const ATTENDANCE: SetupAttendance = { pct: 80, attended: 8, total: 10, link: "manual", inferred: 0, missed: [] };

let page: SetupEditorData;

beforeEach(() => {
    page = editorData();
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

async function show(data: SetupEditorData) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

function slot(character: string): HTMLElement {
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}

const panel = () => screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
const calls = (method: string, path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);

/** Group 1: Bruno, Ignis; group 2: Lumen, Fell; bench: Schatten. */
function withDruid(over: Partial<SetupEditorData> = {}, people: Partial<Record<string, Partial<SetupPerson>>> = {}): SetupEditorData {
    const p = (x: SetupPerson) => ({ ...x, ...(people[x.userId] || {}) });
    return editorData(over, {
        groups: [
            { index: 1, slots: [{ ...p(TANK), pos: 1 }, { ...p(MAGE), pos: 2 }] },
            { index: 2, slots: [{ ...p(PRIEST), pos: 1 }, { ...p(DRUID), pos: 2 }] },
        ],
        bench: [p(ROGUE)],
    });
}

describe("the raider panel", () => {
    it("is a box of the top row, empty until a raider is touched, then drawn with attendance and a check for a confirmed link", async () => {
        const user = userEvent.setup();
        const { container } = await show(withDruid({ attendance: { [MAGE.userId]: ATTENDANCE, [TANK.userId]: { ...ATTENDANCE, pct: 40, link: "auto" } } }));
        expect(panel()).toHaveTextContent(t("setup.person.tip.empty"));
        // never a floating layer: it lives inside the editor, not portalled into <body>
        expect(container.contains(panel())).toBe(true);

        await user.hover(slot("Ignis"));
        expect(within(panel()).getByText("Ignis")).toBeInTheDocument();
        expect(within(panel()).getByText("80 %")).toBeInTheDocument();
        expect(within(panel()).queryByText(t("setup.person.tip.autoBadge"))).not.toBeInTheDocument();

        // a guessed character link is the small "Auto" badge (not in capitals: the wording is "Auto")
        await user.hover(slot("Bruno"));
        expect(within(panel()).getByText("40 %")).toBeInTheDocument();
        expect(t("setup.person.tip.autoBadge")).toBe("Auto");
        expect(within(panel()).getAllByText("Auto").length).toBeGreaterThan(0);
    });

    it("also follows the keyboard focus", async () => {
        await show(withDruid());
        slot("Lumen").focus();
        await waitFor(() => expect(within(panel()).getByText("Lumen")).toBeInTheDocument());
    });

    it("lists what a raider brings, a party buff with the small group count", async () => {
        const user = userEvent.setup();
        await show(withDruid({}, { [MAGE.userId]: { brings: [{ key: "ai", label: "Arkane Brillanz", icon: "spell_holy_magicalsentry", scope: "party", count: 4 }] } }));
        await user.hover(slot("Ignis"));
        expect(within(panel()).getByText(t("setup.person.tip.brings"))).toBeInTheDocument();
        const buff = within(panel()).getByText("Arkane Brillanz").closest<HTMLElement>("[data-tip]");
        expect(buff).toHaveAttribute("data-tip", "Arkane Brillanz");
        expect(buff).toHaveAttribute("data-tip-sub", t("setup.person.tip.bringsGroup", { count: 4 }));
        expect(within(panel()).getByText(t("setup.person.tip.bringsGroupShort", { count: 4 }))).toBeInTheDocument();
    });

    it("says when the raider last stood on the bench — the date as the row, the sentence as its tooltip", async () => {
        const user = userEvent.setup();
        const lastBench = Date.UTC(2026, 8, 12, 18, 0) / 1000;
        await show(withDruid({ attendance: { [MAGE.userId]: { ...ATTENDANCE, link: "auto", lastBench, benchNights: 10 }, [TANK.userId]: { ...ATTENDANCE, lastBench: 0, benchNights: 10 }, [PRIEST.userId]: { ...ATTENDANCE } } }));
        await user.hover(slot("Ignis"));
        const row = within(panel()).getByText("12.09.2026").closest<HTMLElement>("[data-tip]");
        expect(row).toHaveAttribute("data-tip", "Zuletzt auf der Bank: 12.09.2026");
        // the character link: the Auto badge with its sentence as tooltip, never a line of text
        const auto = within(panel()).getAllByText(t("setup.person.tip.autoBadge")).find((e) => e.getAttribute("data-tip"));
        expect(auto).toHaveAttribute("data-tip", t("setup.person.tip.linkAuto"));
        expect(within(panel()).queryByText(t("setup.person.tip.linkAuto"))).not.toBeInTheDocument();

        // not on the bench in the nights looked at: a dash, the count in the tooltip
        await user.hover(slot("Bruno"));
        expect(within(panel()).getByText("–").closest("[data-tip]")).toHaveAttribute("data-tip", t("setup.person.tip.benchNever", { count: 10 }));
        expect(await inLang("en", () => t("setup.person.tip.benchNever", { count: 10 }))).toBe("Not on the bench in the last 10 raids");

        // no earlier night at all: nothing to say
        await user.hover(slot("Lumen"));
        expect(within(panel()).queryByText("–")).not.toBeInTheDocument();
    });
});

describe("the drag glow", () => {
    it("lights the group the picked raider helps most", async () => {
        const user = userEvent.setup();
        await show(withDruid({}, { [ROGUE.userId]: { fit: { 1: 0, 2: 3, 3: 1 } } }));
        await user.click(slot("Schatten"));
        // the glow is the class on the group card
        expect(screen.getByRole("region", { name: t("setup.group.title", { index: 2 }) })).toHaveClass("se-suggest");
        expect(screen.getByRole("region", { name: t("setup.group.title", { index: 3 }) })).not.toHaveClass("se-suggest");
    });
});

describe("Im Setup als — a raider who plays several specs", () => {
    it("offers the class's specs as icon buttons and saves the change through the usual request", async () => {
        const user = userEvent.setup();
        await show(withDruid());
        await user.hover(slot("Fell"));
        expect(within(panel()).getByText("Im Setup als")).toBeInTheDocument();
        const feral = within(panel()).getByRole("button", { name: `${specLabel("druid-feral", "Wildheit")} · ${roleLabel("melee")}` });
        expect(feral).toHaveAttribute("aria-pressed", "true");
        await user.click(within(panel()).getByRole("button", { name: new RegExp(` · ${t("wow.role.tank")}$`) }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = calls("PUT", "/api/raids/setup")[0][2] as SetupPlacementInput;
        expect(body.groups.flatMap((g) => g.slots).find((s) => s.userId === DRUID.userId)).toMatchObject({ spec: "druid-guardian", role: "tank" });
    });

    it("is not offered for a raider on the bench, nor an extra role", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { groups: [{ index: 1, slots: [{ ...TANK, pos: 1 }] }], bench: [DRUID] }));
        await user.hover(slot("Fell"));
        expect(within(panel()).getByText("Fell")).toBeInTheDocument();
        expect(within(panel()).queryByText(t("setup.person.tip.playsAs"))).not.toBeInTheDocument();
        expect(within(panel()).queryByText(t("setup.person.tip.extra"))).not.toBeInTheDocument();
    });
});

describe("Extra tank / healer", () => {
    it("offers a toggle per role the class can take besides the setup's, and marks the raider's line", async () => {
        const user = userEvent.setup();
        vi.mocked(client.send).mockImplementation((_m: string, path: string) => Promise.resolve(path === "/api/raids/setup/extra-role"
            ? { ...page, extraRoles: { [DRUID.userId]: ["tank"] } }
            : page));
        await show(withDruid());
        await user.hover(slot("Fell"));
        const tank = within(panel()).getByRole("button", { name: t("wow.role.tank") });
        expect(within(panel()).getByRole("button", { name: t("wow.role.healer") })).toBeInTheDocument();
        // the role played in the setup is not offered again
        expect(within(panel()).queryByRole("button", { name: t("wow.role.melee") })).not.toBeInTheDocument();
        expect(tank).toHaveAttribute("aria-pressed", "false");
        await user.click(tank);
        await waitFor(() => expect(calls("POST", "/api/raids/setup/extra-role")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/extra-role")[0][2]).toEqual({ event: EVENT_ID, userId: DRUID.userId, role: "tank", on: true });
        await waitFor(() => expect(within(panel()).getByRole("button", { name: t("wow.role.tank") })).toHaveAttribute("aria-pressed", "true"));
        expect(within(slot("Fell")).getByText(t("setup.extra.short.tank"))).toHaveAttribute("data-tip", t("setup.extra.tip", { role: t("wow.role.tank") }));
    });

    it("has its texts in both languages", async () => {
        const keys = ["setup.person.tip.extra", "setup.person.tip.extraSub", "setup.extra.tip", "setup.extra.short.tank", "setup.extra.short.healer"];
        for (const key of keys) expect(t(key, { role: "Tank" })).not.toBe(key);
        await inLang("en", () => {
            for (const key of keys) expect(t(key, { role: "Tank" })).not.toBe(key);
        });
    });
});

describe("Suche — the classes and specs the raid still needs", () => {
    const SEARCH: SetupSearch = {
        size: 25, placed: 20, open: 5,
        roles: [{ role: "healer", missing: 2, specs: ["priest-holy"] }],
        buffs: [],
        specInfo: { "priest-holy": { label: "Heilig", classLabel: "Priester", classId: "priest", icon: "spell_holy_guardianspirit", color: "#ffffff" } },
        roleSpecs: { healer: ["priest-holy"] },
        text: "LF 2 healers",
    };

    it("is a button in the bar, off without a search", async () => {
        await show(withDruid({ search: null }));
        expect(screen.getByRole("button", { name: "Suche" })).toBeDisabled();
    });

    it("opens a dialog with the editable message, rewrites it when the needs change and posts it as edited", async () => {
        const user = userEvent.setup();
        vi.mocked(client.send).mockImplementation((_m: string, path: string) => Promise.resolve(path === "/api/raids/setup/search/text"
            ? { text: "LF 3 healers" }
            : { message: "gepostet" }));
        await show(withDruid({ search: SEARCH }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.search") }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText(t("setup.search.title"))).toBeInTheDocument();
        const message = within(dialog).getByRole("textbox", { name: t("setup.search.message") });
        expect(message).toHaveValue("LF 2 healers");
        // the count stands alone, never as "2×"
        expect(within(dialog).queryByText(/2×/)).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: t("setup.search.more") }));
        await waitFor(() => expect(message).toHaveValue("LF 3 healers"));
        expect(calls("POST", "/api/raids/setup/search/text")[0][2]).toMatchObject({ event: EVENT_ID, roles: [{ role: "healer", missing: 3 }] });

        // never empty, never over Discord's limit
        const post = within(dialog).getByRole("button", { name: t("setup.search.post") });
        await user.clear(message);
        expect(post).toBeDisabled();
        await user.type(message, "Suchen Heiler");
        expect(post).toBeEnabled();
        await user.click(post);
        await waitFor(() => expect(calls("POST", "/api/raids/setup/search")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/search")[0][2]).toEqual({ event: EVENT_ID, text: "Suchen Heiler" });
    });

    it("has every text of the dialog in both languages", async () => {
        const keys = ["kicker", "title", "hint", "open", "required", "helps", "buffCount", "message", "post", "posted", "failed", "none", "fewer", "more", "drop", "dropSub", "add", "regenerate", "writing"].map((k) => `setup.search.${k}`);
        for (const key of keys) expect(t(key)).not.toBe(key);
        await inLang("en", () => {
            for (const key of keys) expect(t(key)).not.toBe(key);
        });
        expect(t("setup.editor.search")).toBe("Suche");
    });
});
