import { describe, expect, it } from "vitest";
import { imageFileName } from "../rosterImage";

describe("imageFileName", () => {
    it("reduces the roster's name to a safe file name", () => {
        expect(imageFileName("Raid Mo / Do")).toBe("roster-raid-mo-do.png");
        expect(imageFileName("Kämpfer")).toBe("roster-kampfer.png");
        expect(imageFileName("###")).toBe("roster-bild.png");
    });
});
