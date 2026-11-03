// "Specs bearbeiten" through the real page: opened by the pencil, saved against
// the version it started from, a newer version is never overwritten silently.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { KaderData } from "../../../../api";
import { t } from "../../../../i18n";
import { adminUser, renderPage } from "../../../../test/render";
import { kader as kaderData, kaderView, U } from "../../kader.fixture";
import KaderPage from "../../KaderPage";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    setKaderState: vi.fn(),
    saveKaderWishes: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });
const ROUTE = `/kader/k1/roster?spieler=${U.heal}`;
const ENH = { className: "Shaman", spec: "Shaman-Enhancement" };
const REST = { className: "Shaman", spec: "Shaman-Restoration" };
const change = (kader: KaderData = kaderData()) => ({ kader, kaders: kaderView().kaders });
const staleError = () => Object.assign(new Error("stale"), { code: "stale", by: "" });
const title = () => t("kader.wishes.title", { name: "Mira" });

async function show(route = ROUTE, user = adminUser()) {
    renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

async function openDialog() {
    await userEvent.click(screen.getByRole("button", { name: t("kader.wishes.editOf", { name: "Mira" }) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(title());
    return dialog;
}

/** Removes the first wish; what is left is the Verstärkung. */
async function removeFirst(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getAllByRole("button", { name: t("kader.interview.removeWish") })[0]);
}

const apply = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: t("common.apply") });

beforeEach(() => {
    localStorage.clear();
    const k = kaderData();
    k.players[U.heal].interview.rev = 4;
    vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
    vi.mocked(api.saveKaderWishes).mockReset();
    vi.mocked(api.saveKaderWishes).mockResolvedValue(change(k));
});

describe("WishesModal", () => {
    it("saves the edited wishes against the version it started from, then closes", async () => {
        await show();
        const dialog = await openDialog();
        await removeFirst(dialog);
        await userEvent.click(apply(dialog));
        expect(api.saveKaderWishes).toHaveBeenCalledWith("k1", U.heal, [ENH], { baseRev: 4 });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("closes without a call when nothing changed", async () => {
        await show();
        const dialog = await openDialog();
        await userEvent.click(apply(dialog));
        expect(api.saveKaderWishes).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows the conflict on a newer version and stays open, and can take the current wishes", async () => {
        vi.mocked(api.saveKaderWishes).mockRejectedValueOnce(staleError());
        await show();
        const dialog = await openDialog();
        await removeFirst(dialog);
        await userEvent.click(apply(dialog));
        const banner = await within(dialog).findByRole("alert");
        expect(apply(dialog)).toBeDisabled();
        await userEvent.click(within(banner).getByRole("button", { name: t("kader.live.conflict.reload") }));
        expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
        expect(within(dialog).getAllByRole("listitem")).toHaveLength([REST, ENH].length);
    });

    it("overwrites a newer version only when asked to", async () => {
        vi.mocked(api.saveKaderWishes).mockRejectedValueOnce(staleError());
        await show();
        const dialog = await openDialog();
        await removeFirst(dialog);
        await userEvent.click(apply(dialog));
        const banner = await within(dialog).findByRole("alert");
        await userEvent.click(within(banner).getByRole("button", { name: t("kader.live.conflict.overwrite") }));
        expect(api.saveKaderWishes).toHaveBeenLastCalledWith("k1", U.heal, [ENH], { force: true });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("gives a reader no pencil", async () => {
        await show(ROUTE, reader);
        expect(screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("kader.wishes.editOf", { name: "Mira" }) })).not.toBeInTheDocument();
    });

    it.each([
        ["the pool", "/kader/k1/pool", "Neuling"],
        ["the overview", "/kader/k1/uebersicht", "Liss"],
    ])("has the pencil in %s too", async (_where, route, name) => {
        await show(route);
        expect(screen.getByRole("button", { name: t("kader.wishes.editOf", { name }) })).toBeInTheDocument();
    });
});
