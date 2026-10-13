// A raid group (#811) in the setup editor: the tabs "Raid 1 | Raid 2" over the
// editor (a click switches, a raider dropped on a tab — or picked, then the tab
// clicked — goes into that raid), "Weiteren Raid hinzufügen" (a calm line under
// the bar while overbooked, else under "Mehr", with the title "<Titel> 2" to edit) and
// dissolving a further raid. The API is mocked at its transport.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import type { RaidGroup, SetupEditorData } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { renderPage } from "../../../test/render";
import { EVENT_ID, ROGUE, editorData, setupCtx } from "../../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

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

describe("Weiteren Raid hinzufügen", () => {
    it("stands in a calm line under the bar while more signed up than there are places, asks for the title (\"<Titel> 2\") and switches to the new raid", async () => {
        const onSwitchRaid = vi.fn();
        const user = userEvent.setup();
        await show(editorData({ signupCount: 30 }), { onSwitchRaid });
        // not in the bar's actions and not under "Mehr": the hint line says why, the button sits in it
        const hint = document.querySelector<HTMLElement>(".se-overbooked")!;
        expect(hint).toHaveAttribute("role", "status");
        expect(hint).toHaveTextContent(t("setup.raidGroup.overbookedHint", { count: 30, places: 25 }));
        expect(t("setup.raidGroup.overbookedHint", { count: 30, places: 25 })).toBe("30 Anmeldungen für 25 Plätze");
        expect(within(document.querySelector<HTMLElement>(".se-bar")!).queryByRole("button", { name: t("setup.raidGroup.add") })).not.toBeInTheDocument();
        await user.click(within(hint).getByRole("button", { name: t("setup.raidGroup.add") }));
        const input = screen.getByLabelText(t("setup.raidGroup.titleLabel"));
        expect(input).toHaveValue("Karazhan Donnerstag 2");
        await user.clear(input);
        await user.type(input, "Kara B");
        await user.click(screen.getByRole("button", { name: t("setup.raidGroup.create") }));
        await waitFor(() => expect(calls("/api/raids/setup/raid-add")).toHaveLength(1));
        expect(calls("/api/raids/setup/raid-add")[0][2]).toEqual({ event: EVENT_ID, title: "Kara B" });
        expect(onSwitchRaid).toHaveBeenCalledWith("ev3");
    });

    it("waits under \"Mehr\" while the places suffice", async () => {
        const user = userEvent.setup();
        await show(editorData({ signupCount: 4 }));
        expect(screen.queryByRole("button", { name: t("setup.raidGroup.add") })).not.toBeInTheDocument();
        expect(document.querySelector(".se-overbooked")).toBeNull();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.getByRole("menuitem", { name: new RegExp(t("setup.raidGroup.add")) })).toBeInTheDocument();
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
