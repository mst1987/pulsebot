const {
    isNumber,
    formatNumberWithDots,
    formatSpecs,
    getChannelsFromCategories,
    checkForPermission,
    botReply,
    botEditReply,
} = require("../../src/utils/helper.js");
const { adminUserId } = require("../../src/config/variables.js");
const { mockInteraction, makeCollection } = require("../helpers/mockInteraction.js");

describe("utils/helper", () => {
    describe("isNumber", () => {
        it("accepts finite numbers", () => {
            expect(isNumber(0)).toBe(true);
            expect(isNumber(42)).toBe(true);
            expect(isNumber(-1.5)).toBe(true);
        });

        it("rejects NaN, strings and other types", () => {
            expect(isNumber(NaN)).toBe(false);
            expect(isNumber("5")).toBe(false);
            expect(isNumber(null)).toBe(false);
            expect(isNumber(undefined)).toBe(false);
        });
    });

    describe("formatNumberWithDots", () => {
        it("groups thousands with dots", () => {
            expect(formatNumberWithDots(1000)).toBe("1.000");
            expect(formatNumberWithDots(1234567)).toBe("1.234.567");
        });

        it("leaves small numbers untouched", () => {
            expect(formatNumberWithDots(42)).toBe("42");
        });
    });

    describe("formatSpecs", () => {
        it("maps known spec keys to className/specName", () => {
            const result = formatSpecs("Holy1", "10");
            expect(result).toEqual([{ className: "Paladin", specName: "Holy1" }]);
        });

        it("uses sodclazz for template 40", () => {
            const result = formatSpecs("Holy1", "40");
            expect(result[0].className).toBe("Healer");
        });

        it("skips unknown spec keys and caps at 10", () => {
            expect(formatSpecs("NotAReal Spec", "10")).toEqual([]);
            expect(formatSpecs(undefined, "10")).toEqual([]);
        });
    });

    describe("getChannelsFromCategories", () => {
        it("returns ids of text channels under the given categories", () => {
            const guild = {
                channels: {
                    cache: makeCollection([
                        ["c1", { id: "c1", type: 0, parent: { id: "cat1" } }],
                        ["c2", { id: "c2", type: 0, parent: { id: "cat2" } }],
                        ["v1", { id: "v1", type: 2, parent: { id: "cat1" } }],
                        ["top", { id: "top", type: 0, parent: null }],
                    ]),
                },
            };
            expect(getChannelsFromCategories(guild, ["cat1"])).toEqual(["c1"]);
        });
    });

    describe("checkForPermission", () => {
        it("returns true for the admin user", () => {
            const interaction = mockInteraction({ userId: String(adminUserId).split(",")[0] });
            expect(checkForPermission(interaction)).toBe(true);
            expect(interaction.reply).not.toHaveBeenCalled();
        });

        it("returns false and replies for a non-admin", () => {
            const interaction = mockInteraction({ userId: "not-an-admin" });
            expect(checkForPermission(interaction)).toBe(false);
            expect(interaction.reply).toHaveBeenCalledTimes(1);
        });
    });

    describe("botReply / botEditReply", () => {
        it("botReply sends an embed with the given title and description", async () => {
            const interaction = mockInteraction();
            await botReply(interaction, "Titel", "Nachricht", 0);
            expect(interaction.reply).toHaveBeenCalledTimes(1);
            const arg = interaction.reply.mock.calls[0][0];
            expect(arg.embeds[0]).toMatchObject({ title: "Titel", description: "Nachricht" });
            expect(arg.ephemeral).toBe(true);
        });

        it("botEditReply edits the deferred reply", async () => {
            const interaction = mockInteraction();
            await botEditReply(interaction, "T", "M");
            expect(interaction.editReply).toHaveBeenCalledTimes(1);
            expect(interaction.editReply.mock.calls[0][0].embeds[0].description).toBe("M");
        });

        it("botReply swallows errors from interaction.reply", async () => {
            const interaction = mockInteraction();
            interaction.reply.mockRejectedValueOnce(new Error("boom"));
            await expect(botReply(interaction, "T", "M", 0)).resolves.toBeUndefined();
        });
    });
});
