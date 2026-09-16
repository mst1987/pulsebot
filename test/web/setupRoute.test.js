// The setup editor's API (src/web/apiRoutes/setup.js, #263): a reader gets the
// approved lineup and never the draft, writing takes `raids` write, and the
// explanation runs as a background job that needs the Anthropic key.
let mockUser = null;
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(() => mockUser),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig, getRaidTemplate: () => null }));
const mockEvents = new Map();
jest.mock("../../src/web/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: () => [],
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventSetup: (id, setup) => {
        mockEvents.set(id, { ...mockEvents.get(id), setup: JSON.parse(JSON.stringify(setup)) });
        return JSON.parse(JSON.stringify(mockEvents.get(id)));
    },
}));
let mockSignups = [];
jest.mock("../../src/web/signupStore", () => ({ listSignups: () => mockSignups }));
jest.mock("../../src/web/raiderProfileStore", () => ({ listProfiles: () => [] }));
jest.mock("../../src/web/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../src/web/eventSources", () => ({
    listStoredEvents: () => [],
    specNameFor: jest.requireActual("../../src/web/eventSources").specNameFor,
}));
jest.mock("../../src/web/discord", () => ({ resolveUserNames: jest.fn(async () => ({})) }));
jest.mock("../../src/web/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../src/web/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 10 })),
}));
const mockExplain = jest.fn();
jest.mock("../../src/utils/setup/explainText", () => ({ explainSetup: (...args) => mockExplain(...args) }));

const { readJsonBody } = require("../../src/web/apiBody");
const { refreshEventMessage } = require("../../src/web/eventMessage");
const setupMessage = require("../../src/web/setupMessage");
const route = require("../../src/web/apiRoutes/setup");
const { checkAccess } = require("../../src/web/apiAccess");
const { su } = require("../utils/setup/fixtures");

const ID = "eh-kara";
const ORGA = { id: "orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };

function res() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const status = (r) => r.writeHead.mock.calls[0][0];
const body = (r) => {
    const parsed = JSON.parse(r.end.mock.calls[0][0]);
    return parsed.data || parsed;
};
const url = (q) => new URL(`http://x/api/raids/setup?${q}`);

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = res();
    await handler({ headers: {} }, r, query ? url(query) : undefined);
    return r;
}

beforeEach(() => {
    mockConfig = {};
    mockEvents.clear();
    mockEvents.set(ID, {
        id: ID, source: "eventhelper", guildId: "g1", categoryId: "cat", title: "Kara", startTime: 2000000000,
        versionId: "tbc", size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, setup: null, message: { channelId: "c", messageId: "m" },
    });
    mockSignups = [
        su("tank", "Warrior-Protection"), su("heal1", "Priest-Holy"), su("heal2", "Paladin-Holy"), su("mage", "Mage-Fire"),
        su("rogue", "Rogue-Combat"), su("lock", "Warlock-Destruction"), su("hunter", "Hunter-BeastMastery"),
        su("sham", "Shaman-Enhancement"), su("feral", "Druid-Feral"), su("spriest", "Priest-Shadow"),
        su("late", "Mage-Frost", { comment: "kommt 20:30" }),
    ];
    mockExplain.mockReset();
    refreshEventMessage.mockClear();
    setupMessage.publishSetup.mockClear();
});

describe("access", () => {
    it("lists every setup path under raids — reading is GET, everything else a write", () => {
        for (const path of ["/api/raids/setup", "/api/raids/setup/propose", "/api/raids/setup/approve", "/api/raids/setup/post", "/api/raids/setup/explain"]) {
            expect(checkAccess(path, "POST", READER)).toMatchObject({ status: 403 });
            expect(checkAccess(path, "POST", ORGA)).toBeNull();
        }
        expect(checkAccess("/api/raids/setup", "GET", READER)).toBeNull();
        expect(checkAccess("/api/raids/setup", "PUT", READER)).toMatchObject({ status: 403 });
        const member = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
        expect(checkAccess("/api/raids/setup", "GET", member)).toMatchObject({ status: 403 });
    });

    it("refuses writes of a reader in the handler as well", async () => {
        for (const handler of [route.postPropose, route.putSetup, route.postApprove, route.postPublish, route.postExplain]) {
            const r = await call(handler, READER, { event: ID });
            expect(status(r)).toBe(403);
        }
        expect(mockEvents.get(ID).setup).toBeNull();
        expect(setupMessage.publishSetup).not.toHaveBeenCalled();
    });
});

