const {
    NEW_APPLICATION_DAYS, SPEC_ICONS, splitClassSpec, applicationStatus, annotateApplication,
} = require("../../src/web/recruitmentApplications");
const { CLASSES } = require("../../src/config/applyClasses");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 14, 12);

describe("web/recruitmentApplications", () => {
    describe("splitClassSpec", () => {
        it("splits the embed's class and spec at the dash", () => {
            expect(splitClassSpec("Druid – Balance")).toMatchObject({ cls: { value: "druid" }, spec: "Balance" });
            expect(splitClassSpec("Hunter - Beast Mastery")).toMatchObject({ cls: { value: "hunter" }, spec: "Beast Mastery" });
        });

        it("knows a class without a spec", () => {
            expect(splitClassSpec("Mage")).toMatchObject({ cls: { value: "mage" }, spec: "" });
        });

        it("keeps unknown text as the spec instead of dropping it", () => {
            expect(splitClassSpec("Death Knight – Blood")).toEqual({ cls: null, spec: "Death Knight – Blood" });
            expect(splitClassSpec("Unbekannt")).toEqual({ cls: null, spec: "" });
            expect(splitClassSpec("")).toEqual({ cls: null, spec: "" });
        });
    });

    describe("applicationStatus", () => {
        it("calls an archived thread archiviert, whatever its age", () => {
            expect(applicationStatus({ archived: true, createdAt: NOW }, NOW)).toBe("archiviert");
        });

        it("calls a recent one neu and an older one offen", () => {
            expect(applicationStatus({ createdAt: NOW - DAY }, NOW)).toBe("neu");
            expect(applicationStatus({ createdAt: NOW - (NEW_APPLICATION_DAYS * DAY) - 1 }, NOW)).toBe("offen");
        });

        it("does not call an application without a date neu", () => {
            expect(applicationStatus({ createdAt: 0 }, NOW)).toBe("offen");
        });
    });

    describe("annotateApplication", () => {
        it("adds class colour, icons and status and keeps the original fields", () => {
            const out = annotateApplication({ threadId: "t1", classSpec: "Shaman – Restoration", createdAt: NOW, archived: false }, NOW);
            expect(out).toEqual({
                threadId: "t1", classSpec: "Shaman – Restoration", createdAt: NOW, archived: false,
                className: "Shaman", spec: "Restoration", classColor: expect.stringMatching(/^#/),
                classIcon: "classicon_shaman", specIcon: "spell_nature_magicimmunity", status: "neu",
            });
        });

        it("leaves the class fields empty for an unknown class", () => {
            const out = annotateApplication({ classSpec: "", createdAt: 0 }, NOW);
            expect(out).toMatchObject({ className: "", classColor: "", classIcon: "", specIcon: "" });
        });
    });

    it("has an icon for every spec the application flow offers", () => {
        for (const cls of CLASSES) {
            for (const spec of cls.specs) expect({ cls: cls.value, spec, icon: SPEC_ICONS[cls.value][spec] }).toEqual({ cls: cls.value, spec, icon: expect.any(String) });
        }
    });
});
