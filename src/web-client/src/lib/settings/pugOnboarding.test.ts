import { describe, expect, it } from "vitest";
import type { PugOnboardingOverview, PugPrompt, PugRole } from "../../api";
import { blockers, canApply, doneCount, hasPug, previewOf, roleNameOf, rowsOf, sortValueOf, statusTone } from "./pugOnboarding";

const role = (key: string, status: PugRole["status"], name = key): PugRole => ({
    key, kind: key.startsWith("version:") ? "version" : "class", id: key.split(":")[1], name, color: "", status, roleId: status === "new" ? "" : "r1", current: null, categoryIds: [],
});

const prompt = (key: string, status: PugPrompt["status"], options: PugPrompt["options"] = []): PugPrompt => ({
    key, title: key || "Fremd", required: false, status, id: status === "new" ? "" : "p1", options,
});

const base = (over: Partial<PugOnboardingOverview> = {}): PugOnboardingOverview => ({
    guildId: "g1", guildName: "PuG", online: true, applied: null,
    pugCategories: [{ id: "c1", name: "TBC PuGs", versionId: "tbc" }],
    roles: [role("version:tbc", "new", "TBC"), role("class:mage", "same", "Mage")],
    prompts: [prompt("versions", "new")],
    categories: [{ id: "c1", name: "TBC PuGs", versionId: "tbc", roleKey: "version:tbc", status: "changed", missing: ["everyone"] }],
    changes: 3,
    onboarding: { enabled: false, mode: 0, defaultChannels: 0 },
    onboardingError: "",
    prerequisites: [
        { key: "community", ok: true }, { key: "manageRoles", ok: true }, { key: "manageGuild", ok: true }, { key: "roleOrder", ok: true, roles: [] },
    ],
    ...over,
});

describe("lib/settings/pugOnboarding (#906)", () => {
    it("tones a status by what it means", () => {
        expect(statusTone("same")).toBe("ok");
        expect(statusTone("new")).toBe("mid");
        expect(statusTone("changed")).toBe("mid");
        expect(statusTone("lost")).toBe("bad");
    });

    it("lets the button run only with something to do and nothing blocking", () => {
        expect(canApply(base())).toBe(true);
        expect(canApply(null)).toBe(false);
        expect(canApply(base({ changes: 0 }))).toBe(false);
        expect(canApply(base({ online: false }))).toBe(false);
        expect(canApply(base({ pugCategories: [] }))).toBe(false);
        expect(canApply(base({ onboardingError: "Missing Access" }))).toBe(false);
        expect(canApply(base({ prerequisites: [{ key: "community", ok: false }] }))).toBe(false);
    });

    it("counts only failed prerequisites as blockers, unknown ones not", () => {
        const ov = base({ prerequisites: [{ key: "community", ok: null }, { key: "roleOrder", ok: false, roles: ["Mod"] }] });
        expect(blockers(ov).map((p) => p.key)).toEqual(["roleOrder"]);
        expect(blockers(null)).toEqual([]);
        expect(canApply(base({ prerequisites: [{ key: "community", ok: null }] }))).toBe(true);
    });

    it("knows a server without a PuG category", () => {
        expect(hasPug(base())).toBe(true);
        expect(hasPug(base({ pugCategories: undefined }))).toBe(false);
        expect(hasPug(null)).toBe(false);
    });

    it("groups the preview: new and changed roles, open categories, own and foreign questions", () => {
        const ov = base({
            roles: [role("version:tbc", "new", "TBC"), role("class:mage", "changed", "Mage"), role("class:rogue", "same", "Rogue")],
            prompts: [
                prompt("versions", "changed", [{ title: "TBC", roleKey: "version:tbc", status: "same", id: "o1" }, { title: "Alt", roleKey: "", status: "lost", id: "o2" }]),
                prompt("classes", "same"),
                prompt("", "lost"),
            ],
        });
        const p = previewOf(ov);
        expect(p.newRoles.map((r) => r.name)).toEqual(["TBC"]);
        expect(p.changedRoles.map((r) => r.name)).toEqual(["Mage"]);
        expect(p.categories.map((c) => c.id)).toEqual(["c1"]);
        expect(p.prompts.map((x) => x.key)).toEqual(["versions"]);
        expect(p.lostPrompts.map((x) => x.title)).toEqual(["Fremd"]);
        expect(p.lostOptions.map((o) => o.title)).toEqual(["Alt"]);
    });

    it("names a role by its key and counts what an apply did", () => {
        expect(roleNameOf(base(), "version:tbc")).toBe("TBC");
        expect(roleNameOf(base(), "version:x")).toBe("version:x");
        expect(doneCount({ roles: 2, categories: 1, onboarding: true })).toBe(4);
        expect(doneCount({ roles: 0, categories: 0, onboarding: false })).toBe(0);
    });

    it("lists the table lines in natural order and sorts them by status and name", () => {
        const ov = base({ prompts: [prompt("versions", "new"), prompt("", "lost")] });
        const rows = rowsOf(ov);
        expect(rows.map((r) => r.id)).toEqual(["role:version:tbc", "role:class:mage", "prompt:versions", "prompt:lost:p1", "category:c1"]);
        expect(rows.map((r) => sortValueOf(r, "what"))).toEqual([0, 1, 2, 3, 4]);
        expect(rows.map((r) => sortValueOf(r, "status"))).toEqual([1, 3, 1, 0, 2]);
        expect(rows.map((r) => sortValueOf(r, "want"))).toEqual(["tbc", "mage", "versions", "", "tbc pugs"]);
        expect(rows.map((r) => sortValueOf(r, "have"))).toEqual(["", "", "", "fremd", 1]);
    });
});
