// A raid group (#811) in the setup editor: the tabs "Raid 1 | Raid 2" over the
// editor (a click switches, a raider dropped on a tab — or picked, then the tab
// clicked — goes into that raid), "Raids hinzufügen / aufteilen …" (always under
// "Aktionen"; overbooked shows as a warn count, and from the 70 % rule on the
// server's suggestion "Auf N Raids aufteilen" stands hot in the menu and the head;
// the title "<Titel> 2" to edit, several at once with −/+ and "Danach automatisch
// füllen", #1035) and dissolving a further raid. The API is mocked at its transport.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { RaidGroup, SetupEditorData } from "../../../../api";
import { t } from "../../../../i18n";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { EVENT_ID, ROGUE, editorData, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const GROUP: RaidGroup = {
    id: EVENT_ID, primaryId: EVENT_ID, count: 2, places: 50,
    raids: [
        { id: EVENT_ID, title: "Karazhan Donnerstag", index: 1, size: 25, placed: 3, status: "draft", approved: false, posted: false, cancelled: false },
        { id: "ev2", title: "Karazhan Donnerstag 2", index: 2, size: 25, placed: 0, status: "none", approved: false, posted: false, cancelled: false },
    ],
};

let page: SetupEditorData;
beforeEach(() => {
    page = editorData({ raidGroup: GROUP, placedElsewhere: 2 }, { pool: [ROGUE] });
    vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
    vi.mocked(client.send).mockImplementation((_m, path) => {
        if (path === "/api/raids/setup/raid-add") return Promise.resolve({ event: "ev3", title: "Kara 3", raidGroup: GROUP, message: "Kara 3 angelegt" });
        if (path === "/api/raids/setup/raid-remove") return Promise.resolve({ event: EVENT_ID, raidGroup: null, message: "aufgeloest" });
        return Promise.resolve(page);
    });
});

/** Opens "Aktionen" and finds an entry by its name. */
async function moreItem(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
    return screen.getByRole("menuitem", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
}

async function show(data: SetupEditorData, props: { raidId?: string; onSwitchRaid?: (id: string) => void } = {}) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx()} {...props} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

const tabs = () => screen.getByRole("tablist", { name: t("setup.raidGroup.aria") });
const tab = (index: number) => within(tabs()).getAllByRole("tab")[index - 1];
const calls = (path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === "POST" && p === path);
const slot = (character: string) => {
    const el = [...document.querySelectorAll<HTMLElement>(".se-slot[data-user]")].find((n) => n.textContent?.includes(character));
    if (!el) throw new Error(`no slot ${character}`);
    return el;
};

describe("the tabs of a raid group", () => {
    it("shows one tab per raid with its number, title and places, the first one marked as the signup", async () => {
        await show(page);
        expect(within(tabs()).getAllByRole("tab")).toHaveLength(2);
        expect(tab(1)).toHaveAttribute("aria-selected", "true");
        expect(tab(1)).toHaveTextContent("Raid 1");
        expect(tab(1)).toHaveTextContent(t("setup.raidGroup.primary"));
        expect(tab(2)).toHaveTextContent("Karazhan Donnerstag 2");
        expect(tab(2)).toHaveTextContent("0/25");
        expect(tabs()).toHaveTextContent(t("setup.raidGroup.elsewhere", { count: 2 }));
    });

    it("switches the editor to another raid on a click", async () => {
        const onSwitchRaid = vi.fn();
        await show(page, { onSwitchRaid });
        await userEvent.setup().click(tab(2));
        expect(onSwitchRaid).toHaveBeenCalledWith("ev2");
    });

    it("moves a raider dropped on another raid's tab into that raid", async () => {
        await show(page);
        fireEvent.dragStart(slot("Bruno"), { dataTransfer: { setData: () => undefined } });
        await act(() => new Promise((r) => setTimeout(r, 5)));
        expect(tab(2)).toHaveTextContent(t("setup.raidGroup.dropHere"));
        fireEvent.drop(tab(2), { dataTransfer: { getData: () => "u-tank" } });
        await waitFor(() => expect(calls("/api/raids/setup/move-raid")).toHaveLength(1));
        expect(calls("/api/raids/setup/move-raid")[0][2]).toEqual({ event: EVENT_ID, target: "ev2", userId: "u-tank" });
    });

    it("moves a picked raider when the other tab is clicked (the keyboard path)", async () => {
        const onSwitchRaid = vi.fn();
        const user = userEvent.setup();
        await show(page, { onSwitchRaid });
        await user.click(slot("Schatten"));
        await user.click(tab(2));
        await waitFor(() => expect(calls("/api/raids/setup/move-raid")).toHaveLength(1));
        expect(calls("/api/raids/setup/move-raid")[0][2]).toMatchObject({ target: "ev2", userId: "u-rogue" });
        expect(onSwitchRaid).not.toHaveBeenCalled();
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            await show(page);
            expect(tab(2)).toHaveTextContent("Raid 2");
            expect(tabs()).toHaveTextContent("2 raids · 50 places");
            expect(tabs()).toHaveTextContent("2 stand in other raids of the group");
        } finally {
            await switchLang("de");
        }
    });
});

