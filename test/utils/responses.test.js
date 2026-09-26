const {
    mySetupResponse,
    setupResponse,
} = require("../../src/utils/responses.js");
const { formatTimestampToDateString } = require("../../src/utils/time");
const { entryFor } = require("../../src/config/classlist.js");
const { mockInteraction } = require("../helpers/mockInteraction.js");

// Build an emoji whose string interpolation is deterministic, mimicking a
// real Discord custom emoji (`<:name:id>`), so we can assert exact strings.
function emoji(name) {
    return { name, toString: () => `<:${name}:1>` };
}

describe("utils/responses", () => {
    describe("setupResponse", () => {
        it("renders the user's spec when they are in the setup", () => {
            const interaction = mockInteraction({
                userId: "123",
                emojis: [["holypala", emoji("holypala")]],
            });
            const event = {
                channelid: "chan-1",
                startTime: 1700000000,
                setup: [{ id: "123", specName: "Holy1" }],
            };

            const result = setupResponse(interaction, event);
            const expectedDate = formatTimestampToDateString(1700000000 * 1000);
            expect(result).toBe(
                `<#chan-1> <t:1700000000:R> \n <:holypala:1> **${entryFor("Holy1").name}**\n${expectedDate} Uhr\n`
            );
        });

        it("shows 'Not in Setup' with the sadcat emoji when the user is absent from an existing setup", () => {
            const interaction = mockInteraction({
                userId: "123",
                emojis: [["sadcat", emoji("sadcat")]],
            });
            const event = {
                channelid: "chan-2",
                startTime: 1700000000,
                setup: [{ id: "999", specName: "Holy1" }],
            };

            const result = setupResponse(interaction, event);
            expect(result).toContain("<:sadcat:1> **Not in Setup**");
        });

        it("shows 'Setup not done yet' with the copium emoji when there is no setup", () => {
            const interaction = mockInteraction({
                userId: "123",
                emojis: [["copium", emoji("copium")]],
            });
            const event = { channelid: "chan-3", startTime: 1700000000 };

            const result = setupResponse(interaction, event);
            expect(result).toContain("<:copium:1> **Setup not done yet**");
        });
    });

    describe("mySetupResponse", () => {
        it("keeps only events where the user is in the setup, sorted by startTime", () => {
            const interaction = mockInteraction({
                userId: "123",
                emojis: [["holypala", emoji("holypala")]],
            });
            const events = [
                {
                    channelid: "later",
                    startTime: 200,
                    setup: [{ userid: "123", spec: "Holy1" }],
                },
                {
                    channelid: "earlier",
                    startTime: 100,
                    setup: [{ userid: "123", spec: "Holy1" }],
                },
                {
                    channelid: "other",
                    startTime: 150,
                    setup: [{ userid: "999", spec: "Holy1" }],
                },
            ];

            const result = mySetupResponse(interaction, events);
            const lines = result.split("\n\n");
            // "other" (not the user) must be dropped; "earlier" must come first.
            expect(result).not.toContain("<#other>");
            expect(lines[0]).toContain("<#earlier>");
            expect(lines[1]).toContain("<#later>");
            expect(result).toContain("<:holypala:1>");
        });
    });
});
