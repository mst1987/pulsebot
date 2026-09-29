// #555: the open section of a raid plan in the address - `#boss=<key>` restores it after a reload, `?section=` stays the deep link.
import { afterEach, describe, expect, it } from "vitest";
import { hasSectionDeepLink, hashWithSection, sectionFromHash, sectionFromUrl, showSectionInUrl } from "./sectionUrl";

afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("sectionFromHash / hashWithSection", () => {
    it("reads the key, with or without the leading #, and ignores other parts", () => {
        expect(sectionFromHash("#boss=bt/supremus")).toBe("bt/supremus");
        expect(sectionFromHash("boss=bt%2Fsupremus&x=1")).toBe("bt/supremus");
        expect(sectionFromHash("#x=1")).toBe("");
        expect(sectionFromHash("")).toBe("");
    });

    it("sets and removes the key, keeps other parts and the slash readable", () => {
        expect(hashWithSection("", "bt/supremus")).toBe("#boss=bt/supremus");
        expect(hashWithSection("#x=1&boss=old", "general")).toBe("#x=1&boss=general");
        expect(hashWithSection("#boss=old", "")).toBe("");
        expect(sectionFromHash(hashWithSection("", "a b/c&d"))).toBe("a b/c&d");
    });
});

describe("sectionFromUrl / hasSectionDeepLink", () => {
    it("takes the hash of the last visit first, else the deep link", () => {
        expect(sectionFromUrl({ search: "?section=bt/najentus", hash: "#boss=bt/supremus" })).toBe("bt/supremus");
        expect(sectionFromUrl({ search: "?section=bt/najentus", hash: "" })).toBe("bt/najentus");
        expect(sectionFromUrl({ search: "", hash: "" })).toBe("");
    });

    it("only ?section= counts as the deep link that pauses following", () => {
        expect(hasSectionDeepLink({ search: "?section=bt/najentus" })).toBe(true);
        expect(hasSectionDeepLink({ search: "?event=eh_1" })).toBe(false);
    });
});

describe("showSectionInUrl", () => {
    it("writes the hash without a new history entry and keeps path, query and history state", () => {
        window.history.replaceState({ key: "router" }, "", "/raids/detail?event=eh_1&tab=plan");
        const before = window.history.length;
        showSectionInUrl("bt/supremus");
        expect(window.location.pathname).toBe("/raids/detail");
        expect(window.location.search).toBe("?event=eh_1&tab=plan");
        expect(sectionFromHash(window.location.hash)).toBe("bt/supremus");
        expect(window.history.state).toEqual({ key: "router" });
        expect(window.history.length).toBe(before);
        showSectionInUrl("general");
        expect(sectionFromUrl()).toBe("general");
    });
});