describe("Raids hinzufügen / aufteilen", () => {
    it("shows an overbooked evening below the 70 % rule as a warn count only, the manual entry under \"Aktionen\" asks for the title (\"<Titel> 2\") and switches to the new raid", async () => {
        const onSwitchRaid = vi.fn();
        const user = userEvent.setup();
        // 30 for 25 places: two raids would be 60 % full, the server suggests no split (suggestedTotal 0)
        await show(editorData({ signupCount: 30, suggestedTotal: 0 }), { onSwitchRaid });
        const count = within(screen.getByRole("list", { name: t("setup.bar.countsAria") })).getByText(t("setup.bar.overbookedChip", { signed: 30, places: 25 })).closest<HTMLElement>("[role=listitem]")!;
        expect(t("setup.bar.overbookedChip", { signed: 30, places: 25 })).toBe("30 Anmeldungen / 25 Plätze");
        expect(count).toHaveClass("se-tone-mid");
        expect(count).toHaveAttribute("data-tip-sub", t("setup.bar.overbookedSub"));
        // no banner line, no split suggestion in the head or the menu
        expect(document.querySelector(".se-overbooked")).toBeNull();
        expect(document.querySelector(".se-split-hint")).toBeNull();
        expect(screen.queryByRole("button", { name: /aufteilen$/ })).not.toBeInTheDocument();
        await user.click(await moreItem(user, t("setup.raidGroup.addOrSplit")));
        const input = screen.getByLabelText(t("setup.raidGroup.titleLabel"));
        expect(input).toHaveValue("Karazhan Donnerstag 2");
        await user.clear(input);
        await user.type(input, "Kara B");
        // without "Danach automatisch füllen" the editor switches to the new raid
        await user.click(screen.getByRole("switch", { name: t("setup.raidGroup.fill") }));
        await user.click(screen.getByRole("button", { name: t("setup.raidGroup.create") }));
        await waitFor(() => expect(calls("/api/raids/setup/raid-add")).toHaveLength(1));
        expect(calls("/api/raids/setup/raid-add")[0][2]).toEqual({ event: EVENT_ID, title: "Kara B" });
        expect(onSwitchRaid).toHaveBeenCalledWith("ev3");
        expect(calls("/api/raids/setup/propose")).toHaveLength(0);
    });

    it("splits into as many raids as the signups fill (#1035): the total with −/+, the new titles as a preview, then fills the group", async () => {
        const onSwitchRaid = vi.fn();
        const user = userEvent.setup();
        const tenMan = editorData({ signupCount: 50, suggestedTotal: 5 });
        await show({ ...tenMan, event: { ...tenMan.event, size: 10 } }, { onSwitchRaid });
        expect(screen.getByRole("list", { name: t("setup.bar.countsAria") })).toHaveTextContent("50 Anmeldungen / 10 Plätze");
        expect(t("setup.raidGroup.split", { count: 5 })).toBe("Auf 5 Raids aufteilen");
        // from the 70 % rule on, the split stands in the head (a calm ghost button) …
        const head = document.querySelector<HTMLElement>(".se-split-hint")!;
        expect(head).toHaveTextContent(t("setup.raidGroup.split", { count: 5 }));
        expect(head).toHaveClass("btn-ghost");
        // … and hot at the top of "Aktionen", beside the manual entry
        const hot = await moreItem(user, t("setup.raidGroup.split", { count: 5 }));
        expect(hot).toHaveClass("se-tone-hot");
        expect(screen.getByRole("menuitem", { name: new RegExp(t("setup.raidGroup.addOrSplit").replace("…", "")) })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await user.click(head);
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveTextContent(t("setup.raidGroup.splitTitle"));
        const stepper = screen.getByRole("group", { name: t("setup.raidGroup.countLabel") });
        expect(stepper).toHaveTextContent("5");
        // the total never goes below the raids there + 1
        await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") }));
        await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") }));
        await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") }));
        expect(stepper).toHaveTextContent("2");
        expect(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") })).toBeDisabled();
        expect(screen.getByLabelText(t("setup.raidGroup.titleLabel"))).toHaveValue("Karazhan Donnerstag 2");
        expect(dialog).toHaveTextContent(t("setup.raidGroup.addTitle"));
        for (let i = 0; i < 3; i += 1) await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countMore") }));
        expect(stepper).toHaveTextContent("5");
        expect(screen.queryByLabelText(t("setup.raidGroup.titleLabel"))).not.toBeInTheDocument();
        expect(screen.getByTestId("se-addraid-preview")).toHaveTextContent("Karazhan Donnerstag 2 … Karazhan Donnerstag 5");
        expect(screen.getByRole("switch", { name: t("setup.raidGroup.fill") })).toBeChecked();
        // one more, one fewer: the preview follows
        await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countMore") }));
        expect(screen.getByTestId("se-addraid-preview")).toHaveTextContent("Karazhan Donnerstag 2 … Karazhan Donnerstag 6");
        await user.click(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("setup.raidGroup.split", { count: 5 }) }));
        await waitFor(() => expect(calls("/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("/api/raids/setup/raid-add")[0][2]).toEqual({ event: EVENT_ID, count: 4 });
        // the group already has placed raiders (GROUP: 3 in raid 1): only the free places are filled
        expect(calls("/api/raids/setup/propose")[0][2]).toMatchObject({ event: EVENT_ID, keep: "placed" });
        expect(onSwitchRaid).not.toHaveBeenCalled();
    });

    it("stops the number at 8 raids in all", async () => {
        const user = userEvent.setup();
        const full: RaidGroup = { ...GROUP, count: 7, raids: [...GROUP.raids, ...[3, 4, 5, 6, 7].map((i) => ({ ...GROUP.raids[1], id: `ev${i}`, index: i, title: `Karazhan Donnerstag ${i}` }))] };
        await show(editorData({ signupCount: 200, suggestedTotal: 8, raidGroup: full }));
        await user.click(document.querySelector<HTMLElement>(".se-split-hint")!);
        const stepper = screen.getByRole("group", { name: t("setup.raidGroup.countLabel") });
        expect(stepper).toHaveTextContent("8");
        expect(within(stepper).getByRole("button", { name: t("setup.raidGroup.countMore") })).toBeDisabled();
        expect(within(stepper).getByRole("button", { name: t("setup.raidGroup.countLess") })).toBeDisabled();
        expect(screen.getByLabelText(t("setup.raidGroup.titleLabel"))).toHaveValue("Karazhan Donnerstag 8");
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            const user = userEvent.setup();
            await show(editorData({ signupCount: 50, suggestedTotal: 4 }));
            expect(screen.getByRole("list", { name: "Roles and places" })).toHaveTextContent("50 signups / 25 places");
            expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
            await user.click(document.querySelector<HTMLElement>(".se-split-hint")!);
            expect(screen.getByRole("group", { name: "Raids in total" })).toHaveTextContent("4");
            expect(screen.getByText("New raids")).toBeInTheDocument();
            expect(screen.getByText("Split into several raids")).toBeInTheDocument();
            expect(screen.getByRole("switch", { name: "Fill automatically afterwards" })).toBeChecked();
            expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Split into 4 raids" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });

    it("waits under \"Aktionen\" while the places suffice — always there, never hot, no warn count", async () => {
        const user = userEvent.setup();
        await show(editorData({ signupCount: 4 }));
        expect(document.querySelector(".se-split-hint")).toBeNull();
        expect(screen.getByRole("list", { name: t("setup.bar.countsAria") })).not.toHaveTextContent("Anmeldungen");
        const add = await moreItem(user, t("setup.raidGroup.addOrSplit"));
        expect(add).not.toHaveClass("se-tone-hot");
        expect(screen.queryByRole("menuitem", { name: /Raids aufteilen$/ })).not.toBeInTheDocument();
        // a manual split opens the dialog with one raid more than there are
        await user.click(add);
        expect(screen.getByRole("group", { name: t("setup.raidGroup.countLabel") })).toHaveTextContent("2");
    });
});

describe("dissolving a further raid", () => {
    it("asks first, dissolves it and goes back to the first raid", async () => {
        const onSwitchRaid = vi.fn();
        const user = userEvent.setup();
        const further = editorData({ eventId: "ev2", raidGroup: GROUP, event: { ...editorData().event, id: "ev2", title: "Karazhan Donnerstag 2" } });
        await show(further, { raidId: "ev2", onSwitchRaid });
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        await user.click(screen.getByRole("menuitem", { name: new RegExp(t("setup.raidGroup.remove", { title: "Karazhan Donnerstag 2" })) }));
        await user.click(await screen.findByRole("button", { name: t("setup.raidGroup.removeAction") }));
        await waitFor(() => expect(calls("/api/raids/setup/raid-remove")).toHaveLength(1));
        expect(calls("/api/raids/setup/raid-remove")[0][2]).toEqual({ event: "ev2" });
        expect(onSwitchRaid).toHaveBeenCalledWith(EVENT_ID);
    });

    it("is locked for a raid with an approved setup", async () => {
        const user = userEvent.setup();
        const locked: RaidGroup = { ...GROUP, raids: [GROUP.raids[0], { ...GROUP.raids[1], approved: true, status: "approved" }] };
        await show(editorData({ eventId: "ev2", raidGroup: locked, event: { ...editorData().event, id: "ev2", title: "Karazhan Donnerstag 2" } }), { raidId: "ev2" });
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.getByRole("menuitem", { name: new RegExp(t("setup.raidGroup.remove", { title: "Karazhan Donnerstag 2" })) })).toBeDisabled();
    });
});
