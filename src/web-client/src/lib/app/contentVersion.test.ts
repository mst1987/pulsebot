// The content switch as rules (#563): which version the menu shows, when the
// switch is there at all, what the browser remembers, and the settings' warning list.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CONTENT_VERSION_KEY, canSwitch, otherUpcoming, readStoredVersion, resolveContentVersion, versionRef, writeStoredVersion,
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
