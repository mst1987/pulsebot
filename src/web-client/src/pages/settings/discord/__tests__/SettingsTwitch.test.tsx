// The Twitch section of Einstellungen › Server: the table, the dialog, status and errors in
// words, the 409 after a server switch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsTwitch from "../SettingsTwitch";
import type { Role, TextChannel, TwitchStreamer, TwitchView } from "../../../../api";

const api = vi.hoisted(() => ({
    getTwitchSettings: vi.fn(),
    addTwitchStreamer: vi.fn(),
    updateTwitchStreamer: vi.fn(),
    removeTwitchStreamer: vi.fn(),
    checkTwitchStreamers: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock("../../../../api", async (original) => ({ ...(await original<typeof import("../../../../api")>()), ...api }));
vi.mock("../../../../components/shell/Jobs", () => ({ useToast: () => toast }));
vi.mock("../../../../components/ui/overlay/Modal", async (original) => ({
    ...(await original<typeof import("../../../../components/ui/overlay/Modal")>()),
    useConfirm: () => confirm,
}));

const GUILD = "111111111111111111";
const channels: TextChannel[] = [{ id: "c1", name: "streams", category: "" }, { id: "c2", name: "neu", category: "" }];
const roles: Role[] = [{ id: "r1", name: "Stream-Ping" }];

const streamer = (over: Partial<TwitchStreamer> = {}): TwitchStreamer => ({
    login: "somebody", channelId: "c1", roleId: "", text: "", games: [], source: "orga",
    status: { state: "offline", since: "", endedAt: 0, title: "", game: "", viewers: 0, messageGone: false, error: "", postedChannelId: "" },
    ...over,
});
const view = (over: Partial<TwitchView> = {}): TwitchView => ({
    guildId: GUILD, hasCredentials: true, lastRun: { at: 0, error: "" },
    limits: { streamers: 25, textLength: 500, games: 5, gameNameLength: 60 },
    streamers: [streamer()],
    ...over,
});
const apiError = (code: string) => Object.assign(new Error(code), { code });

function show() {
    return render(
        <MemoryRouter>
            <SettingsTwitch guildId={GUILD} channels={channels} roles={roles} />
        </MemoryRouter>,
    );
}
const openAdd = async () => fireEvent.click(await screen.findByRole("button", { name: /Hinzufügen/ }));
const dialog = async () => within(await screen.findByRole("dialog"));
const type = (id: string, value: string) => fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } });

beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach((fn) => fn.mockReset());
    toast.mockReset();
    confirm.mockReset();
    api.getTwitchSettings.mockResolvedValue(view());
});

