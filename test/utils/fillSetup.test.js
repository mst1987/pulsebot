const {
    buildSetupWrite, fillSetupSheet, enrichPlayers, resolveOptionalColumns,
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
            // Slot 2 is the resto druid's and slot 4 the priest's: with neither
            // signed up, the resto shaman keeps its own slot 3.
            expect(cell(writeData, "Setup!C11:C15")[2]).toEqual(["Shammy"]);
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

// The healer column and the two optional columns (SpellKicks / Decurse) encode
// the raid's dispel duties, which is why they are pinned this precisely.
describe("utils/fillSetup — healer slots and dispel columns", () => {
    const HEALERS = [
        { name: "Pala",   spec: "Holy1",        groupNumber: 1 },  // holypala
        { name: "Shammy", spec: "Restoration1", groupNumber: 1 },  // restosham
        { name: "Druid",  spec: "Restoration",  groupNumber: 2 },  // resto druid
        { name: "Priest", spec: "Holy",         groupNumber: 2 },  // holypriest
        { name: "Disc",   spec: "Discipline",   groupNumber: 3 },
    ];

    function healerColumn(slots) {
        const { writeData } = buildSetupWrite(slots, {});
        return cell(writeData, "Setup!C11:C15").map((row) => row[0]);
    }

    describe("healer column C11:C15", () => {
        it("puts the resto druid second and the priest fourth", () => {
            expect(healerColumn(HEALERS))
                .toEqual(["Pala", "Druid", "Shammy", "Priest", "Disc"]);
        });

        it("keeps the wanted specs even when they sign up last", () => {
            const reversed = [...HEALERS].reverse();
            expect(healerColumn(reversed).slice(0, 4))
                .toEqual(["Pala", "Druid", "Shammy", "Disc"]);
        });

        // "Sofern vorhanden — ansonsten mit den übrigen füllen": a missing spec
        // must not leave a hole while healers are still unassigned.
        it("fills a slot whose spec is missing with a leftover healer", () => {
            const noDruid = [
                { name: "Pala",   spec: "Holy1",        groupNumber: 1 },
                { name: "Shammy", spec: "Restoration1", groupNumber: 1 },
                { name: "Priest", spec: "Holy",         groupNumber: 2 },
                { name: "Extra",  spec: "Restoration1", groupNumber: 2 },
            ];
            expect(healerColumn(noDruid))
                .toEqual(["Pala", "Extra", "Shammy", "Priest", ""]);
        });

        // The lone healer is a priest, so he takes his own slot 4 — the other
        // slots stay empty rather than pulling him out of it.
        it("leaves the other slots empty when nobody is left over", () => {
            expect(healerColumn([{ name: "Solo", spec: "Holy", groupNumber: 1 }]))
                .toEqual(["", "", "", "Solo", ""]);
        });
    });

    describe("resolveOptionalColumns", () => {
        it("maps the row-26 headers to their column letters", () => {
            const header = ["", "Priest", "Mage", "Kicks", "Hunter", "SpellKicks", "WLs", "SS Target", "", "", "Decurse"];
            expect(resolveOptionalColumns(header)).toEqual({ spellkicks: "F", decurse: "K" });
        });

        it("ignores case and surrounding whitespace", () => {
            expect(resolveOptionalColumns(["", " decurse "])).toEqual({ decurse: "B" });
        });

        it("returns nothing for a sheet without those headers", () => {
            expect(resolveOptionalColumns(["", "Priest", "Mage"])).toEqual({});
            expect(resolveOptionalColumns([])).toEqual({});
            expect(resolveOptionalColumns(undefined)).toEqual({});
        });
    });

    describe("SpellKicks and Decurse columns", () => {
        const CASTERS = [
            { name: "Magey",  spec: "Fire",        groupNumber: 1 },
            { name: "Ele",    spec: "Elemental",   groupNumber: 1 },
            { name: "Boomie", spec: "Balance",     groupNumber: 2 },
            { name: "Tree",   spec: "Restoration", groupNumber: 2 },
            { name: "Lock",   spec: "Affliction",  groupNumber: 3 },
        ];

        it("writes nothing extra when the sheet has neither header", () => {
            const { writeData } = buildSetupWrite(CASTERS, {});
            expect(writeData.some((d) => /!(F|K)27:/.test(d.range))).toBe(false);
        });

        it("fills SpellKicks with elemental shamans first, then mages", () => {
            const { writeData } = buildSetupWrite(CASTERS, { columns: { spellkicks: "F" } });
            expect(cell(writeData, "Setup!F27:F31"))
                .toEqual([["Ele"], ["Magey"], [""], [""], [""]]);
        });

        it("fills Decurse with mages, then resto and balance druids", () => {
            const { writeData } = buildSetupWrite(CASTERS, { columns: { decurse: "K" } });
            expect(cell(writeData, "Setup!K27:K31"))
                .toEqual([["Magey"], ["Tree"], ["Boomie"], [""], [""]]);
        });

        it("uses the resolved column letter, not a hard-coded one", () => {
            const { writeData } = buildSetupWrite(CASTERS, { tab: "T6", columns: { decurse: "M" } });
            expect(cell(writeData, "T6!M27:M31")[0]).toEqual(["Magey"]);
        });
    });

    describe("fillSetupSheet header lookup", () => {
        function clientWithHeader(header) {
            return {
                readRange: jest.fn().mockResolvedValue(header ? [header] : []),
                batchClear: jest.fn().mockResolvedValue(undefined),
                batchWrite: jest.fn().mockResolvedValue(undefined),
                applyConditionalFormatting: jest.fn().mockResolvedValue(undefined),
            };
        }

        it("reads row 26 and writes the columns it finds there", async () => {
            const client = clientWithHeader(["", "Priest", "Mage", "Kicks", "Hunter", "SpellKicks"]);
            await fillSetupSheet(client, [{ name: "Magey", spec: "Fire", groupNumber: 1 }], { tab: "Setup" });
            expect(client.readRange).toHaveBeenCalledWith("Setup!A26:Z26");
            const written = client.batchWrite.mock.calls[0][0];
            expect(written.find((d) => d.range === "Setup!F27:F31").values[0]).toEqual(["Magey"]);
            expect(written.some((d) => d.range.startsWith("Setup!K"))).toBe(false);
        });

        // A sheet we can't read is still worth filling the old way.
        it("fills the sheet anyway when the header row cannot be read", async () => {
            const client = clientWithHeader(null);
            client.readRange.mockRejectedValue(new Error("no access"));
            const summary = await fillSetupSheet(client, SAMPLE, { tab: "Setup" });
            expect(summary.playerCount).toBe(4);
            expect(client.batchWrite).toHaveBeenCalled();
        });

        it("skips the lookup when the caller passes the columns", async () => {
            const client = clientWithHeader(["", "SpellKicks"]);
            await fillSetupSheet(client, SAMPLE, { tab: "Setup", columns: {} });
            expect(client.readRange).not.toHaveBeenCalled();
        });
    });
});
