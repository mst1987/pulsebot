// The name and status vocabulary the Raid-Detail roster and the player dialog
// share (pages/raid-detail/meta.ts; #435: formerly source scans in
// test/web-client/attendanceNames.test.js and signupStatus.test.js).
import { describe, expect, it } from "vitest";
import type { AttendancePerson } from "../../api";
import { requireBackend } from "../../test/backend";
import { inLang } from "../../test/i18n";
import { SIGNUP_META, SIGNUP_ORDER, byLabel, personLabel, personRef } from "./meta";

const { SIGNUP_STATUSES } = requireBackend<{ SIGNUP_STATUSES: string[] }>("utils/attendance");

const person = (over: Partial<AttendancePerson>): AttendancePerson => ({ id: "111", displayName: "", profile: null, ...over });

describe("attendance names", () => {
    it("labels a person by their character name when one is known", () => {
        expect(personLabel(person({ displayName: "ahri_dc", character: "Ahri" }))).toBe("Ahri");
        expect(personLabel(person({ displayName: "ahri_dc" }))).toBe("ahri_dc");
        expect(personLabel(person({}))).toBe("111");
    });

    it("hands the player dialog the Discord name only beside a character", () => {
        expect(personRef(person({ displayName: "ahri_dc", character: "Ahri", status: "late" }))).toMatchObject({
            name: "Ahri", discordName: "ahri_dc", status: "late",
        });
        const bare = personRef(person({ displayName: "bob" }), "missing");
        expect(bare).toMatchObject({ name: "bob", status: "missing" });
        expect(bare.discordName).toBeUndefined();
    });

    it("sorts by the name actually shown", () => {
        const list = [person({ id: "1", displayName: "zed" }), person({ id: "2", displayName: "anna", character: "Mira" }), person({ id: "3", displayName: "bob" })];
        expect([...list].sort(byLabel).map(personLabel)).toEqual(["bob", "Mira", "zed"]);
    });
});

describe("signup status vocabulary", () => {
    it("knows every status the backend can send", () => {
        expect(Object.keys(SIGNUP_META).sort()).toEqual([...SIGNUP_STATUSES].sort());
        expect([...SIGNUP_ORDER].sort()).toEqual([...SIGNUP_STATUSES].sort());
        for (const status of SIGNUP_STATUSES) {
            const label = SIGNUP_META[status as keyof typeof SIGNUP_META].label;
            expect({ status, label: label && !label.startsWith("raidDetail.") }).toEqual({ status, label: true });
        }
    });

    it("gives signed, maybe and absent their badge tone", () => {
        expect(Object.fromEntries(SIGNUP_ORDER.map((s) => [s, SIGNUP_META[s].tone]))).toEqual({
            signed: "ok", tentative: "mid", late: "mid", bench: undefined, absence: "bad",
        });
        expect(["signed", "tentative", "late", "absence"].map((s) => SIGNUP_META[s as keyof typeof SIGNUP_META].label))
            .toEqual(["Angemeldet", "Unsicher", "Kommt später", "Abgemeldet"]);
    });

    it("orders the statuses from attending to absent", () => {
        expect(SIGNUP_ORDER).toEqual(["signed", "tentative", "late", "bench", "absence"]);
    });

    it("reads its labels in the active language", async () => {
        await inLang("en", () => {
            expect(SIGNUP_META.signed.label).not.toBe("Angemeldet");
        });
        expect(SIGNUP_META.signed.label).toBe("Angemeldet");
    });
});