describe("the table", () => {
    it("shows channel, role, filter and status of an entry in words", async () => {
        api.getTwitchSettings.mockResolvedValue(view({
            streamers: [streamer({
                roleId: "r1", games: ["World of Warcraft", "Chess"],
                status: { state: "live", since: "2026-11-03T20:14:00", endedAt: 0, title: "Kara", game: "World of Warcraft", viewers: 12, messageGone: false, error: "", postedChannelId: "" },
            })],
        }));
        show();
        const link = await screen.findByRole("link", { name: "somebody" });
        expect(link.getAttribute("href")).toBe("https://www.twitch.tv/somebody");
        expect(screen.getByText("#streams")).toBeTruthy();
        expect(screen.getByText("@Stream-Ping")).toBeTruthy();
        expect(screen.getByText("World of Warcraft und 1 weiteres")).toBeTruthy();
        const live = screen.getByText(/^Live seit|^Live/);
        expect(live.className).toContain("is-live");
        expect(live.getAttribute("data-tip-sub")).toContain("Kara");
    });

    it("shows an error in plain words instead of the code", async () => {
        api.getTwitchSettings.mockResolvedValue(view({
            streamers: [streamer({ status: { ...streamer().status, error: "no_permission" } })],
        }));
        const { container } = show();
        await screen.findByRole("link", { name: "somebody" });
        const cell = container.querySelector(".tws-status") as HTMLElement;
        expect(cell.className).toContain("is-bad");
        expect(cell.textContent).not.toContain("no_permission");
    });

    it("says where a running message stays after the channel changed", async () => {
        api.getTwitchSettings.mockResolvedValue(view({
            streamers: [streamer({
                channelId: "c2",
                status: { ...streamer().status, state: "live", since: "2026-11-03T20:14:00", postedChannelId: "c1" },
            })],
        }));
        const { container } = show();
        await screen.findByRole("link", { name: "somebody" });
        expect(container.querySelector(".tws-note")?.textContent).toContain("#streams");
    });

    it("mentions a deleted message only while the stream runs", async () => {
        api.getTwitchSettings.mockResolvedValue(view({
            streamers: [
                streamer({ login: "live_one", status: { ...streamer().status, state: "live", since: "2026-11-03T20:14:00", messageGone: true } }),
                streamer({ login: "done_one", status: { ...streamer().status, messageGone: true } }),
            ],
        }));
        const { container } = show();
        await screen.findByRole("link", { name: "live_one" });
        expect(container.querySelectorAll(".tws-note")).toHaveLength(1);
    });

    it("sorts by status with errors first, and by name on click", async () => {
        api.getTwitchSettings.mockResolvedValue(view({
            streamers: [
                streamer({ login: "aaa" }),
                streamer({ login: "zzz", status: { ...streamer().status, error: "channel_gone" } }),
            ],
        }));
        const { container } = show();
        await screen.findByRole("link", { name: "aaa" });
        const names = () => [...container.querySelectorAll(".tws-name")].map((n) => n.textContent);
        expect(names()).toEqual(["zzz", "aaa"]);
        fireEvent.click(screen.getByRole("columnheader", { name: /Streamer/ }).querySelector("button") || screen.getByText("Streamer"));
        expect(names()).toEqual(["aaa", "zzz"]);
    });

    it("has one sentence when nothing is set up", async () => {
        api.getTwitchSettings.mockResolvedValue(view({ streamers: [] }));
        const { container } = show();
        await waitFor(() => expect(container.querySelector(".tws-empty")).toBeTruthy());
        expect(container.querySelector("table")).toBeNull();
    });

    it("points at the missing Twitch app", async () => {
        api.getTwitchSettings.mockResolvedValue(view({ hasCredentials: false }));
        const { container } = show();
        await waitFor(() => expect(container.querySelector(".tws-missing")).toBeTruthy());
    });

    it("words a failed load", async () => {
        api.getTwitchSettings.mockRejectedValue(apiError("no_active_server"));
        show();
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).not.toContain("no_active_server");
    });

    it("stops offering Hinzufügen at the limit and says why", async () => {
        const many = Array.from({ length: 25 }, (_, i) => streamer({ login: `streamer_${i}` }));
        api.getTwitchSettings.mockResolvedValue(view({ streamers: many }));
        const { container } = show();
        const add = await screen.findByRole("button", { name: /Hinzufügen/ }) as HTMLButtonElement;
        expect(add.disabled).toBe(true);
        expect(container.querySelector(".tws-hint")?.textContent).toContain("25");
    });
});

describe("Jetzt prüfen", () => {
    it("takes over the new status and reports the count in words", async () => {
        api.checkTwitchStreamers.mockResolvedValue({ ...view({ lastRun: { at: new Date("2026-11-03T20:14:00").getTime(), error: "" } }), result: { checked: 1, live: 0 } });
        show();
        fireEvent.click(await screen.findByRole("button", { name: /Jetzt prüfen/ }));
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(api.checkTwitchStreamers).toHaveBeenCalledWith(GUILD);
        expect(toast.mock.calls[0][1]).toBe("ok");
        expect(await screen.findByText(/20:14/)).toBeTruthy();
    });

    it("warns when the run was skipped", async () => {
        api.checkTwitchStreamers.mockResolvedValue({ ...view(), result: { skipped: "rate_limited" } });
        show();
        fireEvent.click(await screen.findByRole("button", { name: /Jetzt prüfen/ }));
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][1]).toBe("warn");
        expect(toast.mock.calls[0][0]).not.toContain("rate_limited");
    });
});

