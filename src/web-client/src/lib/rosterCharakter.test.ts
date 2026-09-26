// The roster helpers of lib/rosterView.ts, run for real (design issue #218).
// The pages themselves: pages/RosterPage.test.tsx, pages/HistoryCharPage.test.tsx;
// the conventions: test/web-client/conventions/rosterCharakter.test.js.
import { describe, expect, it } from "vitest";
import type { GearIssue, GearItem } from "../api";
import { attendanceTone, findingsForSlot, nightLabel } from "./rosterView";

function issue(over: Partial<GearIssue>): GearIssue {
    return { kind: "enchant", label: "keine Verzauberung", severity: "medium", itemId: "", itemName: "", slotName: "", iconUrl: "", ...over };
}

function item(slot: string, itemId: number | null): GearItem {
    return { slot, itemId, name: "", quality: "EPIC", level: 115, enchants: [], enchantIds: [], sockets: [], iconUrl: "" };
}

describe("rosterView helpers (mirrored logic)", () => {
    it("nightLabel takes ms — unix seconds passed unconverted lands in January 1970", () => {
        const seconds = Math.floor(Date.UTC(2026, 5, 15, 20, 0, 0) / 1000);
        expect(nightLabel(seconds)).toMatch(/^.. 2[01]\.01\.$/);
        expect(nightLabel(seconds * 1000)).toBe("Mo 15.06.");
    });

    it("tones attendance ok from 80 %, mid from 60 %, bad below, nothing without a figure", () => {
        expect(attendanceTone(80)).toBe("ok");
        expect(attendanceTone(79)).toBe("mid");
        expect(attendanceTone(60)).toBe("mid");
        expect(attendanceTone(59)).toBe("bad");
        expect(attendanceTone(null)).toBeUndefined();
    });

    it("matches findings by item first and by slot key for an empty slot", () => {
        // WCL calls the ring "Ring 2", Battle.net wears it in FINGER_1: the item id decides
        const ring = issue({ itemId: "30000", slotKey: "FINGER_2" });
        const emptyHead = issue({ slotKey: "HEAD", label: "kein Item" });
        const noSlot = issue({ itemName: "Irgendwas" });
        const issues = [ring, emptyHead, noSlot];
        expect(findingsForSlot(issues, "FINGER_1", item("FINGER_1", 30000))).toEqual([ring]);
        expect(findingsForSlot(issues, "FINGER_2", item("FINGER_2", 30001))).toEqual([]);
        expect(findingsForSlot(issues, "HEAD", undefined)).toEqual([emptyHead]);
        // a finding without item and slot belongs to no row
        expect(findingsForSlot([noSlot], "HEAD", undefined)).toEqual([]);
    });
});
