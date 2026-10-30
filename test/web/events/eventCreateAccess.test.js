// The limits of the orga of a category when creating and changing events (#728,
// src/web/events/eventCreateAccess.js): the category the server works out, the version the category
// plays now, channels of that category only. The roster rule is categoryOrga.test.js'; here it is mocked.
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
const mockConfig = { categoryVoiceChannel: { cat1: "v-shared" } };
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: () => mockConfig,
    getRaidTemplate: (id) => ({ "tpl-tbc": { id, versionId: "tbc" }, "tpl-forever": { id, name: "BD", versionId: "forever" } })[id] || null,
}));
jest.mock("../../../src/stores/channelArchiveStore", () => ({
    ...jest.requireActual("../../../src/stores/channelArchiveStore"),
    getChannelConfig: () => ({ schemas: { cat1: { templateChannelId: "t-schema" } } }),
}));
jest.mock("../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/versions/mainVersion"),
    mainVersionFor: jest.fn(() => "tbc"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    getChannelCategoryMap: () => ({
        "v-cat1": { categoryId: "cat1" }, "v-cat2": { categoryId: "cat2" }, "v-shared": { categoryId: "voice" },
        "t-cat1": { categoryId: "cat1" }, "t-cat2": { categoryId: "cat2" }, "t-schema": { categoryId: "templates" },
        "c-kara": { categoryId: "cat1" },
    }),
}));
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    canOrgaEvent: jest.fn(async (user, row) => user.id === "mgr" && row.categoryId === "cat1"),
    isAnyCategoryManager: jest.fn(async (user) => user.id === "mgr"),
    orgaCategoryIds: jest.fn(async (user) => (user.id === "mgr" ? ["cat1"] : [])),
}));

const access = require("../../../src/web/events/eventCreateAccess");
const categoryOrga = require("../../../src/services/roster/categoryOrga");

