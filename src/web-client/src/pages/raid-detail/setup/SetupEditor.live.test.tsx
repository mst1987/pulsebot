// Two orga members in one setup editor (setupPresence): the others in the bar, a
// raider somebody holds ringed and not to be taken, the setup fetched again when
// somebody else saved, a move that met a newer lineup applied to it, and "Gerade
// eben". The API is mocked at its transport (api/client); the heartbeat answers
// from `presence` below.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import type { SetupEditorData, SetupPresenceAnswer } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import { EVENT_ID, MAGE, TANK, editorData, lineup, setupCtx } from "../../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const PRESENCE = "/api/raids/setup/presence";
let page: SetupEditorData;
let presence: SetupPresenceAnswer;
/** What the light GET answers once somebody else saved. */
let fresh: SetupEditorData | null;

const calls = (method: string, path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);
const getCalls = (path: string) => vi.mocked(client.get).mock.calls.filter(([p]) => String(p).startsWith(path));

function slot(character: string): HTMLElement {
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}
const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });

beforeEach(() => {
    page = editorData();
    presence = { editors: [], version: 3, activity: [] };
    fresh = null;
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.includes("light=1") && fresh) return Promise.resolve(fresh);
        return path.startsWith("/api/raids/setup?") ? Promise.resolve(page) : Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockImplementation((_m: string, path: string) => (path === PRESENCE
        ? Promise.resolve(presence)
        : Promise.resolve({ ...page, setup: page.setup && { ...page.setup, version: page.setup.version + 1 } })));
});

async function show() {
    const view = renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    await waitFor(() => expect(calls("POST", PRESENCE).length).toBeGreaterThan(0));
    return view;
}

describe("the setup editor with others in it", () => {
    it("says nothing while one is alone, and names the others in the bar with what they hold", async () => {
        const view = await show();
        expect(document.querySelector(".se-live")).toBeNull();
        view.unmount();
        // leaving says goodbye
        await waitFor(() => expect(calls("POST", PRESENCE).some(([, , b]) => (b as { leave?: boolean }).leave === true)).toBe(true));

        presence = { editors: [{ userId: "o1", name: "Exitus", action: { kind: "drag", userId: MAGE.userId } }], version: 3, activity: [] };
        await show();
        const chip = await waitFor(() => {
            const el = document.querySelector<HTMLElement>(".se-bar .se-live");
            if (!el) throw new Error("no chip");
            return el;
        });
        expect(chip).toHaveTextContent(t("setup.live.one", { name: "Exitus" }));
        expect(chip.getAttribute("data-tip-sub")).toBe(t("setup.live.holdsTip", { name: "Exitus", character: "Ignis" }));
    });

    it("rings a raider somebody else holds — not to be picked or dragged, a click says who has them", async () => {
        presence = { editors: [{ userId: "o1", name: "Exitus", action: { kind: "edit", userId: MAGE.userId } }], version: 3, activity: [] };
        const user = userEvent.setup();
        await show();
        await waitFor(() => expect(slot("Ignis")).toHaveClass("se-held"));
        expect(slot("Ignis")).toHaveAttribute("draggable", "false");
        expect(within(slot("Ignis")).getByText(t("setup.live.editsTag", { name: "Exitus" }))).toBeInTheDocument();
        await user.click(slot("Ignis"));
        expect(slot("Ignis")).not.toHaveClass("se-picked");
        expect(await screen.findByText(t("setup.live.editsMsg", { name: "Exitus", character: "Ignis" }))).toBeInTheDocument();
        // a drop on them changes nothing either
        fireEvent.drop(slot("Ignis"), { dataTransfer: { getData: () => TANK.userId } });
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(0);
    });

    it("tells the others what this one holds, at once", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Bruno"));
        await waitFor(() => expect(calls("POST", PRESENCE).some(([, , b]) => JSON.stringify((b as { action?: unknown }).action) === JSON.stringify({ kind: "drag", userId: TANK.userId }))).toBe(true));
    });

    it("fetches the setup light and redraws it when somebody else saved a newer version", async () => {
        presence = { editors: [], version: 4, activity: [] };
        const moved = lineup();
        fresh = editorData({}, { version: 4, groups: [{ index: 1, slots: [{ ...TANK, pos: 1 }] }, { index: 3, slots: [{ ...MAGE, pos: 1 }] }], bench: moved.bench });
        await show();
        await waitFor(() => expect(getCalls("/api/raids/setup?event=ev1&light=1")).toHaveLength(1));
        await waitFor(() => expect(within(group(3)).getByText("Ignis")).toBeInTheDocument());
    });

    it("applies a move that met a newer lineup to that lineup and saves it again", async () => {
        const user = userEvent.setup();
        let puts = 0;
        fresh = editorData({}, { version: 5 });
        vi.mocked(client.send).mockImplementation((method: string, path: string) => {
            if (path === PRESENCE) return Promise.resolve(presence);
            if (method === "PUT" && path === "/api/raids/setup") {
                puts += 1;
                return puts === 1 ? Promise.reject({ code: "conflict", message: "Das Setup wurde inzwischen geändert – bitte neu laden." }) : Promise.resolve({ ...page, setup: { ...page.setup!, version: 6 } });
            }
            return Promise.resolve(page);
        });
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(group(3)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) })[0]);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(2));
        const again = calls("PUT", "/api/raids/setup")[1][2] as { version: number; groups: { index: number; slots: { userId: string }[] }[] };
        expect(again.version).toBe(5);
        expect(again.groups.find((g) => g.slots.some((s) => s.userId === MAGE.userId))?.index).toBe(3);
        expect(await screen.findByText(t("setup.live.rebased"))).toBeInTheDocument();
    });

    it("lists what the others did under \"Gerade eben\" and lets the raider they moved glow with their name", async () => {
        presence = {
            editors: [{ userId: "o2", name: "Taccop", action: null }], version: 3,
            activity: [{ id: 1, at: Date.now() - 20_000, by: "o2", byName: "Taccop", kind: "move", userId: TANK.userId, character: "Bruno", to: { group: 1 } }],
        };
        const user = userEvent.setup();
        await show();
        const feed = await screen.findByRole("region", { name: t("setup.live.feed") });
        expect(feed).toHaveTextContent(t("setup.live.toGroup", { who: "Taccop", character: "Bruno", group: 1 }));
        // history from before the page opened does not glow
        expect(slot("Bruno")).not.toHaveClass("se-flash");
        // the next heartbeat (here: set off by a pick) brings news, and that glows
        presence = { ...presence, activity: [{ id: 2, at: Date.now(), by: "o2", byName: "Taccop", kind: "move", userId: MAGE.userId, character: "Ignis", to: { bench: true } }] };
        await user.click(slot("Bruno"));
        await waitFor(() => expect(slot("Ignis")).toHaveClass("se-flash"));
        expect(within(slot("Ignis")).getByText("Taccop")).toBeInTheDocument();
        expect(feed).toHaveTextContent(t("setup.live.toBench", { who: "Taccop", character: "Ignis" }));
    });
});

it("sends the event with every heartbeat", async () => {
    await show();
    expect(calls("POST", PRESENCE)[0][2]).toMatchObject({ event: EVENT_ID });
});