describe("posting the approved setup (#290)", () => {
    it("posts on approval, not on a proposal, and not again for an already approved setup", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        expect(setupMessage.publishSetup).not.toHaveBeenCalled();
        const version = mockEvents.get(ID).setup.version;
        await call(route.postApprove, ORGA, { event: ID, version });
        expect(setupMessage.publishSetup).toHaveBeenCalledWith(ID, { userId: "orga" });
        setupMessage.publishSetup.mockClear();
        const again = await call(route.postApprove, ORGA, { event: ID, version });
        expect(body(again).message).toMatch(/schon freigegeben/);
        expect(setupMessage.publishSetup).not.toHaveBeenCalled();
    });

    it("says in the approval's answer when the message could not be posted", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        setupMessage.publishSetup.mockResolvedValueOnce({ post: { code: "discord", error: "Bot nicht verbunden." }, dms: null });
        const r = await call(route.postApprove, ORGA, { event: ID, version: mockEvents.get(ID).setup.version });
        expect(status(r)).toBe(200);
        expect(body(r).message).toMatch(/nicht gepostet: Bot nicht verbunden/);
    });

    it("gives the orga the publish plan and a reader nothing of it", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        expect(body(await call(route.getSetup, ORGA, null, `event=${ID}`)).publish).toEqual({ dmsEnabled: false, recipients: 10 });
        expect(body(await call(route.getSetup, READER, null, `event=${ID}`))).not.toHaveProperty("publish");
    });

    it("POST /post re-posts and reports a refusal with its code", async () => {
        const ok = await call(route.postPublish, ORGA, { event: ID });
        expect(status(ok)).toBe(200);
        expect(body(ok).message).toBe("Setup gepostet.");
        setupMessage.publishSetup.mockResolvedValueOnce({ post: { code: "no_approved_setup", error: "Es gibt noch kein freigegebenes Setup." } });
        const refused = await call(route.postPublish, ORGA, { event: ID });
        expect(status(refused)).toBe(400);
        expect(body(refused).error.code).toBe("no_approved_setup");
    });
});

describe("the draft stays with the orga", () => {
    it("hands a reader neither the draft nor anything of it, only the approved lineup", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        const draft = await call(route.getSetup, READER, null, `event=${ID}`);
        expect(status(draft)).toBe(200);
        const seen = body(draft);
        expect(seen).toMatchObject({ canWrite: false, approved: null });
        expect(seen).not.toHaveProperty("setup");
        expect(JSON.stringify(seen)).not.toMatch(/"heal1"|reasons/);

        const version = mockEvents.get(ID).setup.version;
        const approved = await call(route.postApprove, ORGA, { event: ID, version });
        expect(status(approved)).toBe(200);
        expect(body(approved).message).toMatch(/freigegeben/);
        expect(refreshEventMessage).toHaveBeenCalledWith(ID);

        const after = body(await call(route.getSetup, READER, null, `event=${ID}`));
        expect(after.approved.groups.flatMap((g) => g.slots)).toHaveLength(10);
        expect(after).not.toHaveProperty("setup");
    });

    it("gives the orga the draft with checks and reasons", async () => {
        const proposed = await call(route.postPropose, ORGA, { event: ID });
        expect(status(proposed)).toBe(200);
        const view = body(proposed);
        expect(view).toMatchObject({ canWrite: true, setup: { status: "draft", version: 1 }, hasApiKey: false });
        expect(view.setup.groups[0].slots[0].reasons.length).toBeGreaterThan(0);
    });

    it("answers a manual save that breaks a rule with 400 and a conflict with 409", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        const dup = await call(route.putSetup, ORGA, { event: ID, groups: [{ index: 1, slots: [{ userId: "mage" }] }, { index: 2, slots: [{ userId: "mage" }] }] });
        expect(status(dup)).toBe(400);
        expect(body(dup).error.code).toBe("invalid");
        const stale = await call(route.putSetup, ORGA, { event: ID, version: 42, groups: [], bench: [] });
        expect(status(stale)).toBe(409);
    });

    it("refuses Raid-Helper events and unknown ids", async () => {
        expect(status(await call(route.getSetup, ORGA, null, "event=12345"))).toBe(409);
        expect(status(await call(route.getSetup, ORGA, null, "event=eh-nope"))).toBe(404);
    });
});

describe("explanation", () => {
    it("refuses without an Anthropic key", async () => {
        await call(route.postPropose, ORGA, { event: ID });
        const r = await call(route.postExplain, ORGA, { event: ID });
        expect(status(r)).toBe(400);
        expect(body(r).error.code).toBe("no_api_key");
        expect(mockExplain).not.toHaveBeenCalled();
    });

    it("runs in the background and stores the text for the setup's version", async () => {
        mockConfig = { anthropic: { apiKey: "sk-test", model: "claude-x" } };
        await call(route.postPropose, ORGA, { event: ID });
        mockExplain.mockResolvedValue({ text: "Gruppe 1 trägt die Nahkämpfer.", model: "claude-x" });
        const r = await call(route.postExplain, ORGA, { event: ID });
        expect(status(r)).toBe(202);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const [setup, ctx, opts] = mockExplain.mock.calls[0];
        expect(setup.groups.length).toBeGreaterThan(0);
        expect(ctx.signups.find((s) => s.userId === "late").comment).toBe("kommt 20:30");
        expect(opts).toEqual({ apiKey: "sk-test", model: "claude-x" });

        const state = body(await call(route.getExplain, ORGA, null, `event=${ID}`));
        expect(state.job.status).toBe("done");
        expect(state.explanation).toMatchObject({ text: "Gruppe 1 trägt die Nahkämpfer.", version: 1 });
        // the explanation never moves anybody or approves anything
        expect(mockEvents.get(ID).setup.status).toBe("draft");
    });
});
