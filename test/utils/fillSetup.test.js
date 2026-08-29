const {
    buildSetupWrite, fillSetupSheet, enrichPlayers,
} = require("../../src/utils/fillSetup.js");

// Find the values written to a given A1 range in the batch payload.
function cell(writeData, range) {
    const entry = writeData.find((d) => d.range === range);
    return entry ? entry.values : undefined;
}

const SAMPLE = [
    { name: "Tanky",   spec: "Protection1", group: 1 },  // protpala → B11
    { name: "Bear",    spec: "Guardian",    group: 1 },  // guardian → B12
    { name: "Healpal", spec: "Holy1",       group: 2 },  // holypala → C11
    { name: "Shammy",  spec: "Restoration1", group: 2 }, // restosham → C12
];

describe("utils/fillSetup", () => {
    describe("enrichPlayers", () => {
        it("drops empty slots and resolves the class entry", () => {
            const players = enrichPlayers([
                { name: "Tanky", spec: "Protection1", group: 1 },
                { name: "", spec: "Holy1" },
                { spec: "Holy1" },
            ]);
            expect(players).toHaveLength(1);
            expect(players[0].name).toBe("Tanky");
            expect(players[0].entry.icon).toBe("protpala");
        });

        it("takes the group from groupNumber when `group` is absent", () => {
            const players = enrichPlayers([{ name: "Ranged", spec: "Restoration1", groupNumber: 4 }]);
            expect(players[0].group).toBe(4);
        });
    });

    describe("buildSetupWrite", () => {
        it("places tanks, the manual tank, and healers in the right cells", () => {
            const { writeData } = buildSetupWrite(SAMPLE, { tab: "Setup", tank3: "Manual" });
            expect(cell(writeData, "Setup!B11")).toEqual([["Tanky"]]);
            expect(cell(writeData, "Setup!B12")).toEqual([["Bear"]]);
            expect(cell(writeData, "Setup!B13")).toEqual([["Manual"]]);
            expect(cell(writeData, "Setup!C11:C15")[0]).toEqual(["Healpal"]);
            expect(cell(writeData, "Setup!C11:C15")[1]).toEqual(["Shammy"]);
        });

        it("fills raid groups column by column, padded to five rows", () => {
            const { writeData } = buildSetupWrite(SAMPLE, {});
            expect(cell(writeData, "Setup!B3:B7")).toEqual([["Tanky"], ["Bear"], [""], [""], [""]]);
            expect(cell(writeData, "Setup!C3:C7")).toEqual([["Healpal"], ["Shammy"], [""], [""], [""]]);
        });

        // Raid-Helper sends the group as `groupNumber`. Falling through to the
        // index heuristic would put the fifth slot in group 1, because that
        // heuristic assumes every group is full.
        it("reads Raid-Helper's groupNumber so a non-full group shifts nobody", () => {
            const slots = [
                { name: "One", spec: "Restoration1", groupNumber: 1 },
                { name: "Two", spec: "Restoration1", groupNumber: 1 },
                { name: "Three", spec: "Restoration1", groupNumber: 1 },
                { name: "Four", spec: "Restoration1", groupNumber: 1 },
                { name: "Five", spec: "Restoration1", groupNumber: 2 },
            ];
            const { writeData } = buildSetupWrite(slots, {});
            expect(cell(writeData, "Setup!B3:B7")).toEqual([["One"], ["Two"], ["Three"], ["Four"], [""]]);
            expect(cell(writeData, "Setup!C3:C7")).toEqual([["Five"], [""], [""], [""], [""]]);
        });

        // Kick priority: Kick, then Pummel/Shield Bash, Earth Shock last.
        // The input order is deliberately mixed so the test pins the sorting.
        it("orders the kick column rogues, then warriors, then enhancers", () => {
            const slots = [
                { name: "Enh", spec: "Enhancement", groupNumber: 1 },
                { name: "Fury", spec: "Fury", groupNumber: 1 },
                { name: "Sneak", spec: "Combat", groupNumber: 1 },
                { name: "Arms", spec: "Arms", groupNumber: 1 },
            ];
            const { writeData } = buildSetupWrite(slots, {});
            expect(cell(writeData, "Setup!D27:D31"))
                .toEqual([["Sneak"], ["Fury"], ["Arms"], ["Enh"], [""]]);
        });

        it("honours a custom tab name and clears the manual block", () => {
            const { writeData, clearRanges } = buildSetupWrite(SAMPLE, { tab: "Tier6" });
            expect(writeData.every((d) => d.range.startsWith("Tier6!"))).toBe(true);
            expect(clearRanges).toEqual(["Tier6!D11:G15"]);
        });

        it("reports a summary and per-player colours", () => {
            const { summary, playerColors } = buildSetupWrite(SAMPLE, { tank3: "Manual" });
            expect(summary.playerCount).toBe(4);
            expect(summary.tanks).toEqual(["Tanky", "Bear", "Manual"]);
            expect(summary.healers).toBe(2);
            expect(playerColors.map((p) => p.name)).toContain("Tanky");
        });

        it("defaults tank3 to an empty cell when not provided", () => {
            const { writeData, summary } = buildSetupWrite(SAMPLE, {});
            expect(cell(writeData, "Setup!B13")).toEqual([[""]]);
            expect(summary.tanks[2]).toBe("(leer)");
        });
    });

    describe("fillSetupSheet", () => {
        function fakeClient() {
            return {
                batchClear: jest.fn().mockResolvedValue(undefined),
                batchWrite: jest.fn().mockResolvedValue(undefined),
                applyConditionalFormatting: jest.fn().mockResolvedValue(undefined),
            };
        }

        it("clears, writes and formats, then returns the summary", async () => {
            const client = fakeClient();
            const summary = await fillSetupSheet(client, SAMPLE, { tab: "Setup", tank3: "Manual" });
            expect(client.batchClear).toHaveBeenCalledWith(["Setup!D11:G15"]);
            expect(client.batchWrite).toHaveBeenCalled();
            expect(client.applyConditionalFormatting).toHaveBeenCalled();
            expect(summary.playerCount).toBe(4);
        });

        it("rejects when the Sheets client throws", async () => {
            const client = fakeClient();
            client.batchWrite.mockRejectedValue(new Error("boom"));
            await expect(fillSetupSheet(client, SAMPLE, { tab: "Setup" })).rejects.toThrow("boom");
        });
    });
});
