// Raiders' requests against the orga's list: what "approved" means, who may take what off the list.
let mockConfig;
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn((partial) => {
        for (const [guildId, block] of Object.entries(partial.serverSettings || {})) {
            mockConfig.serverSettings[guildId] = { ...mockConfig.serverSettings[guildId], ...block };
        }
        return mockConfig;
    }),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/discord/twitchRequestStore");
const { TwitchSettingsError } = require("../../../src/services/twitch/twitchSettings");
const {
    statusOf, openRequests, openRequestOf, fileRequest, withdrawRequest, rejectRequest, markApproved, removeStreamer, removeOwnEntry,
} = require("../../../src/services/twitch/twitchRequests");

const G = "g1";
const OTHER = "g2";
const entry = (login, source = "orga") => ({ login, channelId: "111111", roleId: "", text: "", games: [], source });
const listOf = (guildId = G) => mockConfig.serverSettings[guildId].twitchStreamers;
const file = (over = {}) => fileRequest({ guildId: G, userId: "u1", userName: "Anna", login: "anna", ...over });
const codeOf = (fn) => {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(TwitchSettingsError);
        return e.code;
    }
    return "";
};

beforeEach(() => {
    store.useFile(tempStoreFile("twitch-requests.json"));
    mockConfig = { serverSettings: { [G]: { twitchStreamers: [] }, [OTHER]: { twitchStreamers: [] } } };
});
afterAll(() => store.useFile(null));

describe("fileRequest", () => {
    it("takes a name or a link, stores the login in lowercase, waiting", () => {
        const record = file({ login: "https://www.twitch.tv/AnnaStream", now: 5 });
        expect(record).toEqual({ guildId: G, userId: "u1", userName: "Anna", login: "annastream", status: "pending", requestedAt: 5, decidedAt: 0 });
        expect(store.requestOf(G, "u1")).toEqual(record);
    });

    it.each(["", "ein name", "twitch.tv/videos/123", "a"])("refuses %j like the orga's form", (login) => {
        expect(codeOf(() => file({ login }))).toBe("invalid_login");
        expect(store.requestOf(G, "u1")).toBeNull();
    });

    it("allows one open request per server, on the next server another one", () => {
        file();
        expect(codeOf(() => file({ login: "zweite" }))).toBe("already_open");
        expect(store.requestOf(G, "u1").login).toBe("anna");
        expect(file({ guildId: OTHER }).guildId).toBe(OTHER);
    });

    it("refuses a second request while one's entry is in the list", () => {
        const record = file();
        listOf().push(entry("anna", "raider"));
        markApproved(record);
        expect(codeOf(() => file({ login: "zweite" }))).toBe("already_approved");
    });

    it("refuses a login that is listed already: nobody gets to own an entry by typing its name", () => {
        listOf().push(entry("anna"));
        expect(codeOf(() => file())).toBe("already_listed");
        expect(store.requestOf(G, "u1")).toBeNull();
    });

    it("lets a login of another server through", () => {
        mockConfig.serverSettings[OTHER].twitchStreamers.push(entry("anna"));
        expect(file().status).toBe("pending");
    });

    it("asks again at once after a refusal", () => {
        file();
        rejectRequest(G, "u1");
        const again = file({ login: "zweite", now: 9 });
        expect(again).toMatchObject({ status: "pending", login: "zweite", decidedAt: 0, requestedAt: 9 });
    });

    it("cuts a very long display name", () => {
        expect(file({ userName: "x".repeat(200) }).userName).toHaveLength(80);
    });
});

describe("statusOf", () => {
    it("says none without a record", () => {
        expect(statusOf(null, mockConfig)).toBe("none");
    });

    it("says what a waiting or refused record says", () => {
        const record = file();
        expect(statusOf(record, mockConfig)).toBe("pending");
        expect(statusOf(rejectRequest(G, "u1"), mockConfig)).toBe("rejected");
    });

    it("believes approved only while the raider's entry is in the list", () => {
        const record = markApproved(file());
        expect(statusOf(record, mockConfig)).toBe("none");
        listOf().push(entry("anna"));
        expect(statusOf(record, mockConfig)).toBe("none");
        listOf()[0] = entry("anna", "raider");
        expect(statusOf(record, mockConfig)).toBe("approved");
    });
});

