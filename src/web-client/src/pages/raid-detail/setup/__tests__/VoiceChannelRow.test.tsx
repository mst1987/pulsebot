// The raid's voice channel under the setup editor's bar (docs/channels.md): its
// state as words and the "Kanal" menu. The transport is mocked, nothing leaves the test.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { VoiceRaid } from "../../../../api";
import { t } from "../../../../i18n";
import { formatTime, formatWeekday } from "../../../../lib/format";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import { clock } from "../setupText";
import VoiceChannelRow from "../VoiceChannelRow";
import { voiceStateLine } from "../voiceState";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const NOW = Math.floor(Date.now() / 1000);
const base: VoiceRaid = { eventId: "ev1", index: 1, total: 2, mode: "temp", kind: "temp", state: "planned", name: "SSC 1 · Sa 31.10.", openAt: NOW + 600, endAt: NOW + 4 * 3600, limitAt: NOW + 5 * 3600, parentName: "Raids" };

// Saturday 31.10.2026, open 19:30, end 23:00, close 23:30 (Berlin, UTC+1): one day.
const SAT = { openAt: Date.UTC(2026, 9, 31, 18, 30) / 1000, endAt: Date.UTC(2026, 9, 31, 22, 0) / 1000, limitAt: Date.UTC(2026, 9, 31, 22, 30) / 1000 };

function serve(raid: Partial<VoiceRaid> | null, botOnline = true) {
    const raids = raid ? [{ ...base, ...raid }, { ...base, eventId: "ev2", index: 2, name: "SSC 2" }] : [];
    vi.mocked(client.get).mockResolvedValue({ botOnline, raids } as never);
}

beforeEach(() => {
    vi.mocked(client.get).mockReset();
    vi.mocked(client.send).mockReset();
});

const show = (canWrite = true) => renderPage(<VoiceChannelRow eventId="ev1" canWrite={canWrite} />);

describe("voiceStateLine", () => {
    const at = (sec: number) => new Date(sec * 1000).toTimeString().slice(0, 5);
    it("names the weekday of a close past midnight", () => {
        const sunday = SAT.endAt + 3600 + 1800; // Sunday 00:30 Berlin
        const line = voiceStateLine({ ...base, ...SAT, limitAt: sunday, state: "open" }, t);
        expect(line).toContain(t("channels.voiceRow.closesBy", { time: `${formatWeekday(sunday * 1000)} ${formatTime(sunday * 1000)}` }));
        expect(formatTime(sunday * 1000)).toBe("00:30");
        // without an open time the end is the day it is measured against
        expect(voiceStateLine({ ...base, ...SAT, openAt: undefined, limitAt: sunday, state: "open" }, t)).toContain(formatWeekday(sunday * 1000));
    });

    it("words every state", () => {
        expect(voiceStateLine({ ...base, kind: "fixed", state: "fixed", members: 3 }, t)).toBe(`${t("channels.voiceRow.fixed")} · ${t("channels.voiceRow.members", { count: 3 })}`);
        expect(voiceStateLine(base, t)).toContain(at(base.openAt!));
        expect(voiceStateLine(base, t)).toContain("Raids");
        expect(voiceStateLine({ ...base, parentName: undefined }, t)).toBe(`${t("channels.voiceRow.temp")} · ${t("channels.voiceRow.planned", { time: at(base.openAt!) })}`);
        // clock() adds the date on any other day than today, so the fixed Saturday only keeps its time
        expect(voiceStateLine({ ...base, ...SAT, state: "open", members: 7 }, t)).toBe([t("channels.voiceRow.open"), t("channels.voiceRow.members", { count: 7 }), t("channels.voiceRow.closesBy", { time: clock(SAT.limitAt * 1000) })].join(" · "));
        expect(clock(SAT.limitAt * 1000)).toContain("23:30");
        expect(voiceStateLine({ ...base, state: "creating" }, t)).toBe(`${t("channels.voiceRow.temp")} · ${t("channels.voiceRow.creating")}`);
        expect(voiceStateLine({ ...base, state: "open", members: null }, t)).not.toContain(t("channels.voiceRow.members", { count: 0 }));
        expect(voiceStateLine({ ...base, state: "closed", closedAt: NOW }, t)).toBe(t("channels.voiceRow.closedAt", { time: at(NOW) }));
        expect(voiceStateLine({ ...base, state: "closed" }, t)).toBe(t("channels.voiceRow.closed"));
        expect(voiceStateLine({ ...base, state: "failed", error: "Missing Access" }, t)).toBe(t("channels.voiceRow.failed", { error: "Missing Access" }));
        expect(voiceStateLine({ ...base, state: "none", kind: "none" }, t)).toBe("");
    });
});

