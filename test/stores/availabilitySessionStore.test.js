// The open raid pickers of absences and attendances on disk (availabilitySessionStore.js):
// a copy out, the old ones dropped on the way, gone after remove.
const sessions = require("../../src/stores/availabilitySessionStore");
const { tempStoreFile } = require("../helpers/tempStore");

beforeAll(() => sessions.useFile(tempStoreFile("eh-availability-sessions.json")));
afterAll(() => sessions.useFile(null));

describe("stores/availabilitySessionStore", () => {
    it("keeps a session under its token and hands out a copy", () => {
        sessions.put("aaaa1111", { userId: "u1", at: 1000, selected: null });
        expect(sessions.has("aaaa1111")).toBe(true);
        const got = sessions.get("aaaa1111");
        got.selected = ["x"];
        expect(sessions.get("aaaa1111").selected).toBeNull();
        expect(sessions.get("nope")).toBeNull();
    });

    it("drops the sessions older than the TTL when a new one comes, and removes one on request", () => {
        sessions.put("old00000", { userId: "u1", at: 1000 });
        sessions.put("new00000", { userId: "u2", at: 50_000 }, { ttl: 10_000, now: 50_000 });
        expect(sessions.has("old00000")).toBe(false);
        expect(sessions.has("new00000")).toBe(true);
        expect(sessions.remove("new00000")).toBe(true);
        expect(sessions.remove("new00000")).toBe(false);
    });
});
