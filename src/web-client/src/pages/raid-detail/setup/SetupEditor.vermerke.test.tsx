// Vermerke in the setup editor (#981): the mark right after a name in the
// groups, the bench and "Angemeldet", the line in the drawer with the link, the
// calm shadowban line above the stage - and nothing of it in an answer without
// the short forms (a raider's, "Ansicht als Raider": the server leaves them out).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import type { SetupEditorData } from "../../../api";
import { t } from "../../../i18n";
import { adminUser, renderPage } from "../../../test/render";
import { editorData, person, setupCtx } from "../../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const BANNED = person("u-ban", "Dunkelmond");
const NOTES: SetupEditorData["vermerke"] = {
    "u-mage": { level: "warning", reasons: { late_signoff: 2 } },
    "u-rogue": { level: "hint", reasons: { loot: 1 } },
    "u-ban": { level: "shadowban", reasons: { behavior: 1 } },
};

let page: SetupEditorData;

beforeEach(() => {
    vi.mocked(client.get).mockImplementation((path: string) => (path.startsWith("/api/raids/setup?")
        ? Promise.resolve(page)
        : Promise.reject({ code: "not_mocked", message: path })));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

async function show(data: SetupEditorData, user = adminUser()) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx({ user })} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });
const markOf = (summary: string) => t("vermerke.mark.aria", { summary });

describe("the setup editor with notes (#981)", () => {
    it("puts the mark right after the name: in a group, on the bench and in \"Angemeldet\"", async () => {
        await show(editorData({ vermerke: NOTES, shadowbanInPool: [{ userId: "u-ban", name: "Dunkelmond" }] }, { pool: [BANNED] }));
        const mark = within(group(1)).getByRole("img", { name: markOf("Warnung · Späte Abmeldung ×2") });
        expect(mark.closest(".se-nameline")).toHaveTextContent("Ignis");
        // a slot is a button: the mark is no link inside it
        expect(mark.closest("a")).toBeNull();
        expect(screen.getByRole("img", { name: markOf("Hinweis · Loot") })).toBeInTheDocument();
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(within(pool).getByRole("img", { name: markOf("Shadowban · Verhalten") })).toBeInTheDocument();
        // nobody without a note gets a mark
        expect(document.querySelectorAll(".se-nameline .vm-mark")).toHaveLength(3);
    });

    it("names the shadowbanned in the pool in one calm line, as links with read access", async () => {
        await show(editorData({ vermerke: NOTES, shadowbanInPool: [{ userId: "u-ban", name: "Dunkelmond" }] }, { pool: [BANNED] }));
        const line = screen.getByRole("status");
        expect(line).toHaveTextContent(t("vermerke.poolLine", { count: 1 }));
        expect(within(line).getByRole("link", { name: "Dunkelmond" })).toHaveAttribute("href", "/vermerke?user=u-ban");
    });

    it("keeps the names plain text without read access to \"vermerke\"", async () => {
        const orga = adminUser({ isAdmin: false, access: { events: { read: true, write: true } } });
        await show(editorData({ vermerke: NOTES, shadowbanInPool: [{ userId: "u-ban", name: "Dunkelmond" }] }, { pool: [BANNED] }), orga);
        expect(within(screen.getByRole("status")).queryByRole("link")).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent("Dunkelmond");
    });

    it("shows the level and reasons in the drawer, with the link to the notes", async () => {
        const user = userEvent.setup();
        await show(editorData({ vermerke: NOTES }));
        await user.click(within(group(1)).getByRole("button", { name: /Ignis/ }));
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(within(panel).getByText(t("vermerke.mark.slotHead"))).toBeInTheDocument();
        expect(within(panel).getByText("Späte Abmeldung ×2")).toBeInTheDocument();
        expect(within(panel).getByRole("link", { name: t("vermerke.mark.open") })).toHaveAttribute("href", "/vermerke?user=u-mage");
    });

    it("draws no mark, no drawer line and no pool line without the short forms", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { pool: [BANNED] }));
        expect(document.querySelector(".vm-mark")).toBeNull();
        expect(document.querySelector(".se-banline")).toBeNull();
        await user.click(within(group(1)).getByRole("button", { name: /Ignis/ }));
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(within(panel).queryByText(t("vermerke.mark.slotHead"))).toBeNull();
    });
});
