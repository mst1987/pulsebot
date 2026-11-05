// Own Twitch requests in "Mein Profil": what each status offers, and that only the name and the
// server ever leave the page. The rights live in the server's routes, tested there.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TwitchPart } from "../TwitchPart";
import type { ProfileTwitch, ProfileTwitchServer } from "../../../api";

const api = vi.hoisted(() => ({
    requestTwitch: vi.fn(),
    withdrawTwitch: vi.fn(),
    removeOwnTwitch: vi.fn(),
    getProfileTwitch: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock("../../../api", async (original) => ({ ...(await original<typeof import("../../../api")>()), ...api }));
vi.mock("../../../components/shell/Jobs", () => ({ useToast: () => toast }));
vi.mock("../../../components/ui/overlay/Modal", async (original) => ({
    ...(await original<typeof import("../../../components/ui/overlay/Modal")>()),
    useConfirm: () => confirm,
}));

const GUILD = "111111111111111111";
const server = (over: Partial<ProfileTwitchServer> = {}): ProfileTwitchServer => ({
    guildId: GUILD, name: "Pulse", icon: "", status: "none", login: "", requestedAt: 0, decidedAt: 0, ...over,
});
const data = (over: Partial<ProfileTwitchServer> = {}, lastLogin = ""): ProfileTwitch => ({ servers: [server(over)], lastLogin });
const apiError = (code: string, message = "Server sagt nein") => Object.assign(new Error(message), { code });
const nameInput = () => screen.getByRole("textbox") as HTMLInputElement;
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

function show(value: ProfileTwitch) {
    const onChange = vi.fn();
    render(<TwitchPart data={value} onChange={onChange} />);
    return onChange;
}

beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach((fn) => fn.mockReset());
    toast.mockReset();
    confirm.mockReset();
});

describe("asking", () => {
    it("needs a name first, then sends only the server and the name", async () => {
        const next = data({ status: "pending", login: "annastream" }, "annastream");
        api.requestTwitch.mockResolvedValue(next);
        const onChange = show(data());
        expect(button(/Anfragen/).disabled).toBe(true);
        fireEvent.change(nameInput(), { target: { value: " twitch.tv/annastream " } });
        fireEvent.click(button(/Anfragen/));
        await waitFor(() => expect(api.requestTwitch).toHaveBeenCalledWith(GUILD, "twitch.tv/annastream"));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
        expect(toast).toHaveBeenCalledWith("Anfrage gestellt.");
    });

    it("starts with the name used last, so asking on a second server takes one click", () => {
        show(data({}, "annastream"));
        expect(nameInput().value).toBe("annastream");
        expect(button(/Anfragen/).disabled).toBe(false);
    });

    it("may ask again after a rejection", () => {
        show(data({ status: "rejected", login: "annastream" }, "annastream"));
        expect(screen.getByText("Abgelehnt")).toBeTruthy();
        expect(button(/Anfragen/).disabled).toBe(false);
    });

    it.each([
        ["invalid_login", "kein gültiger"],
        ["not_member", "kein Mitglied"],
        ["member_unknown", "nicht prüfen"],
    ])("words the refusal %s and leaves the rows alone", async (code, words) => {
        api.requestTwitch.mockRejectedValue(apiError(code));
        const onChange = show(data({}, "annastream"));
        fireEvent.click(button(/Anfragen/));
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining(words), "err"));
        expect(api.getProfileTwitch).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        ["already_open", "wartet schon"],
        ["already_approved", "schon in der Liste"],
        ["already_listed", "schon in der Liste"],
        ["not_found", "keinen Eintrag"],
    ])("words the refusal %s and reloads the stale rows", async (code, words) => {
        const fresh = data({ status: "pending", login: "annastream" }, "annastream");
        api.requestTwitch.mockRejectedValue(apiError(code));
        api.getProfileTwitch.mockResolvedValue(fresh);
        const onChange = show(data({}, "annastream"));
        fireEvent.click(button(/Anfragen/));
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining(words), "err"));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(fresh));
    });

    it("keeps the refusal on screen when the reload fails as well", async () => {
        api.requestTwitch.mockRejectedValue(apiError("already_open"));
        api.getProfileTwitch.mockRejectedValue(apiError("offline"));
        const onChange = show(data({}, "annastream"));
        fireEvent.click(button(/Anfragen/));
        await waitFor(() => expect(api.getProfileTwitch).toHaveBeenCalled());
        await waitFor(() => expect(button(/Anfragen/).disabled).toBe(false));
        expect(toast).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe("when Discord cannot answer", () => {
    it("says so above the rows that are safe to show", () => {
        show({ ...data({ status: "pending", login: "annastream" }), unknown: true });
        expect(screen.getByRole("status").textContent).toContain("Discord antwortet gerade nicht");
        expect(screen.getByText("Pulse")).toBeTruthy();
    });

    it("does not claim there is no server when it cannot know", () => {
        show({ servers: [], lastLogin: "", unknown: true });
        expect(screen.getByRole("status").textContent).toContain("Discord antwortet gerade nicht");
        expect(screen.queryByText(/auf keinem Server/)).toBeNull();
    });

    it("has no such sentence when Discord answered", () => {
        show({ servers: [], lastLogin: "", unknown: false });
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByText(/auf keinem Server/)).toBeTruthy();
    });
});

describe("a waiting request", () => {
    it("can be withdrawn and offers nothing else", async () => {
        const next = data({}, "annastream");
        api.withdrawTwitch.mockResolvedValue(next);
        const onChange = show(data({ status: "pending", login: "annastream" }, "annastream"));
        expect(screen.getByText("Wartet auf Freigabe")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Anfragen/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Austragen/ })).toBeNull();
        fireEvent.click(button(/Zurückziehen/));
        await waitFor(() => expect(api.withdrawTwitch).toHaveBeenCalledWith(GUILD));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
    });
});

