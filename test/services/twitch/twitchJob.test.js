const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockGetStreams = jest.fn();
const mockDiscord = {
    isOnline: jest.fn(),
    isGuildAvailable: jest.fn(),
    postPayload: jest.fn(),
    editPayload: jest.fn(),
};
let mockConfig;

jest.mock("../../../src/logger", () => ({ ...mockLog, child: () => mockLog }));
jest.mock("../../../src/classes/twitch", () =>jest.fn().mockImplementation(() => ({ getStreams: mockGetStreams })));
jest.mock("../../../src/services/discord/discord", () => mockDiscord);
jest.mock("../../../src/services/discord/botLanguage", () => ({ serverLang: () => "de" }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));

const Twitch = require("../../../src/classes/twitch");
const job = require("../../../src/services/twitch/twitchJob");
const stateStore = require("../../../src/stores/discord/twitchStateStore");
const { TWITCH_COLOR, ENDED_COLOR } = require("../../../src/services/twitch/twitchCard");

const MINUTE = 60 * 1000;
const T0 = 1800000000000;
const GUILD_A = "100000";
const GUILD_B = "200000";
const CHANNEL_A = "111111";
const CHANNEL_B = "222222";
const ROLE = "555555";

const entry = (over = {}) => ({ login: "foo", channelId: CHANNEL_A, roleId: ROLE, text: "", games: [], source: "orga", ...over });
const stream = (over = {}) => ({
    id: "s1",
    user_login: "foo",
    user_name: "Foo",
    title: "Raidabend",
    game_name: "World of Warcraft",
    viewer_count: 10,
    thumbnail_url: "https://cdn.example/foo-{width}x{height}.jpg",
    started_at: "2026-11-03T18:00:00Z",
    type: "live",
    ...over,
});

function list(guildId, ...entries) {
    mockConfig.serverSettings[guildId] = { twitchStreamers: entries };
}

/** One run in which Twitch answers `streams` at `at` minutes after T0. */
function runAt(at, streams = [], opts = {}) {
    mockGetStreams.mockResolvedValueOnce(streams);
    return job.runTwitchCheck({ now: T0 + at * MINUTE, ...opts });
}

const statusOf = (login = "foo", guildId = GUILD_A) => job.twitchStatusOf([{ guildId, login }])[0];
const accentOf = (payload) => payload.components[0].accent_color;
const textOf = (payload) => JSON.stringify(payload.components);

let stateFile;

beforeEach(() => {
    stateFile = tempStoreFile("twitch-state.json");
    stateStore.useFile(stateFile);
    job._resetForTests();
    mockConfig = { twitch: { clientId: "id", clientSecret: "secret" }, serverSettings: {} };
    mockGetStreams.mockReset();
    Object.values(mockLog).forEach((fn) => fn.mockClear());
    Twitch.mockClear();
    mockDiscord.isOnline.mockReset().mockReturnValue(true);
    mockDiscord.isGuildAvailable.mockReset().mockReturnValue(true);
    mockDiscord.postPayload.mockReset().mockResolvedValue({ messageId: "m1", channelId: CHANNEL_A });
    mockDiscord.editPayload.mockReset().mockResolvedValue({});
    list(GUILD_A, entry());
});

afterEach(() => {
    job._resetForTests();
    stateStore.useFile(null);
});

