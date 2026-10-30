import { describe, expect, it } from "vitest";
import { toggleFold } from "../folds";

describe("toggleFold", () => {
    it("opens one part alone, closing every other", () => {
        expect(toggleFold(["attendance", "days"], "raids")).toEqual(["raids"]);
    });

    it("closes one of the default parts and leaves the rest open", () => {
        expect(toggleFold(["attendance", "days"], "attendance")).toEqual(["days"]);
        expect(toggleFold(["days"], "days")).toEqual([]);
    });
});
