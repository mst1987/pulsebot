// The util builds on classes/raidhelper (network) and helper.getCategoryEvents
// (also network). Both are mocked so no real HTTP happens.
const mockGetSetup = jest.fn();
const mockGetCategoryEvents = jest.fn();

jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({ getSetup: mockGetSetup }))
);

jest.mock("../../src/utils/helper", () => ({
    getCategoryEvents: mockGetCategoryEvents,
    getCharacterIcon: (interaction, spec) => `[${spec}]`,
    delay: jest.fn(),
}));

const {
    getAllSignUps,
    getCategorySetups,
    getSetupsFromEvents,
} = require("../../src/utils/raidhelper.js");
const { mockInteraction } = require("../helpers/mockInteraction.js");

describe("utils/raidhelper", () => {
    describe("getAllSignUps", () => {
        it("splits events into those with and without a real (non-Absence) signup", async () => {
            const interaction = mockInteraction({ userId: "123" });
            mockGetCategoryEvents.mockResolvedValueOnce([
                {
                    channelId: "cA",
                    signUps: [{ userId: "123", specName: "Holy1" }],
                },
                {
                    channelId: "cB",
                    signUps: [{ userId: "999", specName: "Holy1" }],
                },
                {
                    channelId: "cC",
                    signUps: [{ userId: "123", specName: "Absence" }],
                },
            ]);

            const result = await getAllSignUps(interaction, "cat-1");
            // cB (other user) and cC (Absence only) count as missing signups.
            expect(result.noSignUps).toBe("<#cB>\n<#cC>");
            // cA is the only real signup; spec icon comes from the mocked helper.
            expect(result.signUps).toBe("<#cA>  [Holy1]\n");
        });
    });

    describe("getCategorySetups", () => {
        it("keeps events with the user in the setup plus events without any setup", async () => {
            const interaction = mockInteraction({ userId: "123" });
            mockGetCategoryEvents.mockResolvedValueOnce([
                { id: "e1", channelId: "c1", startTime: 100 },
                { id: "e2", channelId: "c2", startTime: 200 },
                { id: "e3", channelId: "c3", startTime: 300 },
            ]);
            mockGetSetup.mockImplementation((raidid) => {
                if (raidid === "e1") return Promise.resolve({ setup: [{ id: "123" }] });
                if (raidid === "e2") return Promise.resolve({ setup: [{ id: "999" }] });
                return Promise.resolve(undefined); // e3 -> no setup
            });

            const result = await getCategorySetups(interaction, "cat-1");
            const channelIds = result.map((e) => e.channelid);
            expect(channelIds).toEqual(expect.arrayContaining(["c1", "c3"]));
            expect(channelIds).not.toContain("c2");
        });
    });

    describe("getSetupsFromEvents", () => {
        it("returns only events whose setup contains the user", async () => {
            const interaction = mockInteraction({ userId: "123" });
            const events = [
                { id: "e1", channelId: "c1", startTime: 100 },
                { id: "e2", channelId: "c2", startTime: 200 },
                { id: "e3", channelId: "c3", startTime: 300 },
            ];
            mockGetSetup.mockImplementation((raidid) => {
                if (raidid === "e1") return Promise.resolve({ setup: [{ id: "123" }] });
                if (raidid === "e2") return Promise.resolve({ setup: [{ id: "999" }] });
                return Promise.resolve(undefined); // e3 -> not pushed at all
            });

            const result = await getSetupsFromEvents({}, interaction, events);
            expect(result.map((e) => e.channelid)).toEqual(["c1"]);
        });
    });
});
