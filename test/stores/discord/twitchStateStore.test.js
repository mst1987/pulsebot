const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const {
    getTwitchState, setTwitchState, removeTwitchState, listTwitchStates, useFile,
} = require("../../../src/stores/discord/twitchStateStore");

let file;

beforeEach(() => {
    file = tempStoreFile("twitch-state.json");
    useFile(file);
});

afterEach(() => {
    useFile(null);
});

describe("twitchStateStore", () => {
    it("gives an empty record with every field for an unknown streamer", () => {
        expect(getTwitchState("100000", "foo")).toMatchObject({
            announced: false, messageGone: false, messageId: "", streamId: "", endedAt: 0, offlineCount: 0, display: null,
        });
    });

    it("merges a patch and answers the whole record", () => {
        setTwitchState("100000", "foo", { streamId: "s1", announced: true });
        const next = setTwitchState("100000", "foo", { messageId: "m1" });
        expect(next).toMatchObject({ streamId: "s1", announced: true, messageId: "m1", error: "" });
        expect(getTwitchState("100000", "foo")).toEqual(next);
    });

    it("writes at once, so a post is on record when the process ends right after", () => {
        setTwitchState("100000", "foo", { streamId: "s1", announced: true });
        expect(JSON.parse(fs.readFileSync(file, "utf8"))["100000:foo"]).toMatchObject({ streamId: "s1", announced: true });
    });

    it("keeps the same streamer on two servers apart", () => {
        setTwitchState("100000", "foo", { streamId: "a" });
        setTwitchState("200000", "foo", { streamId: "b" });
        expect(getTwitchState("100000", "foo").streamId).toBe("a");
        expect(getTwitchState("200000", "foo").streamId).toBe("b");
    });

    it("lists every record with server and login", () => {
        setTwitchState("100000", "foo", { streamId: "a" });
        setTwitchState("200000", "bar", { streamId: "b" });
        expect(listTwitchStates().map((s) => [s.guildId, s.login, s.state.streamId])).toEqual([
            ["100000", "foo", "a"],
            ["200000", "bar", "b"],
        ]);
    });

    it("removes one record and says whether there was one", () => {
        setTwitchState("100000", "foo", { streamId: "a" });
        setTwitchState("100000", "bar", { streamId: "b" });
        expect(removeTwitchState("100000", "foo")).toBe(true);
        expect(removeTwitchState("100000", "foo")).toBe(false);
        expect(listTwitchStates().map((s) => s.login)).toEqual(["bar"]);
    });

    it("takes a damaged file as empty and skips a key without a server", () => {
        fs.writeFileSync(file, JSON.stringify(["kaputt"]));
        useFile(file);
        expect(listTwitchStates()).toEqual([]);

        fs.writeFileSync(file, JSON.stringify({ ohneServer: {}, "100000:foo": { streamId: "a" } }));
        useFile(file);
        expect(listTwitchStates().map((s) => s.login)).toEqual(["foo"]);
    });
});