describe("announcing", () => {
    it("posts once with the one role as ping and keeps the state on record at once", async () => {
        await expect(runAt(0, [stream()])).resolves.toEqual({ checked: 1, live: 1 });

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        const [channelId, payload, opts] = mockDiscord.postPayload.mock.calls[0];
        expect(channelId).toBe(CHANNEL_A);
        expect(opts).toEqual({ guildId: GUILD_A, pingRoleId: ROLE });
        expect(accentOf(payload)).toBe(TWITCH_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ announced: true, messageId: "m1", streamId: "s1" });
        expect(statusOf()).toMatchObject({ state: "live", title: "Raidabend", game: "World of Warcraft", viewers: 10, error: "" });
    });

    it("does not ping twice after a restart while the stream id stays the same", async () => {
        await runAt(0, [stream()]);

        // a real restart: fresh modules that only have the file on disk
        let fresh;
        jest.isolateModules(() => {
            require("../../../src/stores/discord/twitchStateStore").useFile(stateFile);
            fresh = require("../../../src/services/twitch/twitchJob");
        });
        mockGetStreams.mockResolvedValueOnce([stream()]);
        await fresh.runTwitchCheck({ now: T0 + 2 * MINUTE });

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("never lets @everyone in the own text ping: only the chosen role, and every edit with parse: []", async () => {
        list(GUILD_A, entry({ text: "@everyone schaut rein" }));
        await runAt(0, [stream()]);

        const [, posted, opts] = mockDiscord.postPayload.mock.calls[0];
        expect(posted.allowedMentions).toEqual({ parse: [] });
        expect(opts.pingRoleId).toBe(ROLE);
        expect(textOf(posted)).toContain(`<@&${ROLE}>`);

        await runAt(5, [stream({ viewer_count: 99 })]);
        expect(mockDiscord.editPayload.mock.calls[0][2].allowedMentions).toEqual({ parse: [] });
    });

    it("does not ask for a role when the entry has none", async () => {
        list(GUILD_A, entry({ roleId: "" }));
        await runAt(0, [stream()]);
        expect(mockDiscord.postPayload.mock.calls[0][2].pingRoleId).toBe("");
        expect(textOf(mockDiscord.postPayload.mock.calls[0][1])).not.toContain("<@&");
    });

    it("asks for a streamer on two servers once and announces on both", async () => {
        list(GUILD_A, entry());
        list(GUILD_B, entry({ channelId: CHANNEL_B }));
        await runAt(0, [stream()]);

        expect(mockGetStreams).toHaveBeenCalledTimes(1);
        expect(mockGetStreams).toHaveBeenCalledWith(["foo"]);
        expect(mockDiscord.postPayload.mock.calls.map((c) => c[0]).sort()).toEqual([CHANNEL_A, CHANNEL_B]);
    });

    it("keeps the client of unchanged credentials and makes a new one when they change", async () => {
        await runAt(0, []);
        await runAt(2, []);
        expect(Twitch).toHaveBeenCalledTimes(1);
        mockConfig.twitch.clientSecret = "other";
        await runAt(4, []);
        expect(Twitch).toHaveBeenCalledTimes(2);
    });
});

describe("the end of a stream", () => {
    it("ends only after 2 clean answers without the stream", async () => {
        await runAt(0, [stream()]);

        await runAt(2, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(statusOf().state).toBe("live");

        await runAt(4, []);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        const [channelId, messageId, payload] = mockDiscord.editPayload.mock.calls[0];
        expect([channelId, messageId]).toEqual([CHANNEL_A, "m1"]);
        expect(accentOf(payload)).toBe(ENDED_COLOR);
        expect(statusOf()).toMatchObject({ state: "offline", endedAt: T0 + 4 * MINUTE });

        await runAt(6, []);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("counts two offline answers closer than a minute once (Jetzt prüfen right after the job)", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(2.5, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        await runAt(3.5, []);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("starts counting again when the stream shows up between two offline answers", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, [stream()]);
        await runAt(6, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });

    it("tries the ended card again on the next run when the edit failed, and notes the error", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(4, []);
        expect(statusOf()).toMatchObject({ state: "offline", error: "no_permission" });
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(true);

        await runAt(6, []);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
        expect(statusOf().error).toBe("");
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(false);
    });
});

describe("the ended card that keeps failing", () => {
    const DAY = 24 * 60;

    async function failingFrom4() {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValue({ code: 500 });
        await runAt(4, []);
    }

    it("is tried for 24 hours from the first failure, then given up with its own code", async () => {
        await failingFrom4();
        await runAt(4 + DAY - 2, []);
        expect(statusOf().error).toBe("post_failed");
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: true, endFailingSince: T0 + 4 * MINUTE });

        await runAt(4 + DAY, []);
        expect(statusOf()).toMatchObject({ state: "offline", error: "end_gave_up" });
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: false, endFailingSince: 0 });

        // no more tries, and the code stays
        mockDiscord.editPayload.mockClear();
        await runAt(4 + DAY + 2, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(statusOf().error).toBe("end_gave_up");
    });

    it("lets the next stream post as usual, with its ping and without the code", async () => {
        await failingFrom4();
        await runAt(4 + DAY, []);
        mockDiscord.postPayload.mockClear();
        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_A });

        await runAt(4 + DAY + 2, [stream({ id: "s2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.postPayload.mock.calls[0][2]).toEqual({ guildId: GUILD_A, pingRoleId: ROLE });
        expect(statusOf()).toMatchObject({ state: "live", error: "" });
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageId: "m2", endPending: false });
    });

    it("loses the code as well when the next stream is filtered out", async () => {
        await failingFrom4();
        await runAt(4 + DAY, []);
        list(GUILD_A, entry({ games: ["Hearthstone"] }));

        await runAt(4 + DAY + 2, [stream({ id: "s2" })]);

        expect(statusOf()).toMatchObject({ state: "filtered", error: "" });
    });

    it("starts counting anew after an edit that worked", async () => {
        await failingFrom4();
        mockDiscord.editPayload.mockResolvedValueOnce({});
        await runAt(6, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: false, endFailingSince: 0, error: "" });
    });
});