describe("openRequests", () => {
    it("lists one server's waiting requests, oldest first", () => {
        file({ userId: "u2", login: "zwei", now: 20 });
        file({ userId: "u3", login: "eins", now: 10 });
        file({ userId: "u4", login: "weg", now: 5 });
        rejectRequest(G, "u4");
        file({ guildId: OTHER, userId: "u5", login: "fremd", now: 1 });
        expect(openRequests(G).map((r) => r.login)).toEqual(["eins", "zwei"]);
    });

    it("finds one open request, not a decided one", () => {
        file();
        expect(openRequestOf(G, "u1").login).toBe("anna");
        expect(openRequestOf(OTHER, "u1")).toBeNull();
        rejectRequest(G, "u1");
        expect(openRequestOf(G, "u1")).toBeNull();
    });
});

describe("withdrawRequest", () => {
    it("takes back one's own open request, nothing else", () => {
        file();
        expect(withdrawRequest(G, "u2")).toBe(false);
        expect(withdrawRequest(OTHER, "u1")).toBe(false);
        expect(withdrawRequest(G, "u1")).toBe(true);
        expect(store.requestOf(G, "u1")).toBeNull();
    });

    it("leaves a decided record alone", () => {
        file();
        rejectRequest(G, "u1");
        expect(withdrawRequest(G, "u1")).toBe(false);
        expect(store.requestOf(G, "u1").status).toBe("rejected");
    });
});

describe("rejectRequest", () => {
    it("is null when nothing is open", () => {
        expect(rejectRequest(G, "u1")).toBeNull();
    });

    it("notes when the orga decided", () => {
        file();
        expect(rejectRequest(G, "u1", { now: 7 })).toMatchObject({ status: "rejected", decidedAt: 7 });
    });
});

describe("markApproved", () => {
    it("takes the claim from an older owner of the login, only there", () => {
        const older = markApproved(file({ userId: "alt" }));
        store.putRequest({ ...older, guildId: OTHER });
        const record = markApproved(file({ userId: "neu" }), { now: 3 });
        expect(record).toMatchObject({ status: "approved", decidedAt: 3 });
        expect(store.requestOf(G, "alt")).toBeNull();
        expect(store.requestOf(OTHER, "alt")).not.toBeNull();
    });
});

describe("removeStreamer", () => {
    it("takes the login off this server's list and frees the record", () => {
        markApproved(file());
        listOf().push(entry("anna", "raider"), entry("bleibt"));
        mockConfig.serverSettings[OTHER].twitchStreamers.push(entry("anna"));
        removeStreamer(G, "anna", { config: mockConfig });
        expect(listOf().map((e) => e.login)).toEqual(["bleibt"]);
        expect(listOf(OTHER)).toHaveLength(1);
        expect(store.requestOf(G, "u1")).toBeNull();
    });

    it("leaves a waiting request of the same login open", () => {
        listOf().push(entry("anna"));
        store.putRequest({ guildId: G, userId: "u2", userName: "B", login: "anna", status: "pending", requestedAt: 1, decidedAt: 0 });
        removeStreamer(G, "anna", { config: mockConfig });
        expect(store.requestOf(G, "u2").status).toBe("pending");
    });
});

describe("removeOwnEntry", () => {
    it("takes the raider's own entry off the list", () => {
        markApproved(file());
        listOf().push(entry("anna", "raider"), entry("bleibt"));
        expect(removeOwnEntry(G, "u1", { config: mockConfig })).toBe(true);
        expect(listOf().map((e) => e.login)).toEqual(["bleibt"]);
        expect(store.requestOf(G, "u1")).toBeNull();
    });

    it("does nothing for somebody without an approved record", () => {
        markApproved(file());
        listOf().push(entry("anna", "raider"));
        expect(removeOwnEntry(G, "u2", { config: mockConfig })).toBe(false);
        expect(listOf()).toHaveLength(1);
    });

    it("cannot reach an entry that became the orga's", () => {
        markApproved(file());
        listOf().push(entry("anna"));
        expect(removeOwnEntry(G, "u1", { config: mockConfig })).toBe(false);
        expect(listOf()).toHaveLength(1);
    });

    it("does nothing while the request only waits", () => {
        listOf().push(entry("anna"));
        store.putRequest({ guildId: G, userId: "u1", userName: "A", login: "anna", status: "pending", requestedAt: 1, decidedAt: 0 });
        expect(removeOwnEntry(G, "u1", { config: mockConfig })).toBe(false);
        expect(listOf()).toHaveLength(1);
    });
});
