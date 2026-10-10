import { describe, expect, it } from "vitest";
import { isEnchantable } from "./charGear";
import type { GearItem } from "../../api/history";

const item = { iconUrl: "inv_helm.jpg" } as GearItem;

describe("isEnchantable", () => {
    it("marks the TBC enchantable slots, TBC being the default", () => {
        expect(isEnchantable(item, "HEAD")).toBe(true);
        expect(isEnchantable(item, "HEAD", "tbc")).toBe(true);
        expect(isEnchantable(item, "FINGER_1", "tbc")).toBe(false);
    });

    it("applies the TBC rule to no other version (#750)", () => {
        expect(isEnchantable(item, "HEAD", "forever")).toBe(false);
        expect(isEnchantable(item, "HEAD", "classic")).toBe(false);
    });
});