describe("a restart of the stream", () => {
    it("sets the old message live again within 10 minutes, with a new stream id and without a ping", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, []);
        mockDiscord.editPayload.mockClear();

        await runAt(13, [stream({ id: "s2", title: "Teil 2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        const [, messageId, payload] = mockDiscord.editPayload.mock.calls[0];
        expect(messageId).toBe("m1");
        expect(accentOf(payload)).toBe(TWITCH_COLOR);
        expect(textOf(payload)).toContain("Teil 2");
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "s2", endedAt: 0, announced: true });
        expect(statusOf().state).toBe("live");
    });

    it("resumes a stream Twitch never reported as gone, whatever the game filter says now", async () => {
        list(GUILD_A, entry({ games: ["World of Warcraft"] }));
        await runAt(0, [stream()]);
        await runAt(2, [stream({ id: "s2", game_name: "Just Chatting" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("announces with a new ping after more than 10 minutes", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, []);
        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_A });

        await runAt(15, [stream({ id: "s2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageId: "m2", streamId: "s2" });
    });

    it("ends a message that was never ended before it announces a stream of its own", async () => {
        await runAt(0, [stream()]);
        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_A });

        await runAt(30, [stream({ id: "s2" })]);

        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        expect(accentOf(mockDiscord.editPayload.mock.calls[0][2])).toBe(ENDED_COLOR);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
    });
});

describe("Twitch does not answer", () => {
    it.each([
        ["a 500", { status: 500 }],
        ["a timeout", { kind: "timeout" }],
    ])("%s ends no stream and counts nothing", async (_name, failure) => {
        await runAt(0, [stream()]);
        await runAt(2, []);

        mockGetStreams.mockRejectedValueOnce(failure);
        await expect(job.runTwitchCheck({ now: T0 + 4 * MINUTE })).resolves.toEqual({ skipped: "twitch_unavailable" });

        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(stateStore.getTwitchState(GUILD_A, "foo").offlineCount).toBe(1);
        expect(statusOf().state).toBe("live");
        expect(job.lastTwitchRun()).toEqual({ at: T0 + 4 * MINUTE, error: "twitch_unavailable" });
    });

    it("a 429 ends nothing and skips exactly the next run", async () => {
        await runAt(0, [stream()]);

        mockGetStreams.mockRejectedValueOnce({ status: 429 });
        await expect(job.runTwitchCheck({ now: T0 + 2 * MINUTE })).resolves.toEqual({ skipped: "rate_limited" });
        expect(job.lastTwitchRun().error).toBe("rate_limited");
        mockGetStreams.mockClear();

        await expect(job.runTwitchCheck({ now: T0 + 4 * MINUTE })).resolves.toEqual({ skipped: "rate_limited" });
        expect(mockGetStreams).not.toHaveBeenCalled();

        await expect(runAt(6, [stream()])).resolves.toEqual({ checked: 1, live: 1 });
        expect(mockGetStreams).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(job.lastTwitchRun().error).toBe("");
    });

    it("takes a stream with an empty type as no statement at all", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, [stream({ type: "" })]);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(stateStore.getTwitchState(GUILD_A, "foo").offlineCount).toBe(1);
    });
});

describe("a message deleted in Discord", () => {
    async function deleted() {
        await runAt(0, [stream()]);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 10008 });
        await runAt(5, [stream({ viewer_count: 99 })]);
        mockDiscord.editPayload.mockClear();
    }

    it("is not posted again and not pinged again while the stream runs", async () => {
        await deleted();
        expect(statusOf()).toMatchObject({ state: "live", messageGone: true, error: "" });

        await runAt(10, [stream({ viewer_count: 150 })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });

    it("stays deleted when the stream comes back within 10 minutes with a new id", async () => {
        await deleted();
        await runAt(7, [stream({ id: "s2" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });

    it("needs no ended card when the stream is over", async () => {
        await deleted();
        await runAt(7, []);
        await runAt(9, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(statusOf().state).toBe("offline");
    });

    it("is noted when only the ended card finds out", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 10008 });
        await runAt(4, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageGone: true, messageId: "", endPending: false });
    });
});

describe("a failure of one entry", () => {
    beforeEach(() => {
        list(GUILD_A, entry(), entry({ login: "bar", channelId: CHANNEL_B }));
    });

    const both = [stream(), stream({ id: "s9", user_login: "bar", user_name: "Bar" })];

    it.each([
        ["a missing channel", { code: "channel_not_found" }, "channel_gone"],
        ["an unknown channel", { code: 10003 }, "channel_gone"],
        ["a missing access", { code: 50001 }, "no_permission"],
        ["a missing permission", { code: 50013 }, "no_permission"],
        ["a channel on another server", { code: "wrong_guild" }, "wrong_guild"],
        ["anything else", { code: 500 }, "post_failed"],
    ])("%s stays on that entry and the others go on", async (_name, failure, code) => {
        mockDiscord.postPayload.mockRejectedValueOnce(failure);
        await runAt(0, both);

        expect(statusOf("foo")).toMatchObject({ state: "filtered", error: code });
        expect(statusOf("bar")).toMatchObject({ state: "live", error: "" });
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
    });

    it("tries again on the next run, and only the post that works pings", async () => {
        mockDiscord.postPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(0, both);
        mockDiscord.postPayload.mockClear();

        await runAt(2, both);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.postPayload.mock.calls[0][0]).toBe(CHANNEL_A);
        expect(statusOf("foo")).toMatchObject({ state: "live", error: "" });
    });

    it("does not count an offline bot as the entry's fault", async () => {
        mockDiscord.postPayload.mockRejectedValueOnce({ code: "bot_offline" });
        await runAt(0, both);
        expect(statusOf("foo").error).toBe("");
    });

    it("keeps the error of a failed edit on the entry without losing the message", async () => {
        await runAt(0, both);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(5, [stream({ viewer_count: 99 }), both[1]]);
        expect(statusOf("foo")).toMatchObject({ state: "live", error: "no_permission", messageGone: false });
        expect(stateStore.getTwitchState(GUILD_A, "foo").messageId).toBe("m1");
    });

    it("concludes nothing for a server that fell out", async () => {
        await runAt(0, both);
        mockDiscord.isGuildAvailable.mockReturnValue(false);
        await runAt(2, []);
        await runAt(4, []);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(stateStore.getTwitchState(GUILD_A, "foo").offlineCount).toBe(0);
    });
});

describe("an error after the stream", () => {
    async function neverPosted() {
        mockDiscord.postPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(0, [stream()]);
        await runAt(2, []);
    }

    it("stays visible for a stream that was never posted", async () => {
        await neverPosted();
        expect(statusOf()).toMatchObject({ state: "offline", error: "no_permission", endedAt: 0, title: "" });

        await runAt(4, []);
        await runAt(6, []);
        expect(statusOf().error).toBe("no_permission");
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("goes with the next post that works, which is the one and only ping", async () => {
        await neverPosted();
        mockDiscord.postPayload.mockClear();

        await runAt(4, [stream({ id: "s2" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(statusOf()).toMatchObject({ state: "live", error: "" });

        await runAt(6, [stream({ id: "s2" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("survives a next stream that is filtered out: nothing was posted", async () => {
        await neverPosted();
        list(GUILD_A, entry({ games: ["Hearthstone"] }));

        await runAt(4, [stream({ id: "s2" })]);
        expect(statusOf()).toMatchObject({ state: "filtered", error: "no_permission" });

        await runAt(6, []);
        expect(statusOf()).toMatchObject({ state: "offline", error: "no_permission" });
    });

    it("stays when the failed edit of a live message is followed by an ended card without a message", async () => {
        await runAt(0, [stream()]);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(5, [stream({ viewer_count: 99 })]);
        stateStore.setTwitchState(GUILD_A, "foo", { messageId: "", messageGone: true });

        await runAt(7, []);
        await runAt(9, []);

        expect(statusOf()).toMatchObject({ state: "offline", error: "no_permission" });
    });

    it.each([10003, "channel_not_found"])("names a channel that went away with the ended card (%s)", async (code) => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code });
        await runAt(4, []);
        expect(statusOf()).toMatchObject({ state: "offline", error: "channel_gone", messageGone: true });
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(false);
    });

    it("is cleaned up with the entry", async () => {
        await neverPosted();
        expect(stateStore.listTwitchStates()).toHaveLength(1);

        mockConfig.serverSettings[GUILD_A] = { twitchStreamers: [] };
        await job.runTwitchCheck({ now: T0 + 4 * MINUTE });

        expect(stateStore.listTwitchStates()).toEqual([]);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });
});

describe("a channel changed while live", () => {
    const statusIn = (channelId) => job.twitchStatusOf([{ guildId: GUILD_A, login: "foo", channelId }])[0];

    it("names the old channel while the message runs and posts the next stream in the new one", async () => {
        await runAt(0, [stream()]);
        expect(statusIn(CHANNEL_A).postedChannelId).toBe("");

        list(GUILD_A, entry({ channelId: CHANNEL_B }));
        await runAt(2, [stream()]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(statusIn(CHANNEL_B)).toMatchObject({ state: "live", postedChannelId: CHANNEL_A });

        await runAt(4, []);
        await runAt(6, []);
        expect(mockDiscord.editPayload.mock.calls[0][0]).toBe(CHANNEL_A);
        expect(statusIn(CHANNEL_B).postedChannelId).toBe("");

        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_B });
        await runAt(30, [stream({ id: "s2" })]);
        expect(mockDiscord.postPayload.mock.calls[1][0]).toBe(CHANNEL_B);
        expect(statusIn(CHANNEL_B)).toMatchObject({ state: "live", postedChannelId: "" });
    });

    it("names nothing without a message", async () => {
        mockDiscord.postPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(0, [stream()]);
        expect(statusIn(CHANNEL_B).postedChannelId).toBe("");
    });
});

describe("an entry removed while live", () => {
    beforeEach(async () => {
        await runAt(0, [stream()]);
        mockConfig.serverSettings[GUILD_A] = { twitchStreamers: [] };
    });

    it("sends its message to ended and keeps a tombstone with the stream id", async () => {
        await runAt(2, [stream()]);

        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        expect(accentOf(mockDiscord.editPayload.mock.calls[0][2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "s1", removedAt: T0 + 2 * MINUTE, endPending: false });
        expect(mockGetStreams).toHaveBeenCalledTimes(2);
        expect(mockGetStreams).toHaveBeenLastCalledWith(["foo"]);
    });

    it("tries a failed ended edit again next run instead of leaving the message on live", async () => {
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(2, [stream()]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: true, endFailingSince: T0 + 2 * MINUTE });

        await runAt(4, [stream()]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
        expect(accentOf(mockDiscord.editPayload.mock.calls[1][2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: false, endFailingSince: 0 });

        await runAt(6, [stream()]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
    });

    it("gives the edit up 24 hours after its first failure, and the record goes with the stream", async () => {
        mockDiscord.editPayload.mockRejectedValue({ code: 50013 });
        await runAt(2, [stream()]);
        await runAt(2 + 24 * 60 - 1, [stream()]);
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(true);

        await runAt(2 + 24 * 60, [stream()]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: false, error: "end_gave_up" });
        const tries = mockDiscord.editPayload.mock.calls.length;

        await runAt(2 + 24 * 60 + 2, []);
        await runAt(2 + 24 * 60 + 4, []);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(tries);
        expect(stateStore.listTwitchStates()).toEqual([]);
    });

    it.each([
        ["the message is gone", 10008],
        ["the channel is gone", 10003],
        ["the channel cannot be found", "channel_not_found"],
    ])("stops trying at once when %s", async (_name, code) => {
        mockDiscord.editPayload.mockRejectedValueOnce({ code });
        await runAt(2, [stream()]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: false, messageGone: true, messageId: "" });

        await runAt(4, [stream()]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("keeps the old message of a record whose stream had already ended", async () => {
        list(GUILD_A, entry());
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(4, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(true);

        mockConfig.serverSettings[GUILD_A] = { twitchStreamers: [] };
        await job.runTwitchCheck({ now: T0 + 6 * MINUTE });
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "", endPending: false });
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds.map((e) => e.messageId)).toEqual(["m1"]);

        await job.runTwitchCheck({ now: T0 + 8 * MINUTE });
        expect(accentOf(mockDiscord.editPayload.mock.calls[1][2])).toBe(ENDED_COLOR);
        expect(stateStore.listTwitchStates()).toEqual([]);
    });

    it("leaves nothing behind when that old message fails until the 24 hours are over", async () => {
        list(GUILD_A, entry());
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValue({ code: 50013 });
        await runAt(4, []);
        mockConfig.serverSettings[GUILD_A] = { twitchStreamers: [] };
        await job.runTwitchCheck({ now: T0 + 6 * MINUTE });

        await job.runTwitchCheck({ now: T0 + (4 + 24 * 60) * MINUTE });
        expect(stateStore.listTwitchStates()).toEqual([]);
    });

    it("waits while the server cannot be reached", async () => {
        mockDiscord.isGuildAvailable.mockReturnValue(false);
        await job.runTwitchCheck({ now: T0 + 2 * MINUTE });
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(stateStore.listTwitchStates()).toHaveLength(1);
    });

    it("is not touched by the check of another server", async () => {
        list(GUILD_B, entry({ channelId: CHANNEL_B }));
        await runAt(2, [], { guildId: GUILD_B });
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
        expect(stateStore.listTwitchStates().map((s) => s.guildId)).toEqual([GUILD_A]);
    });
});

describe("the tombstone of a removed entry", () => {
    const statusIn = (channelId) => job.twitchStatusOf([{ guildId: GUILD_A, login: "foo", channelId }])[0];

    beforeEach(async () => {
        await runAt(0, [stream()]);
        mockConfig.serverSettings[GUILD_A] = { twitchStreamers: [] };
        await runAt(2, [stream()]);
        mockDiscord.editPayload.mockClear();
    });

    it("sets the old message live again without a ping when the entry comes back in the same stream", async () => {
        list(GUILD_A, entry());
        await runAt(4, [stream()]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        const [channelId, messageId, payload] = mockDiscord.editPayload.mock.calls[0];
        expect([channelId, messageId]).toEqual([CHANNEL_A, "m1"]);
        expect(accentOf(payload)).toBe(TWITCH_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ removedAt: 0, endedAt: 0, announced: true });
        expect(statusOf().state).toBe("live");
    });

    it("then ends that stream the normal way", async () => {
        list(GUILD_A, entry());
        await runAt(4, [stream()]);
        await runAt(6, []);
        await runAt(8, []);

        expect(accentOf(mockDiscord.editPayload.mock.calls[1][2])).toBe(ENDED_COLOR);
        expect(statusOf()).toMatchObject({ state: "offline", endedAt: T0 + 8 * MINUTE });
    });

    it("keeps the running message in its channel when the entry comes back with another one", async () => {
        list(GUILD_A, entry({ channelId: CHANNEL_B }));
        await runAt(4, [stream()]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload.mock.calls[0][0]).toBe(CHANNEL_A);
        expect(statusIn(CHANNEL_B)).toMatchObject({ state: "live", postedChannelId: CHANNEL_A });

        await runAt(6, []);
        await runAt(8, []);
        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_B });
        await runAt(30, [stream({ id: "s2" })]);
        expect(mockDiscord.postPayload.mock.calls[1][0]).toBe(CHANNEL_B);
        expect(statusIn(CHANNEL_B).postedChannelId).toBe("");
    });

    it("pings as usual when the entry comes back with a new stream id, however soon", async () => {
        list(GUILD_A, entry());
        mockDiscord.postPayload.mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_A });
        await runAt(4, [stream({ id: "s2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
        expect(mockDiscord.postPayload.mock.calls[1][2].pingRoleId).toBe(ROLE);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "s2", messageId: "m2", removedAt: 0 });
    });

    it("does not post again for a message deleted meanwhile", async () => {
        stateStore.setTwitchState(GUILD_A, "foo", { messageId: "", messageGone: true });
        list(GUILD_A, entry());
        await runAt(4, [stream()]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(statusOf()).toMatchObject({ state: "live", messageGone: true });
    });

    it("goes away after two clean answers without the stream", async () => {
        await runAt(4, []);
        expect(stateStore.listTwitchStates()).toHaveLength(1);
        await runAt(6, []);
        expect(stateStore.listTwitchStates()).toEqual([]);
    });

    it("goes away when Twitch shows another stream id", async () => {
        await runAt(4, [stream({ id: "s2" })]);
        expect(stateStore.listTwitchStates()).toEqual([]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("recognises its stream when Twitch writes the login in capitals", async () => {
        await runAt(4, []);
        await runAt(6, [stream({ user_login: "FOO" })]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "s1", offlineCount: 0 });
        await runAt(8, []);
        expect(stateStore.listTwitchStates()).toHaveLength(1);
        await runAt(10, []);
        expect(stateStore.listTwitchStates()).toEqual([]);
    });

    it("stays through an answer that says nothing", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 500 });
        await job.runTwitchCheck({ now: T0 + 4 * MINUTE });
        await runAt(6, [stream({ type: "" })]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "s1", offlineCount: 0 });
    });

    it("is not asked about by the check of another server", async () => {
        list(GUILD_B, entry({ login: "bar", channelId: CHANNEL_B }));
        await runAt(4, [], { guildId: GUILD_B });
        expect(mockGetStreams).toHaveBeenLastCalledWith(["bar"]);
        expect(stateStore.getTwitchState(GUILD_A, "foo").offlineCount).toBe(0);
    });
});

describe("a new stream over an old message", () => {
    const failFor = (messageId) => mockDiscord.editPayload.mockImplementation(async (_channel, id) => {
        if (id === messageId) throw Object.assign(new Error("kaputt"), { code: 50013 });
        return {};
    });
    const editsOf = (messageId) => mockDiscord.editPayload.mock.calls.filter((call) => call[1] === messageId);

    beforeEach(() => {
        mockDiscord.postPayload
            .mockReset()
            .mockResolvedValueOnce({ messageId: "m1", channelId: CHANNEL_A })
            .mockResolvedValueOnce({ messageId: "m2", channelId: CHANNEL_A });
    });

    it("posts and pings although the ended edit of the last stream still fails, and ends the old one later", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(4, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: true, endedAt: T0 + 4 * MINUTE });

        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(20, [stream({ id: "s2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
        expect(mockDiscord.postPayload.mock.calls[1][2].pingRoleId).toBe(ROLE);
        const state = stateStore.getTwitchState(GUILD_A, "foo");
        expect(state).toMatchObject({ messageId: "m2", endPending: false, endFailingSince: 0 });
        expect(state.pendingEnds).toEqual([expect.objectContaining({ messageId: "m1", endFailingSince: T0 + 4 * MINUTE })]);

        await runAt(22, [stream({ id: "s2" })]);
        const last = editsOf("m1").pop();
        expect(accentOf(last[2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageId: "m2", pendingEnds: [] });
    });

    it("tries the old message once more first: when that works, nothing stays open", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(4, []);

        await runAt(20, [stream({ id: "s2" })]);
        expect(editsOf("m1")).toHaveLength(2);
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds).toEqual([]);
    });

    it("posts and pings when a never ended stream cannot be closed", async () => {
        await runAt(0, [stream()]);
        failFor("m1");
        await runAt(30, [stream({ id: "s2" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(2);
        const state = stateStore.getTwitchState(GUILD_A, "foo");
        expect(state.messageId).toBe("m2");
        expect(state.pendingEnds).toEqual([expect.objectContaining({ messageId: "m1", endFailingSince: T0 + 30 * MINUTE })]);

        mockDiscord.editPayload.mockReset().mockResolvedValue({});
        await runAt(32, [stream({ id: "s2" })]);
        expect(accentOf(editsOf("m1").pop()[2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds).toEqual([]);
    });

    it("gives the old message up after 24 hours, the new stream runs on", async () => {
        await runAt(0, [stream()]);
        failFor("m1");
        await runAt(30, [stream({ id: "s2" })]);
        await runAt(30 + 24 * 60 - 1, [stream({ id: "s2" })]);
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds).toHaveLength(1);

        await runAt(30 + 24 * 60, [stream({ id: "s2" })]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageId: "m2", pendingEnds: [] });
        expect(statusOf()).toMatchObject({ state: "live", error: "end_gave_up" });
        const tries = editsOf("m1").length;

        await runAt(30 + 24 * 60 + 2, [stream({ id: "s2" })]);
        expect(editsOf("m1")).toHaveLength(tries);
    });

    it("drops an old message that is gone", async () => {
        await runAt(0, [stream()]);
        failFor("m1");
        await runAt(30, [stream({ id: "s2" })]);

        mockDiscord.editPayload.mockReset().mockRejectedValueOnce({ code: 10008 });
        await runAt(32, [stream({ id: "s2" })]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ messageId: "m2", pendingEnds: [], error: "" });
    });

    it("does not lose the old message to a filtered follow-up stream or to going offline", async () => {
        list(GUILD_A, entry({ games: ["World of Warcraft"] }));
        await runAt(0, [stream()]);
        failFor("m1");
        await runAt(30, [stream({ id: "s2", game_name: "Just Chatting" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(statusOf().state).toBe("filtered");
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds).toHaveLength(1);

        await runAt(32, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ streamId: "" });
        expect(stateStore.getTwitchState(GUILD_A, "foo").pendingEnds).toHaveLength(1);

        mockDiscord.editPayload.mockReset().mockResolvedValue({});
        await runAt(34, []);
        expect(accentOf(editsOf("m1").pop()[2])).toBe(ENDED_COLOR);
        expect(stateStore.listTwitchStates()).toEqual([]);
    });
});

describe("a resume whose edit fails", () => {
    it("tries again in the next run, although the card did not change", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(8, [stream({ id: "s2" })]);
        expect(statusOf()).toMatchObject({ state: "live", error: "no_permission" });
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);

        await runAt(10, [stream({ id: "s2" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(3);
        expect(accentOf(mockDiscord.editPayload.mock.calls[2][2])).toBe(TWITCH_COLOR);
        expect(statusOf().error).toBe("");
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);

        // cured: from here on the normal gap between edits holds again
        await runAt(12, [stream({ id: "s2", title: "Neu" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(3);
    });

    it("keeps trying every run while it fails, also right after the \"ended\" edit", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        await runAt(4, []);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 }).mockRejectedValueOnce({ code: 50013 });
        await runAt(6, [stream({ id: "s2" })]);
        await runAt(8, [stream({ id: "s2" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(3);
        expect(statusOf().error).toBe("no_permission");

        await runAt(10, [stream({ id: "s2" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(4);
        expect(accentOf(mockDiscord.editPayload.mock.calls[3][2])).toBe(TWITCH_COLOR);
        expect(statusOf().error).toBe("");
    });

    it("leaves a normal update that fails at the gap between edits", async () => {
        await runAt(0, [stream()]);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 50013 });
        await runAt(6, [stream({ title: "Neu" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);

        await runAt(8, [stream({ title: "Neu" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);

        await runAt(11, [stream({ title: "Neu" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
    });
});

describe("a live edit whose channel or message is gone", () => {
    it.each([10003, "channel_not_found"])("%s ends the edits without a repost", async (code) => {
        await runAt(0, [stream()]);
        mockDiscord.editPayload.mockRejectedValueOnce({ code });
        await runAt(6, [stream({ title: "Neu" })]);

        expect(statusOf()).toMatchObject({ messageGone: true, error: "channel_gone" });
        expect(stateStore.getTwitchState(GUILD_A, "foo").messageId).toBe("");

        await runAt(12, [stream({ title: "Noch neuer" })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("a deleted message shows no error", async () => {
        await runAt(0, [stream()]);
        mockDiscord.editPayload.mockRejectedValueOnce({ code: 10008 });
        await runAt(6, [stream({ title: "Neu" })]);
        expect(statusOf()).toMatchObject({ messageGone: true, error: "" });
    });
});

describe("a restart between the state and the \"ended\" edit", () => {
    /** The process dies during the edit: it never returns, the next run comes from fresh modules. */
    async function crashDuringEdit(at, streams) {
        mockDiscord.editPayload.mockImplementationOnce(() => new Promise(() => {}));
        mockGetStreams.mockResolvedValueOnce(streams);
        job.runTwitchCheck({ now: T0 + at * MINUTE });
        await new Promise(setImmediate);
        let fresh;
        jest.isolateModules(() => {
            require("../../../src/stores/discord/twitchStateStore").useFile(stateFile);
            fresh = require("../../../src/services/twitch/twitchJob");
        });
        return fresh;
    }

    it("still ends the card of a stream that went offline", async () => {
        await runAt(0, [stream()]);
        await runAt(2, []);
        const fresh = await crashDuringEdit(4, []);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: true });
        expect(stateStore.getTwitchState(GUILD_A, "foo").endedAt).toBeGreaterThan(0);

        mockGetStreams.mockResolvedValueOnce([]);
        await fresh.runTwitchCheck({ now: T0 + 6 * MINUTE });

        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
        expect(accentOf(mockDiscord.editPayload.mock.calls[1][2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(false);
    });

    it("still ends the card of a removed entry", async () => {
        await runAt(0, [stream()]);
        list(GUILD_A);
        const fresh = await crashDuringEdit(2, [stream()]);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ endPending: true });

        mockGetStreams.mockResolvedValueOnce([stream()]);
        await fresh.runTwitchCheck({ now: T0 + 4 * MINUTE });

        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(2);
        expect(accentOf(mockDiscord.editPayload.mock.calls[1][2])).toBe(ENDED_COLOR);
        expect(stateStore.getTwitchState(GUILD_A, "foo").endPending).toBe(false);
    });
});

describe("whether Twitch refused the credentials", () => {
    const refused = () => Object.assign(new Error("refused"), { authFailed: true });

    it("is false before any check, as after a restart", () => {
        expect(job.twitchCredentialsRejected(mockConfig)).toBe(false);
    });

    it("is true after a refusal and false again after a clean answer", async () => {
        mockGetStreams.mockRejectedValueOnce(refused());
        await job.runTwitchCheck({ now: T0 });
        expect(job.lastTwitchRun().error).toBe("bad_credentials");
        expect(job.twitchCredentialsRejected(mockConfig)).toBe(true);

        await runAt(2, []);
        expect(job.twitchCredentialsRejected(mockConfig)).toBe(false);
    });

    it("is false for another failure of Twitch", async () => {
        mockGetStreams.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 500 }));
        await job.runTwitchCheck({ now: T0 });
        expect(job.lastTwitchRun().error).not.toBe("");
        expect(job.twitchCredentialsRejected(mockConfig)).toBe(false);
    });

    it("lifts at once when other credentials are saved, before the next check", async () => {
        mockGetStreams.mockRejectedValueOnce(refused());
        await job.runTwitchCheck({ now: T0 });

        expect(job.twitchCredentialsRejected({ twitch: { clientId: "id", clientSecret: "neu" } })).toBe(false);
        expect(job.twitchCredentialsRejected({ twitch: { clientId: "id", clientSecret: "" } })).toBe(false);
        expect(job.twitchCredentialsRejected({})).toBe(false);
        expect(job.twitchCredentialsRejected(mockConfig)).toBe(true);
    });

    it("keeps the secret out of the last run", async () => {
        mockGetStreams.mockRejectedValueOnce(refused());
        await job.runTwitchCheck({ now: T0 });
        expect(JSON.stringify(job.lastTwitchRun())).not.toContain("secret");
    });
});

describe("a post whose state cannot be written", () => {
    const failWrites = (impl) => jest.spyOn(fs, "writeFileSync")[impl](() => {
        throw Object.assign(new Error("voll"), { code: "ENOSPC" });
    });
    const failNextWriteDuringPost = () => mockDiscord.postPayload.mockImplementationOnce(async () => {
        failWrites("mockImplementationOnce");
        return { messageId: "m1", channelId: CHANNEL_A };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("counts as posted, logs it, pings nothing twice and writes it next run", async () => {
        failNextWriteDuringPost();
        await expect(runAt(0, [stream()])).resolves.toEqual({ checked: 1, live: 1 });

        expect(stateStore.getTwitchState(GUILD_A, "foo").messageId).toBe("");
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("went out"));
        expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining("post of foo"));

        await runAt(2, [stream()]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(stateStore.getTwitchState(GUILD_A, "foo")).toMatchObject({ announced: true, messageId: "m1", streamId: "s1" });
    });

    it("still pings nothing twice when the write fails again", async () => {
        failNextWriteDuringPost();
        await runAt(0, [stream()]);

        failWrites("mockImplementation");
        await runAt(2, [stream()]);
        jest.restoreAllMocks();
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);

        await runAt(4, [stream()]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(stateStore.getTwitchState(GUILD_A, "foo").messageId).toBe("m1");
    });
});

describe("what lastTwitchRun remembers", () => {
    it("keeps the error when a server without entries checks", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 500 });
        await job.runTwitchCheck({ now: T0 });
        expect(job.lastTwitchRun()).toEqual({ at: T0, error: "twitch_unavailable" });

        await expect(job.runTwitchCheck({ guildId: GUILD_B, now: T0 + MINUTE })).resolves.toEqual({ checked: 0, live: 0 });
        expect(mockGetStreams).toHaveBeenCalledTimes(1);
        expect(job.lastTwitchRun()).toEqual({ at: T0, error: "twitch_unavailable" });
    });

    it("clears it on a run over all servers", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 500 });
        await job.runTwitchCheck({ now: T0 });
        mockConfig.serverSettings = {};
        await job.runTwitchCheck({ now: T0 + MINUTE });
        expect(job.lastTwitchRun()).toEqual({ at: T0 + MINUTE, error: "" });
    });

    it("clears it on a server's check that did ask Twitch", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 500 });
        await job.runTwitchCheck({ now: T0 });
        await runAt(1, [], { guildId: GUILD_A });
        expect(job.lastTwitchRun().error).toBe("");
    });
});

describe("what a failed answer is called", () => {
    it.each([
        ["refused credentials", { status: 401, authFailed: true }, "bad_credentials"],
        ["a refused token request", { status: 400, authFailed: true }, "bad_credentials"],
        ["a rate limit", { status: 429 }, "rate_limited"],
        ["a broken server", { status: 500 }, "twitch_unavailable"],
        ["a 200 without a list", { kind: "bad_answer" }, "twitch_unavailable"],
    ])("%s", async (_name, failure, code) => {
        mockGetStreams.mockRejectedValueOnce(failure);
        await expect(job.runTwitchCheck({ now: T0 })).resolves.toEqual({ skipped: code });
        expect(job.lastTwitchRun()).toEqual({ at: T0, error: code });
    });

    it("never carries the secret into the answer or a log line", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 401, authFailed: true, config: { data: "client_secret=secret" } });
        const result = await job.runTwitchCheck({ now: T0 });

        const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
        expect(logged).toContain("401");
        expect(`${logged} ${JSON.stringify(result)} ${JSON.stringify(job.lastTwitchRun())}`).not.toContain("secret");
    });

    it("does not pause the next run for refused credentials", async () => {
        mockGetStreams.mockRejectedValueOnce({ status: 401, authFailed: true });
        await job.runTwitchCheck({ now: T0 });
        await expect(runAt(2, [])).resolves.toEqual({ checked: 1, live: 0 });
    });
});

describe("the game filter", () => {
    beforeEach(() => {
        list(GUILD_A, entry({ games: ["world of warcraft", "Hearthstone"] }));
    });

    it("announces nothing for another game, and offline leaves nothing behind", async () => {
        await runAt(0, [stream({ game_name: "Just Chatting" })]);
        expect(mockDiscord.postPayload).not.toHaveBeenCalled();
        expect(statusOf()).toMatchObject({ state: "filtered", game: "Just Chatting" });

        await runAt(2, []);
        expect(stateStore.listTwitchStates()).toEqual([]);
        expect(statusOf().state).toBe("offline");
    });

    it("passes any of the names, case-insensitive and contained", async () => {
        await runAt(0, [stream({ game_name: "World of Warcraft: Classic" })]);
        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("announces on a switch to a matching game in the middle of the stream", async () => {
        await runAt(0, [stream({ game_name: "Just Chatting" })]);
        await runAt(2, [stream({ game_name: "HEARTHSTONE" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.postPayload.mock.calls[0][2].pingRoleId).toBe(ROLE);
        expect(statusOf().state).toBe("live");
    });

    it("leaves the message standing on a switch away from it", async () => {
        await runAt(0, [stream()]);
        await runAt(5, [stream({ game_name: "Just Chatting" })]);

        expect(mockDiscord.postPayload).toHaveBeenCalledTimes(1);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        const [, messageId, payload] = mockDiscord.editPayload.mock.calls[0];
        expect(messageId).toBe("m1");
        expect(accentOf(payload)).toBe(TWITCH_COLOR);
        expect(statusOf().state).toBe("live");
    });
});

describe("live updates", () => {
    it("edits at most every 5 minutes, however much changed", async () => {
        await runAt(0, [stream()]);
        await runAt(2, [stream({ viewer_count: 50 })]);
        await runAt(4, [stream({ viewer_count: 80 })]);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();

        await runAt(5, [stream({ viewer_count: 90 })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);

        await runAt(9, [stream({ viewer_count: 100 })]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("does not edit when nothing changed, however long ago the last edit was", async () => {
        await runAt(0, [stream()]);
        await runAt(30, [stream()]);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });

    it("edits when the orga changed the text", async () => {
        await runAt(0, [stream()]);
        list(GUILD_A, entry({ text: "Neuer Text" }));
        await runAt(6, [stream()]);
        expect(mockDiscord.editPayload).toHaveBeenCalledTimes(1);
        expect(textOf(mockDiscord.editPayload.mock.calls[0][2])).toContain("Neuer Text");
    });
});

describe("what a run does not do", () => {
    it("does nothing without credentials", async () => {
        mockConfig.twitch = { clientId: "id", clientSecret: "" };
        await expect(job.runTwitchCheck({ now: T0 })).resolves.toEqual({ skipped: "no_credentials" });
        expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("does nothing while the bot is offline", async () => {
        mockDiscord.isOnline.mockReturnValue(false);
        await expect(job.runTwitchCheck({ now: T0 })).resolves.toEqual({ skipped: "bot_offline" });
        expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("does not ask Twitch for an empty list", async () => {
        mockConfig.serverSettings = {};
        await expect(job.runTwitchCheck({ now: T0 })).resolves.toEqual({ checked: 0, live: 0 });
        expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("limits a check to the server that asked", async () => {
        list(GUILD_B, entry({ login: "bar", channelId: CHANNEL_B }));
        mockGetStreams.mockResolvedValueOnce([]);
        await expect(job.runTwitchCheck({ guildId: GUILD_B, now: T0 })).resolves.toEqual({ checked: 1, live: 0 });
        expect(mockGetStreams).toHaveBeenCalledWith(["bar"]);
    });

    it("answers failed when the run itself breaks", async () => {
        mockDiscord.isOnline.mockImplementation(() => { throw new Error("kaputt"); });
        await expect(job.runTwitchCheck({ now: T0 })).resolves.toEqual({ skipped: "failed" });
    });

    it("lets a scheduled run join the one going, a server's own check waits for it", async () => {
        let answer;
        mockGetStreams.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        const first = job.runTwitchCheck({ now: T0 });
        const joined = job.runTwitchCheck({ now: T0 });
        mockGetStreams.mockResolvedValueOnce([]);
        const own = job.runTwitchCheck({ guildId: GUILD_A, now: T0 });

        // the first run reaches Twitch after its awaits; let them pass
        await new Promise((resolve) => { setImmediate(resolve); });
        answer([]);

        await expect(Promise.all([first, joined, own])).resolves.toEqual([
            { checked: 1, live: 0 }, { checked: 1, live: 0 }, { checked: 1, live: 0 },
        ]);
        expect(mockGetStreams).toHaveBeenCalledTimes(2);
    });
});

describe("the automatic start", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockGetStreams.mockResolvedValue([]);
    });

    afterEach(() => {
        job._resetForTests();
        jest.useRealTimers();
    });

    it("does not poll on a test instance", () => {
        job.startTwitchJob({ live: false });
        jest.advanceTimersByTime(10 * MINUTE);
        expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("does not poll by default under the test run (NODE_ENV test is no live bot)", () => {
        job.startTwitchJob();
        jest.advanceTimersByTime(10 * MINUTE);
        expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("polls every 2 minutes on the live bot, not at once, and only once when started twice", async () => {
        job.startTwitchJob({ live: true });
        job.startTwitchJob({ live: true });
        await jest.advanceTimersByTimeAsync(MINUTE);
        expect(mockGetStreams).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(MINUTE);
        expect(mockGetStreams).toHaveBeenCalledTimes(1);

        job.stopTwitchJob();
        await jest.advanceTimersByTimeAsync(10 * MINUTE);
        expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });

    it("lets Jetzt prüfen work on a test instance", async () => {
        job.startTwitchJob({ live: false });
        await expect(job.runTwitchCheck({ guildId: GUILD_A, now: T0 })).resolves.toEqual({ checked: 1, live: 0 });
        expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });
});
