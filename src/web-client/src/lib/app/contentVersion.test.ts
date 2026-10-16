// The content switch as rules (#563): which version the menu shows, when the
// switch is there at all, what the browser remembers, and the settings' warning list.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CONTENT_VERSION_KEY, LAST_VERSION_KEY, canSwitch, followStep, otherUpcoming, readLastVersion, readStoredVersion, resolveContentVersion,
    versionRef, writeLastVersion, writeStoredVersion,
} from "./contentVersion";
import type { ContentInfo } from "../../api/session";

const INFO: ContentInfo = {
    mainVersion: "forever", hideOtherVersions: false,
    versions: [{ id: "forever", label: "WoW Forever", short: "Forever" }, { id: "tbc", label: "TBC Anniversary", short: "TBC" }],
};

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("resolveContentVersion", () => {
    it("takes the pick while it is offered, else the main version", () => {
        expect(resolveContentVersion("tbc", INFO)).toBe("tbc");
        expect(resolveContentVersion("", INFO)).toBe("forever");
        expect(resolveContentVersion("classic", INFO)).toBe("forever");
    });

    it("is always the main version while the others are hidden", () => {
        expect(resolveContentVersion("tbc", { ...INFO, hideOtherVersions: true })).toBe("forever");
    });
});

describe("canSwitch", () => {
    it("only with a choice to make", () => {
        expect(canSwitch(INFO)).toBe(true);
        expect(canSwitch({ ...INFO, versions: [INFO.versions[0]] })).toBe(false);
        expect(canSwitch({ ...INFO, hideOtherVersions: true })).toBe(false);
    });
});

describe("the remembered pick", () => {
    it("stores another version, and the main version as nothing", () => {
        writeStoredVersion("tbc", INFO);
        expect(localStorage.getItem(CONTENT_VERSION_KEY)).toBe("tbc");
        expect(readStoredVersion()).toBe("tbc");
        writeStoredVersion("forever", INFO);
        expect(localStorage.getItem(CONTENT_VERSION_KEY)).toBeNull();
        expect(readStoredVersion()).toBe("");
    });

    it("survives a store that throws", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        expect(readStoredVersion()).toBe("");
        expect(() => writeStoredVersion("tbc", INFO)).not.toThrow();
    });
});

describe("the version shown last", () => {
    it("keeps the resolved version, main version included, and ignores nothing", () => {
        expect(readLastVersion()).toBe("");
        writeLastVersion("forever");
        expect(localStorage.getItem(LAST_VERSION_KEY)).toBe("forever");
        writeLastVersion("");
        expect(readLastVersion()).toBe("forever");
        writeLastVersion("tbc");
        expect(readLastVersion()).toBe("tbc");
    });

    it("survives a store that throws", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        expect(readLastVersion()).toBe("");
        expect(() => writeLastVersion("tbc")).not.toThrow();
    });
});

describe("versionRef / otherUpcoming", () => {
    it("labels a known version and makes do with the id otherwise", () => {
        expect(versionRef(INFO, "tbc").short).toBe("TBC");
        expect(versionRef(INFO, "classic")).toEqual({ id: "classic", label: "classic", short: "classic" });
    });

    it("lists the coming raids of every other version, soonest first", () => {
        const list = otherUpcoming({
            forever: [{ id: "f", title: "Ony", startTime: 5 }],
            tbc: [{ id: "b", title: "BT", startTime: 30 }],
            classic: [{ id: "m", title: "MC", startTime: 10 }],
        }, "forever");
        expect(list.map((r) => r.id)).toEqual(["m", "b"]);
        expect(otherUpcoming(undefined, "forever")).toEqual([]);
    });
});

// A page about one record follows its version (#741, hooks/useFollowVersion).
describe("followStep", () => {
    const offered = ["tbc", "forever"];
    it("switches to a record of another offered version, once", () => {
        expect(followStep({ record: "tbc", shown: "forever", followed: "", offered })).toEqual({ step: "switch", to: "tbc", key: "tbc" });
        // after the switch the menu shows it: nothing more to do
        expect(followStep({ record: "tbc", shown: "tbc", followed: "tbc", offered }).step).toBe("stay");
    });

    it("only remembers a record of the shown version, or one the switch does not offer (hidden, no data)", () => {
        expect(followStep({ record: "tbc", shown: "tbc", followed: "", offered })).toEqual({ step: "mark", to: "", key: "tbc" });
        expect(followStep({ record: "classic", shown: "tbc", followed: "", offered })).toEqual({ step: "mark", to: "", key: "classic" });
    });

    it("leaves a followed record when the menu switches away from it", () => {
        expect(followStep({ record: "tbc", shown: "forever", followed: "tbc", offered }).step).toBe("leave");
    });

    it("takes a record with several versions: stays while one of them is shown, else switches to the first offered", () => {
        expect(followStep({ record: ["tbc", "forever"], shown: "forever", followed: "", offered }).step).toBe("mark");
        expect(followStep({ record: ["tbc", "forever"], shown: "forever", followed: "tbc,forever", offered }).step).toBe("stay");
        expect(followStep({ record: ["classic", "forever"], shown: "tbc", followed: "", offered })).toMatchObject({ step: "switch", to: "forever" });
    });

    it("does nothing without a record or outside the shell", () => {
        expect(followStep({ record: "", shown: "tbc", followed: "", offered }).step).toBe("stay");
        expect(followStep({ record: [], shown: "tbc", followed: "", offered }).step).toBe("stay");
        expect(followStep({ record: "tbc", shown: "", followed: "", offered }).step).toBe("stay");
    });
});
