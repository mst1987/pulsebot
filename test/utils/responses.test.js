const {
    getItemsFormatted,
    getItemsToShow,
    getAuctionMessage,
    mySetupResponse,
    setupResponse,
} = require("../../src/utils/responses.js");
const { formatTimestampToDateString } = require("../../src/utils/date.js");
const extendedClassList = require("../../src/config/classlist.js");
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
                `<#chan-1> <t:1700000000:R> \n <:holypala:1> **${extendedClassList["Holy1"].name}**\n${expectedDate} Uhr\n`
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

    describe("getAuctionMessage", () => {
        it("formats the auction announcement with name, raid, endtime and prices", () => {
            const interaction = mockInteraction();
            const legendary = {
                name: "Thunderfury",
                raid: "MC",
                endtime: 1700000000,
                mingold: 100000,
                increment: 10000,
            };

            const result = getAuctionMessage(interaction, legendary);
            const expectedDate = formatTimestampToDateString(1700000000);
            expect(result).toBe(
                `**Thunderfury**\n\nRaid: **MC**\nAuktion endet am **${expectedDate}**\n\nStartpreis ist **100000g** und Mindesterhöhung liegt bei **10000g**\n\nBenutze den **/bid** Befehl um mitzubieten!\n\nExample:\`\`\`/bid gold:350000\`\`\``
            );
        });
    });

    describe("getItemsFormatted", () => {
        it("renders each item as icon, player, linked item and gold", () => {
            const interaction = mockInteraction({
                emojis: [["holypala", emoji("holypala")]],
            });
            const items = [
                {
                    class: "Holy1",
                    player: "Alice",
                    item: "Sword",
                    wowhead: "http://wh/1",
                    gold: 500,
                },
            ];

            const result = getItemsFormatted(interaction, items);
            expect(result).toBe("<:holypala:1> Alice - [Sword](http://wh/1) - 500g");
        });
    });

    describe("getItemsToShow", () => {
        it("filters by date range, sorts by player and sums gold", () => {
            const interaction = mockInteraction({
                emojis: [["holypala", emoji("holypala")]],
            });
            const items = [
                {
                    class: "Holy1",
                    player: "Bob",
                    item: "Shield",
                    wowhead: "http://wh/2",
                    gold: 300,
                    date: "15-11-2023",
                },
                {
                    class: "Holy1",
                    player: "Alice",
                    item: "Sword",
                    wowhead: "http://wh/1",
                    gold: 500,
                    date: "10-11-2023",
                },
                {
                    class: "Holy1",
                    player: "Zed",
                    item: "Bow",
                    wowhead: "http://wh/3",
                    gold: 999,
                    date: "15-12-2023",
                },
            ];
            const dateFrom = new Date(2023, 10, 1);
            const dateEnd = new Date(2023, 10, 30);

            const result = getItemsToShow(interaction, items, dateFrom, dateEnd);
            // Zed (December) is outside the window and excluded from sum + list.
            expect(result).not.toContain("Zed");
            expect(result).toContain("Gesamtausgaben: **800g**");
            // Sorted by player: Alice before Bob.
            expect(result.indexOf("Alice")).toBeLessThan(result.indexOf("Bob"));
        });
    });
});
