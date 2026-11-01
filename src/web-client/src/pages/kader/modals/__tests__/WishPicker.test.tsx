// The spec picker with its "Spec hinzufügen …", through the real page: a reader
// sees plain text or a menu without the entry, write access always gets a menu,
// and a new spec is saved into the wishes before it is picked.
import { screen, within } from "@testing-library/react";
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
    saveKaderVariant: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });
const PROT = { className: "Warrior", spec: "Warrior-Protection" };
const change = (kader: KaderData = kaderData()) => ({ kader, kaders: kaderView().kaders });
const staleError = () => Object.assign(new Error("stale"), { code: "stale", by: "" });

function withMiraInSlot() {
    const k = kaderData();
    k.setups[0].groups[0][1] = { userId: U.heal, spec: "Shaman-Restoration" };
    vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
    vi.mocked(api.saveKaderVariant).mockResolvedValue(change(k));
    vi.mocked(api.saveKaderWishes).mockResolvedValue(change(k));
    return k;
}

async function show(route: string, user = adminUser()) {
    renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

const slotPicker = () => screen.getByRole("button", { name: new RegExp(`^${t("kader.setups.specOf", { name: "Mira" })}`) });
const addEntry = () => screen.getByRole("menuitem", { name: t("kader.picker.addSpec") });

async function addWarrior() {
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(t("kader.wishes.addOf", { name: "Mira" }));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("kader.field.class") }), "Warrior");
    await userEvent.click(within(dialog).getByRole("button", { name: t("kader.interview.addWish") }));
}

beforeEach(() => {
    localStorage.clear();
});

describe("WishPicker · adding a spec", () => {
    it("saves the new wish, then puts it into the slot", async () => {
        withMiraInSlot();
        await show("/kader/k1/setups");
        await userEvent.click(slotPicker());
        await userEvent.click(addEntry());
        await addWarrior();
        const wishes = kaderData().players[U.heal].wishes;
        expect(api.saveKaderWishes).toHaveBeenCalledWith("k1", U.heal, [...wishes, PROT], { baseRev: 0 });
        expect(vi.mocked(api.saveKaderVariant).mock.calls.at(-1)?.[2].groups?.[0][1]).toEqual({ userId: U.heal, spec: PROT.spec });
        expect(vi.mocked(api.saveKaderWishes).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(api.saveKaderVariant).mock.invocationCallOrder.at(-1) as number);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps the choice and picks nothing when somebody else saved the wishes meanwhile", async () => {
        withMiraInSlot();
        vi.mocked(api.saveKaderWishes).mockRejectedValue(staleError());
        await show("/kader/k1/setups");
        await userEvent.click(slotPicker());
        await userEvent.click(addEntry());
        await addWarrior();
        const dialog = screen.getByRole("dialog");
        expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("kader.wishes.addStale"));
        expect(within(dialog).getByRole("combobox", { name: t("kader.field.class") })).toHaveValue("Warrior");
        expect(api.saveKaderVariant).not.toHaveBeenCalled();
    });

    it("closes the entry at the wish limit", async () => {
        const k = withMiraInSlot();
        k.players[U.heal].wishes = [
            { className: "Shaman", spec: "Shaman-Restoration" },
            { className: "Shaman", spec: "Shaman-Enhancement" },
            { className: "Warrior", spec: "Warrior-Protection" },
            { className: "Warrior", spec: "Warrior-Fury" },
            { className: "Mage", spec: "Mage-Frost" },
            { className: "Mage", spec: "Mage-Fire" },
        ];
        await show("/kader/k1/setups");
        await userEvent.click(slotPicker());
        expect(addEntry()).toBeDisabled();
        expect(addEntry()).toHaveAttribute("data-tip", t("kader.picker.addFull", { n: 6 }));
    });

    it("is a menu with write access even with one wish, and plain text for a reader", async () => {
        const k = kaderData();
        k.setups[0].groups[0][1] = { userId: U.mage, spec: "Mage-Frost" };
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        const name = new RegExp(`^${t("kader.setups.specOf", { name: "Liss" })}`);
        const first = renderPage(<KaderPage />, { route: "/kader/k1/setups", path: PATH, user: adminUser() });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        await userEvent.click(screen.getByRole("button", { name }));
        expect(addEntry()).toBeEnabled();
        first.unmount();
        await show("/kader/k1/setups", reader);
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    });

    it("has no add entry in the drawer for a reader", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView());
        await show(`/kader/k1/roster?spieler=${U.heal}`, reader);
        expect(screen.queryByRole("menuitem", { name: t("kader.picker.addSpec") })).not.toBeInTheDocument();
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
        expect(within(drawer).queryByRole("button", { name: t("kader.wishes.add") })).not.toBeInTheDocument();
    });
});
