// The menu's deploy line (#314): lib/deployVersion.ts run for real. The scan
// that the Shell keeps it to one quiet line stays in
// test/web-client/deployVersion.test.js.
import { describe, expect, it } from "vitest";
import { deployLine, shortDay, daysAgo, reasonText, type DeployVersion } from "./deployVersion";
import { inLang } from "../test/i18n";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const base = (over: Record<string, unknown> = {}) => ({
    commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    short: "a1b2c3d",
    committedAt: "2026-09-12T10:00:00Z",
    subject: "Farbe und Bild je Raid-Vorlage",
    startedAt: "2026-09-12T10:05:00Z",
    behind: 0, behindSince: "", latest: null, status: "current", reason: "", checkedAt: "2026-09-20T11:55:00Z",
    ...over,
}) as unknown as DeployVersion;

describe("web-client/lib/deployVersion", () => {
    it("formats a day the German way", () => {
        expect(shortDay("2026-09-12T10:00:00Z")).toBe("12.09.");
        expect(shortDay("")).toBe("");
        expect(shortDay("nonsense")).toBe("");
    });

    it("counts whole days", () => {
        expect(daysAgo("2026-09-14T12:00:00Z", NOW)).toBe(6);
        expect(daysAgo("2026-09-20T09:00:00Z", NOW)).toBe(0);
        expect(daysAgo("", NOW)).toBe(0);
    });

    it("says which commit runs and that it is current", () => {
        const line = deployLine(base(), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · aktuell mit main");
        expect(line.tone).toBe("ok");
    });

    it("says how far behind main it is", () => {
        const line = deployLine(base({ status: "behind", behind: 9, behindSince: "2026-09-14T12:00:00Z", latest: { short: "9f8e7d6" } }), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · main ist 9 Commits weiter");
        expect(line.tone).toBe("mid");
        expect(line.tipSub).toContain("9 Commits hinter main");
        expect(line.tipSub).toContain("seit 6 Tagen");
        expect(line.tipSub).toContain("main auf 9f8e7d6");
    });

    it("turns red once the backlog is a week old", () => {
        const week = base({ status: "behind", behind: 20, behindSince: "2026-09-13T11:00:00Z" });
        expect(deployLine(week, NOW).tone).toBe("bad");
        expect(deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-19T11:00:00Z" }), NOW).tone).toBe("mid");
    });

    it("uses the singular for one commit", () => {
        const line = deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-20T10:00:00Z" }), NOW);
        expect(line.text).toContain("main ist 1 Commit weiter");
    });

    it("says 'nicht prüfbar' instead of an error when the comparison failed", () => {
        const line = deployLine(base({ status: "unknown", reason: "unreachable" }), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · Abstand zu main nicht prüfbar");
        expect(line.tone).toBe("muted");
        expect(line.tipSub).toContain("GitHub war nicht erreichbar");
    });

    it("copes with a process that does not know its own commit", () => {
        const line = deployLine(base({ short: "", commit: "", committedAt: "", status: "unknown", reason: "no_commit" }), NOW);
        expect(line.text).toBe("Server-Stand unbekannt · Abstand zu main nicht prüfbar");
        expect(line.tipSub).toContain("GIT_COMMIT");
    });

    it("leaves the day out when git gave no commit date (GIT_COMMIT fallback)", () => {
        expect(deployLine(base({ committedAt: "", subject: "" }), NOW).text).toBe("Server läuft auf a1b2c3d · aktuell mit main");
    });

    it("renders nothing at all without data", () => {
        expect(deployLine(null, NOW).text).toBe("");
    });

    it("explains every reason in one sentence", () => {
        for (const reason of ["no_commit", "not_found", "unreachable", ""]) {
            expect(reasonText(reason).length).toBeGreaterThan(20);
        }
        expect(reasonText("not_found")).toContain("100 Commits");
    });

    it("speaks English when the menu does", async () => {
        await inLang("en", () => {
            expect(shortDay("2026-09-12T10:00:00Z")).toBe("12/09");
            const line = deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-14T12:00:00Z" }), NOW);
            expect(line.text).toBe("Server runs a1b2c3d from 12/09 · main is 1 commit ahead");
            expect(line.tipSub).toContain("1 commit behind main (for 6 days)");
        });
    });
});