describe("the dialog", () => {
    it("adds a streamer with everything the form holds", async () => {
        api.addTwitchStreamer.mockResolvedValue(view());
        show();
        await openAdd();
        const d = await dialog();
        const save = d.getByRole("button", { name: /Speichern/ }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        type("tws-login", "https://twitch.tv/somebody ");
        fireEvent.change(document.getElementById("tws-channel") as HTMLElement, { target: { value: "c1" } });
        type("tws-text", "{streamer} ist live");
        type("tws-game", "World of Warcraft");
        expect(save.disabled).toBe(false);
        // the game still in the input counts: it must not get lost on save
        fireEvent.click(save);
        await waitFor(() => expect(api.addTwitchStreamer).toHaveBeenCalled());
        expect(api.addTwitchStreamer).toHaveBeenCalledWith(GUILD, {
            login: "https://twitch.tv/somebody", channelId: "c1", roleId: "", text: "{streamer} ist live", games: ["World of Warcraft"],
        });
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps the name fixed when editing and sends a removed role as empty", async () => {
        api.getTwitchSettings.mockResolvedValue(view({ streamers: [streamer({ roleId: "r1", games: ["Chess"] })] }));
        api.updateTwitchStreamer.mockResolvedValue(view());
        show();
        await screen.findByRole("link", { name: "somebody" });
        fireEvent.click(document.querySelector(".tws-actions button") as HTMLElement);
        const d = await dialog();
        expect((document.getElementById("tws-login") as HTMLInputElement).readOnly).toBe(true);
        fireEvent.change(document.getElementById("tws-role") as HTMLElement, { target: { value: "" } });
        fireEvent.click(d.getByRole("button", { name: /Speichern/ }));
        await waitFor(() => expect(api.updateTwitchStreamer).toHaveBeenCalled());
        expect(api.updateTwitchStreamer).toHaveBeenCalledWith(GUILD, { login: "somebody", channelId: "c1", roleId: "", text: "", games: ["Chess"] });
    });

    it("counts the text and blocks saving past the limit", async () => {
        show();
        await openAdd();
        const d = await dialog();
        type("tws-login", "somebody");
        fireEvent.change(document.getElementById("tws-channel") as HTMLElement, { target: { value: "c1" } });
        type("tws-text", "x".repeat(501));
        expect(document.querySelector(".tws-counter-over")?.textContent).toContain("501");
        expect((d.getByRole("button", { name: /Speichern/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("refuses a too long game name visibly and does not save it away", async () => {
        show();
        await openAdd();
        const d = await dialog();
        type("tws-login", "somebody");
        fireEvent.change(document.getElementById("tws-channel") as HTMLElement, { target: { value: "c1" } });
        type("tws-game", "x".repeat(61));
        fireEvent.click(d.getByRole("button", { name: /Speichern/ }));
        expect(await d.findByText(/60/)).toBeTruthy();
        expect(api.addTwitchStreamer).not.toHaveBeenCalled();
    });

    it("adds game names by Enter and removes them again", async () => {
        show();
        await openAdd();
        await dialog();
        type("tws-game", "Chess");
        fireEvent.keyDown(document.getElementById("tws-game") as HTMLElement, { key: "Enter" });
        const chips = document.querySelector(".tws-games") as HTMLElement;
        expect(chips.textContent).toContain("Chess");
        expect((document.getElementById("tws-game") as HTMLInputElement).value).toBe("");
        fireEvent.click(within(chips).getByRole("button"));
        expect(document.querySelector(".tws-games")).toBeNull();
    });

    it("words a refusal of the server as a toast and keeps the dialog open", async () => {
        api.addTwitchStreamer.mockRejectedValue(apiError("duplicate_streamer"));
        show();
        await openAdd();
        const d = await dialog();
        type("tws-login", "somebody");
        fireEvent.change(document.getElementById("tws-channel") as HTMLElement, { target: { value: "c1" } });
        fireEvent.click(d.getByRole("button", { name: /Speichern/ }));
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][1]).toBe("err");
        expect(toast.mock.calls[0][0]).not.toContain("duplicate_streamer");
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("closes on 409 and stops offering writes", async () => {
        api.addTwitchStreamer.mockRejectedValue(apiError("server_switched"));
        show();
        await openAdd();
        const d = await dialog();
        type("tws-login", "somebody");
        fireEvent.change(document.getElementById("tws-channel") as HTMLElement, { target: { value: "c1" } });
        fireEvent.click(d.getByRole("button", { name: /Speichern/ }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Hinzufügen/ })).toBeNull();
        expect(document.querySelector(".tws-actions")).toBeNull();
    });
});

describe("removing", () => {
    it("asks first and does nothing on no", async () => {
        confirm.mockResolvedValue(false);
        show();
        await screen.findByRole("link", { name: "somebody" });
        fireEvent.click(document.querySelectorAll(".tws-actions button")[1]);
        await waitFor(() => expect(confirm).toHaveBeenCalled());
        expect(api.removeTwitchStreamer).not.toHaveBeenCalled();
    });

    it("removes on yes and takes the answer over", async () => {
        confirm.mockResolvedValue(true);
        api.removeTwitchStreamer.mockResolvedValue(view({ streamers: [] }));
        const { container } = show();
        await screen.findByRole("link", { name: "somebody" });
        fireEvent.click(document.querySelectorAll(".tws-actions button")[1]);
        await waitFor(() => expect(api.removeTwitchStreamer).toHaveBeenCalledWith(GUILD, "somebody"));
        await waitFor(() => expect(container.querySelector(".tws-empty")).toBeTruthy());
    });

    it("reports a failure in words", async () => {
        confirm.mockResolvedValue(true);
        api.removeTwitchStreamer.mockRejectedValue(apiError("not_found"));
        show();
        await screen.findByRole("link", { name: "somebody" });
        fireEvent.click(document.querySelectorAll(".tws-actions button")[1]);
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][1]).toBe("err");
        expect(toast.mock.calls[0][0]).not.toContain("not_found");
    });
});
