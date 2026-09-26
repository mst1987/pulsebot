// Tactic profiles of the raid plan (src/stores/raidplanProfileStore.js).
const { tempStoreFile } = require("../helpers/tempStore");
const profiles = require("../../src/stores/raidplanProfileStore");

beforeEach(() => profiles.useFile(tempStoreFile("raidplan-profiles.json")));
afterAll(() => profiles.useFile());

describe("profiles", () => {
    it("ships nothing and starts empty", () => {
        expect(profiles.listProfiles()).toEqual([]);
        expect(profiles.categories()).toEqual([]);
    });

    it("creates a profile with rows and keeps only the row titles", () => {
        const r = profiles.createProfile({
            name: "  Tanks P1 ", category: " Tank ", bossKey: "bt/supremus",
            targets: [{ title: "Main-Tank", userIds: ["u1"] }, { title: "  " }, "Off-Tank"], notes: "n",
        });
        expect(r.profile).toMatchObject({ name: "Tanks P1", category: "Tank", bossKey: "bt/supremus", notes: "n" });
        expect(r.profile.targets).toEqual([{ title: "Main-Tank" }, { title: "Off-Tank" }]);
        expect(r.profile.id).toMatch(/^[0-9a-f]{12}$/);
        expect(profiles.getProfile(r.profile.id)).toEqual(r.profile);
    });

    it("needs a name and refuses bad fields", () => {
        expect(profiles.createProfile({ name: "  " }).code).toBe("invalid");
        expect(profiles.createProfile({}).code).toBe("invalid");
        expect(profiles.createProfile({ name: "x".repeat(41) }).code).toBe("invalid");
        expect(profiles.createProfile({ name: "a", category: "c".repeat(31) }).code).toBe("invalid");
        expect(profiles.createProfile({ name: "a", bossKey: "bt/nobody" }).code).toBe("invalid");
        expect(profiles.createProfile({ name: "a", targets: "rows" }).code).toBe("invalid");
        expect(profiles.createProfile({ name: "a", targets: Array.from({ length: 31 }, () => ({ title: "t" })) }).code).toBe("invalid");
        expect(profiles.createProfile({ name: "a", notes: "n".repeat(1001) }).code).toBe("invalid");
        expect(profiles.listProfiles()).toEqual([]);
    });

    it("takes a whole instance or no boss (every boss) as scope", () => {
        expect(profiles.createProfile({ name: "a", bossKey: "bt" }).profile.bossKey).toBe("bt");
        expect(profiles.createProfile({ name: "b" }).profile.bossKey).toBe("");
    });

    it("lists by category, then name, and offers the categories in use", () => {
        profiles.createProfile({ name: "Zeta", category: "Heiler" });
        profiles.createProfile({ name: "Alpha", category: "Tank" });
        profiles.createProfile({ name: "Beta", category: "Heiler" });
        profiles.createProfile({ name: "Ohne" });
        expect(profiles.listProfiles().map((p) => p.name)).toEqual(["Ohne", "Beta", "Zeta", "Alpha"]);
        expect(profiles.categories()).toEqual(["Heiler", "Tank"]);
    });

    it("renames and changes a profile without touching the other fields", () => {
        const { profile } = profiles.createProfile({ name: "Alt", category: "Tank", targets: [{ title: "MT" }] });
        const r = profiles.updateProfile(profile.id, { name: "Neu" }, { now: 5 });
        expect(r.profile).toMatchObject({ id: profile.id, name: "Neu", category: "Tank", targets: [{ title: "MT" }], updatedAt: 5 });
        expect(profiles.updateProfile(profile.id, { category: "" }).profile.category).toBe("");
        expect(profiles.updateProfile(profile.id, { name: "" }).code).toBe("invalid");
        expect(profiles.updateProfile("nope", { name: "x" }).code).toBe("not_found");
        expect(profiles.getProfile(profile.id).name).toBe("Neu");
    });

    it("deletes a profile", () => {
        const { profile } = profiles.createProfile({ name: "Weg" });
        expect(profiles.deleteProfile(profile.id)).toBe(true);
        expect(profiles.deleteProfile(profile.id)).toBe(false);
        expect(profiles.getProfile(profile.id)).toBeNull();
        expect(profiles.getProfile("")).toBeNull();
    });

    it("stops at 200 profiles", () => {
        for (let i = 0; i < profiles.LIMITS.profiles; i += 1) expect(profiles.createProfile({ name: `p${i}` }).profile).toBeTruthy();
        expect(profiles.createProfile({ name: "one too many" }).code).toBe("invalid");
    });
});
