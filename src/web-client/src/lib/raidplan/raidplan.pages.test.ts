// The raid plan pages' logic parts: the raid mark icons, the placeholders of
// the texts and the section bar's labels. The board logic (lib/raidplan.ts)
// runs for real; the pages' structure is checked on the source in
// test/web-client/raidplan.pages.test.js.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as lib from ".";
import { t } from "../../i18n";
import { inLang } from "../../test/i18n";

// src/web-client/src/lib/raidplan -> src/web-client/src
const CLIENT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(CLIENT, rel), "utf8").replace(/\r\n/g, "\n");

describe("the pages", () => {
    it("uses the game's own raid mark icons, served from the client's public folder", () => {
        const icon = read("components/raidplan/MarkIcon.tsx");
        expect(icon).toContain("markUrl(mark)");
        expect(lib.markUrl("skull")).toBe("/raidmarks/skull.png");
        const dir = path.join(CLIENT, "..", "public", "raidmarks");
        for (const m of lib.RAID_MARKS) {
            const file = path.join(dir, `${m}.png`);
            expect(fs.existsSync(file)).toBe(true);
            // a real PNG, not an error page
            expect(fs.readFileSync(file).subarray(0, 4).toString("hex")).toBe("89504e47");
        }
    });
});

describe("the texts", () => {
    it("keeps the two languages' placeholders in step", async () => {
        const de = t;
        const en = (key: string, vars?: Record<string, string | number>) => inLang("en", () => t(key, vars));
        expect(de("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(await en("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(de("raidBoard.bar.savedDropped", { count: 2 })).toContain("2");
        expect(de("raidBoard.ctx.insertHere", { what: "Tank" })).toBe("Hier einfügen: Tank");
        expect(await en("raidBoard.ctx.insertHere", { what: "Tank" })).toBe("Insert here: Tank");
    });
});

describe("the section bar names every section (feature/raidplan-16)", () => {
    it("a boss by its name, Allgemein, and a trash section by its instance when the plan has several", () => {
        expect(lib.sectionLabel({ name: "Supremus" }, true)).toBe("Supremus");
        expect(lib.sectionLabel({ name: "x", general: true }, true)).toBe("Allgemein");
        expect(lib.sectionLabel({ name: "Trash", trash: true, instanceName: "Der Schwarze Tempel" }, true)).toBe("Trash · Der Schwarze Tempel");
        expect(lib.sectionLabel({ name: "Trash", trash: true, instanceName: "Der Schwarze Tempel" }, false)).toBe("Trash");
        expect(lib.severalInstances([{ key: "general", general: true }, { key: "bt/supremus" }, { key: "bt/trash" }])).toBe(false);
        expect(lib.severalInstances([{ key: "hyjal/archimonde" }, { key: "bt/supremus" }])).toBe(true);
        expect(lib.severalInstances([{ instanceId: "gruul" }, { instanceId: "bt" }])).toBe(true);
    });
});