describe("an approved entry", () => {
    const approved = () => data({ status: "approved", login: "annastream" }, "annastream");

    it("asks before removing and does nothing on no", async () => {
        confirm.mockResolvedValue(false);
        show(approved());
        expect(screen.getByText("Freigegeben")).toBeTruthy();
        fireEvent.click(button(/Austragen/));
        await waitFor(() => expect(confirm).toHaveBeenCalled());
        expect(api.removeOwnTwitch).not.toHaveBeenCalled();
    });

    it("removes on yes", async () => {
        confirm.mockResolvedValue(true);
        const next = data({}, "annastream");
        api.removeOwnTwitch.mockResolvedValue(next);
        const onChange = show(approved());
        fireEvent.click(button(/Austragen/));
        await waitFor(() => expect(api.removeOwnTwitch).toHaveBeenCalledWith(GUILD));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
        expect(confirm.mock.calls[0][0].text).toContain("annastream");
        expect(confirm.mock.calls[0][0].text).toContain("Pulse");
    });
});

describe("the table", () => {
    it("has one row per server with its own status", () => {
        show({
            servers: [
                server({ guildId: "1", name: "Eins", status: "approved", login: "annastream" }),
                server({ guildId: "2", name: "Zwei" }),
            ],
            lastLogin: "annastream",
        });
        const rows = screen.getAllByRole("row");
        const row = (name: string) => rows.find((r) => r.textContent?.includes(name)) as HTMLElement;
        expect(within(row("Eins")).getByText("Freigegeben")).toBeTruthy();
        expect(within(row("Zwei")).getByText("Kein Eintrag")).toBeTruthy();
        // the name sits under the server, and only where there is one
        expect(within(row("Eins")).getByText("annastream")).toBeTruthy();
        expect(within(row("Zwei")).queryByText("annastream")).toBeNull();
    });

    it("has one sentence without a server", () => {
        show({ servers: [], lastLogin: "" });
        expect(screen.getByText(/keinem Server/)).toBeTruthy();
    });
});