const MANAGER = { id: "mgr", isAdmin: false, access: { raids: { read: true, write: false } } };
const ORGA = { id: "orga", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
const req = {};

beforeEach(() => jest.clearAllMocks());

describe("web/events/eventCreateAccess", () => {
    it("names a new event by the category the request asks for", () => {
        expect(access.newEventRow({ channelId: "c-kara" }, null, req)).toEqual({ categoryId: "cat1" });
        expect(access.newEventRow({ newChannel: { name: "", categoryId: "cat2" } }, null, req)).toEqual({ categoryId: "cat2" });
        expect(access.newEventRow({}, null, req)).toEqual({ categoryId: "" });
    });

    it("scopes the create dialog: none for the global orga with `raids` write, else the managed categories", async () => {
        expect(await access.eventCategoryScope(ORGA, req)).toBeNull();
        expect([...await access.eventCategoryScope(MANAGER, req)]).toEqual(["cat1"]);
        expect(categoryOrga.orgaCategoryIds).toHaveBeenCalledWith(MANAGER, expect.objectContaining({ managerOnly: true }));
        // the global orga reading only takes the category path, as at the gate
        expect([...await access.eventCategoryScope({ ...ORGA, access: { raids: { read: true, write: false } } }, req)]).toEqual([]);
    });

    it("takes a voice channel of the category: none, its preset or one inside it", () => {
        expect(access.voiceAllowed("g1", "cat1", "")).toBe(true);
        expect(access.voiceAllowed("g1", "cat1", "v-shared", mockConfig)).toBe(true);
        expect(access.voiceAllowed("g1", "cat1", "v-cat1", mockConfig)).toBe(true);
        expect(access.voiceAllowed("g1", "cat1", "v-cat2", mockConfig)).toBe(false);
        expect(access.voiceAllowed("g1", "cat1", "v-unknown", mockConfig)).toBe(false);
        expect(access.voiceAllowed("g1", "", "v-cat1", mockConfig)).toBe(false);
    });

    it("takes a template channel of the category: none, its schema's or one inside it", () => {
        expect(access.templateChannelAllowed("g1", "cat1", "")).toBe(true);
        expect(access.templateChannelAllowed("g1", "cat1", "t-schema")).toBe(true);
        expect(access.templateChannelAllowed("g1", "cat1", "t-cat1")).toBe(true);
        expect(access.templateChannelAllowed("g1", "cat1", "t-cat2")).toBe(false);
        expect(access.templateChannelAllowed("g1", "cat2", "t-schema")).toBe(false);
    });

    describe("createGuard", () => {
        const guard = () => access.createGuard(MANAGER, req);
        const plan = (over = {}) => ({ versionId: "tbc", voiceChannelId: "", ...over });

        it("lets their category through in the version it plays now", async () => {
            expect(await guard()({ categoryId: "cat1", plan: plan(), request: {}, body: {} })).toBeNull();
            expect(categoryOrga.canOrgaEvent).toHaveBeenCalledWith(MANAGER, { categoryId: "cat1" }, expect.objectContaining({ managerOnly: true }));
        });

        it("refuses another category or none", async () => {
            for (const categoryId of ["cat2", ""]) {
                const r = await guard()({ categoryId, plan: plan(), request: {}, body: {} });
                expect([categoryId, r.error.status, r.error.code]).toEqual([categoryId, 403, "not_category_orga"]);
            }
        });

        it("refuses another version - of the plan, or named for a Raid-Helper event", async () => {
            const r = await guard()({ categoryId: "cat1", plan: plan({ versionId: "forever" }), request: {}, body: {} });
            expect([r.error.status, r.error.code]).toEqual([409, "version_fixed"]);
            const rh = await guard()({ categoryId: "cat1", plan: null, request: {}, body: { versionId: "forever" } });
            expect(rh.error.code).toBe("version_fixed");
            expect(await guard()({ categoryId: "cat1", plan: null, request: {}, body: { versionId: "tbc" } })).toBeNull();
        });

        it("refuses a template or voice channel of another category", async () => {
            const tpl = await guard()({ categoryId: "cat1", plan: plan(), request: { newChannel: { templateChannelId: "t-cat2" } }, body: {} });
            expect([tpl.error.status, tpl.error.code]).toEqual([400, "channel_not_allowed"]);
            const voice = await guard()({ categoryId: "cat1", plan: plan({ voiceChannelId: "v-cat2" }), request: {}, body: {} });
            expect(voice.error.code).toBe("channel_not_allowed");
            const rhVoice = await guard()({ categoryId: "cat1", plan: null, request: {}, body: { voiceChannelId: "v-cat2" } });
            expect(rhVoice.error.code).toBe("channel_not_allowed");
        });
    });

    describe("quickCreateAccess (the channels page's \"gleich Event anlegen\")", () => {
        it("leaves the global orga with `raids` write alone", async () => {
            expect(await access.quickCreateAccess(ORGA, req, "cat2", "t-cat2")).toBeNull();
        });

        it("refuses who is no orga: orga_only with `raids` write, forbidden without", async () => {
            const writer = { id: "w", isAdmin: false, access: { raids: { read: true, write: true } } };
            expect((await access.quickCreateAccess(writer, req, "cat1", "")).error.code).toBe("orga_only");
            const reader = { id: "r", isAdmin: false, access: { raids: { read: true, write: false } } };
            expect((await access.quickCreateAccess(reader, req, "cat1", "")).error.code).toBe("forbidden");
        });

        it("gives the orga of a category their category with a guard, nothing else", async () => {
            const granted = await access.quickCreateAccess(MANAGER, req, "cat1", "t-cat1");
            expect(typeof granted.guard).toBe("function");
            expect((await access.quickCreateAccess(MANAGER, req, "cat2", "")).error.code).toBe("not_category_orga");
            expect((await access.quickCreateAccess(MANAGER, req, "", "")).error.code).toBe("not_category_orga");
            expect((await access.quickCreateAccess(MANAGER, req, "cat1", "t-cat2")).error.code).toBe("channel_not_allowed");
        });

        it("refuses a default raid template of another version than the category plays - for everyone", async () => {
            for (const who of [ORGA, MANAGER]) {
                const r = await access.quickCreateAccess(who, req, "cat1", "", { raidTemplateId: "tpl-forever" });
                expect([who.id, r.error.status, r.error.code]).toEqual([who.id, 409, "version_fixed"]);
            }
            expect(await access.quickCreateAccess(ORGA, req, "cat1", "", { raidTemplateId: "tpl-tbc" })).toBeNull();
            expect(typeof (await access.quickCreateAccess(MANAGER, req, "cat1", "", { raidTemplateId: "tpl-tbc" })).guard).toBe("function");
            // the right first: another category is "not yours", whatever its template
            expect((await access.quickCreateAccess(MANAGER, req, "cat2", "", { raidTemplateId: "tpl-forever" })).error.code).toBe("not_category_orga");
        });
    });

    describe("updateRefusal", () => {
        const event = { id: "eh-1", categoryId: "cat1", versionId: "tbc", voiceChannelId: "v-cat2" };

        it("keeps the raid's version", () => {
            expect(access.updateRefusal(event, { versionId: "forever" }, req).error.code).toBe("version_fixed");
            expect(access.updateRefusal(event, { versionId: "tbc" }, req)).toBeNull();
            expect(access.updateRefusal(event, { title: "x" }, req)).toBeNull();
        });

        it("takes a new voice channel of the category only; the one it has stays allowed", () => {
            expect(access.updateRefusal(event, { voiceChannelId: "v-cat2" }, req)).toBeNull();
            expect(access.updateRefusal({ ...event, voiceChannelId: "" }, { voiceChannelId: "v-cat2" }, req).error.code).toBe("channel_not_allowed");
            expect(access.updateRefusal(event, { voiceChannelId: "v-cat1" }, req)).toBeNull();
            expect(access.updateRefusal(event, { voiceChannelId: "" }, req)).toBeNull();
        });
    });
});
