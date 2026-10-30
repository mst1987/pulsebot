// Notes in the Kaderplaner (#981): the mark right after a name in the pool and
// in the overview, kept across a write answer (that carries no short forms) -
// and nothing without the field (an answer the server gave without maySeeShort).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { KaderView } from "../../../api";
import { t } from "../../../i18n";
import { adminUser, renderPage } from "../../../test/render";
import { kaderView, U } from "../kader.fixture";
import KaderPage from "../KaderPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    addKaderPlayers: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const NOTES: KaderView["vermerke"] = {
    [U.hand]: { level: "warning", reasons: { late_signoff: 2 } },
    [U.mage]: { level: "hint", reasons: { loot: 1 } },
};
const markOf = (summary: string) => t("vermerke.mark.aria", { summary });

let view: KaderView;

beforeEach(() => {
    localStorage.clear();
    view = kaderView({ vermerke: NOTES });
    vi.mocked(api.getKader).mockImplementation(async () => view);
});

async function show(route: string, user = adminUser()) {
    renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

describe("KaderPage with notes (#981)", () => {
    it("puts the mark right after the name in the pool, a link for the admin", async () => {
        await show("/kader/k1/pool");
        const mark = await screen.findByRole("img", { name: markOf("Warnung · Späte Abmeldung ×2") });
        expect(mark.closest(".kp-nameline")).toHaveTextContent("Neuling");
        expect(mark.closest("a")).toHaveAttribute("href", `/vermerke?user=${U.hand}`);
        // Aldric has no note: no mark beside him
        expect(document.querySelectorAll(".kp-nameline .vm-mark")).toHaveLength(document.querySelectorAll(".vm-mark").length);
    });

    it("keeps the mark a plain symbol for an orga without read access to \"vermerke\"", async () => {
        await show("/kader/k1/pool", adminUser({ isAdmin: false, access: { kader: { read: true, write: true } } }));
        const mark = await screen.findByRole("img", { name: markOf("Warnung · Späte Abmeldung ×2") });
        expect(mark.closest("a")).toBeNull();
    });

    it("shows the mark in the overview", async () => {
        await show("/kader/k1/uebersicht");
        const mark = await screen.findByRole("img", { name: markOf("Hinweis · Loot") });
        expect(mark.closest(".kp-namerowcell")).toHaveTextContent("Liss");
    });

    it("keeps the marks of the last GET after a write answer without them", async () => {
        const { vermerke: _drop, ...plain } = kaderView();
        void _drop;
        vi.mocked(api.addKaderPlayers).mockResolvedValue({ ...plain, added: 1, already: 0 } as never);
        await show("/kader/k1/pool");
        await screen.findByRole("img", { name: markOf("Warnung · Späte Abmeldung ×2") });
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: /Raider/ }));
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.import.listKnown", { n: 1 }) }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.import.submit", { n: 1 }) }));
        expect(api.addKaderPlayers).toHaveBeenCalled();
        expect(await screen.findByRole("img", { name: markOf("Warnung · Späte Abmeldung ×2") })).toBeInTheDocument();
    });

    it("draws no mark without the field", async () => {
        view = kaderView();
        await show("/kader/k1/pool");
        expect(screen.getByText("Neuling")).toBeInTheDocument();
        expect(document.querySelector(".vm-mark")).toBeNull();
    });
});
