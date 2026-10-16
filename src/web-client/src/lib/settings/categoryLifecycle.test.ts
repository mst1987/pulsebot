import { describe, expect, it } from "vitest";
import { deactivatedIds, raiderRoleOptions, seriesWhen } from "./categoryLifecycle";

describe("lib/settings/categoryLifecycle (#744)", () => {
    it("names the categories a save deactivates", () => {
        expect(deactivatedIds(["mon", "thu"], ["thu", "fri"])).toEqual(["mon"]);
        expect(deactivatedIds(undefined, ["thu"])).toEqual([]);
        expect(deactivatedIds(["mon"], ["mon"])).toEqual([]);
    });

    it("puts a series in one line", () => {
        expect(seriesWhen({ enabled: true, weekdays: [1, 4], time: "19:30" })).toBe("Mo + Do 19:30");
        expect(seriesWhen(null)).toBe("");
    });

    it("offers a renamed raider role by id, the roles in use first", () => {
        const roles = [
            { id: "r-new", name: "Raider Forever", color: "" },
            { id: "r-core", name: "Kern", color: "" }, // was "TBC Raider", renamed in Discord
            { id: "r-fun", name: "Gamer", color: "" },
        ];
        expect(raiderRoleOptions(roles, { mon: ["r-core"] }).map((r) => r.id)).toEqual(["r-core", "r-new"]);
        expect(raiderRoleOptions(roles, {}).map((r) => r.id)).toEqual(["r-new"]);
    });
});