describe("VoiceChannelRow", () => {
    it("shows nothing for a raid without a channel or when the answer is not a list", async () => {
        serve({ kind: "none", state: "none" });
        const { container } = show();
        await waitFor(() => expect(client.get).toHaveBeenCalledWith("/api/raids/voice?event=ev1"));
        expect(container.querySelector(".se-voice")).toBeNull();
        vi.mocked(client.get).mockResolvedValue({ unrelated: true } as never);
        const second = show();
        await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
        expect(second.container.querySelector(".se-voice")).toBeNull();
    });

    it("names the selected raid's channel and creates it now from the menu", async () => {
        serve({});
        vi.mocked(client.send).mockResolvedValue({ raids: [{ ...base, state: "open", channelId: "c9", url: "https://discord.com/channels/g/c9", members: 0 }] } as never);
        show();
        expect(await screen.findByText(base.name!)).toBeInTheDocument();
        expect(screen.queryByText("SSC 2")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: t("channels.voiceRow.menu") }));
        const menu = screen.getByRole("menu");
        expect(within(menu).queryByRole("menuitem", { name: t("channels.voiceRow.close") })).toBeNull();
        await userEvent.click(within(menu).getByRole("menuitem", { name: t("channels.voiceRow.openNow") }));
        expect(client.send).toHaveBeenCalledWith("POST", "/api/raids/voice/open", { event: "ev1" });
        expect(await screen.findByText(new RegExp(t("channels.voiceRow.closesBy", { time: "" }).trim()))).toBeInTheDocument();
    });

    it("closes an open channel and opens it in Discord", async () => {
        serve({ state: "open", channelId: "c9", url: "https://discord.com/channels/g/c9", members: 3 });
        vi.mocked(client.send).mockResolvedValue({ raids: [{ ...base, state: "closed", closedAt: NOW }] } as never);
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        show();
        await userEvent.click(await screen.findByRole("button", { name: t("channels.voiceRow.menu") }));
        await userEvent.click(screen.getByRole("menuitem", { name: t("channels.voiceRow.inDiscord") }));
        expect(open).toHaveBeenCalledWith("https://discord.com/channels/g/c9", "_blank", "noopener");
        await userEvent.click(screen.getByRole("button", { name: t("channels.voiceRow.menu") }));
        await userEvent.click(screen.getByRole("menuitem", { name: t("channels.voiceRow.close") }));
        expect(client.send).toHaveBeenCalledWith("POST", "/api/raids/voice/close", { event: "ev1" });
        expect(await screen.findByText(t("channels.voiceRow.closedAt", { time: new Date(NOW * 1000).toTimeString().slice(0, 5) }))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("channels.voiceRow.menu") })).toBeNull();
        open.mockRestore();
    });

    it("reports a failed action as a toast and keeps the row", async () => {
        serve({ state: "failed", error: "Missing Access" });
        vi.mocked(client.send).mockRejectedValue({ code: "discord", message: "Discord lehnt ab." });
        show();
        await userEvent.click(await screen.findByRole("button", { name: t("channels.voiceRow.menu") }));
        await userEvent.click(screen.getByRole("menuitem", { name: t("channels.voiceRow.openNow") }));
        expect(await screen.findByText("Discord lehnt ab.")).toBeInTheDocument();
        expect(screen.getByText(t("channels.voiceRow.failed", { error: "Missing Access" }))).toBeInTheDocument();
    });

    it("warns about missing rights and an offline bot", async () => {
        serve({ missingRights: ["ManageChannels", "MoveMembers"] }, false);
        show();
        const rights = [t("settings.categories.tempRight.ManageChannels"), t("settings.categories.tempRight.MoveMembers")].join(", ");
        expect(await screen.findByText(t("channels.voiceRow.missingRights", { rights }))).toBeInTheDocument();
        expect(rights).not.toContain("ManageChannels");
        expect(screen.getByText(t("channels.voiceRow.botOffline"))).toBeInTheDocument();
    });

    it("names the missing rights in the page's language, not the API's keys", async () => {
        serve({ missingRights: ["ManageChannels", "MoveMembers"] });
        await switchLang("en");
        try {
            show();
            expect(await screen.findByText(t("channels.voiceRow.missingRights", { rights: "Manage Channels, Move Members" }))).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });

    it("offers only Discord for a fixed channel and no actions without the right to write", async () => {
        serve({ kind: "fixed", state: "fixed", mode: "existing", url: "https://discord.com/channels/g/f1", members: 2, name: "Raid" });
        show(false);
        await userEvent.click(await screen.findByRole("button", { name: t("channels.voiceRow.menu") }));
        expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([t("channels.voiceRow.inDiscord")]);
    });

    it("follows the server's canOpen: offered after a close, not while creating", async () => {
        serve({ state: "closed", closedAt: NOW, canOpen: true });
        show();
        await userEvent.click(await screen.findByRole("button", { name: t("channels.voiceRow.menu") }));
        expect(screen.getByRole("menuitem", { name: t("channels.voiceRow.openNow") })).toBeInTheDocument();
    });

    it("has no menu while the channel is being created", async () => {
        serve({ state: "creating", canOpen: false });
        show();
        expect(await screen.findByText(base.name!)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("channels.voiceRow.menu") })).toBeNull();
    });

    it("has no menu for a planned channel without the right to write", async () => {
        serve({});
        show(false);
        expect(await screen.findByText(base.name!)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("channels.voiceRow.menu") })).toBeNull();
    });
});
