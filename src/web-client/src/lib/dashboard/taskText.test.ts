import { afterEach, describe, expect, it } from "vitest";
import { switchLang } from "../../test/i18n";
import { taskText } from "./taskText";

afterEach(() => switchLang("de"));

describe("taskText", () => {
    it("words a task in the reader's language from its key and params", async () => {
        const task = { texts: { title: { key: "recommendations.title" }, tip: { key: "recommendations.tip", params: { count: 7 } } } };
        expect(taskText(task, "title", "Empfehlungen prüfen")).toBe("Empfehlungen prüfen");
        expect(taskText(task, "tip", "x")).toBe("7 Empfehlungen ungeprüft");
        await switchLang("en");
        expect(taskText(task, "title", "Empfehlungen prüfen")).toBe("Review recommendations");
        expect(taskText(task, "tip", "x")).toBe("7 recommendations not reviewed");
    });

    it("joins pieces: the reference line with a dot, the title with a space", async () => {
        await switchLang("en");
        const task = {
            texts: {
                ref: [{ key: "inbox.sessions", params: { count: 25 } }, { key: "inbox.items", params: { count: 1 } }],
                title: [{ key: "deploy.title", params: { count: 2 } }, { key: "deploy.since", params: { count: 3 } }],
            },
        };
        expect(taskText(task, "ref", "25 Sitzungen · 870 Items")).toBe("25 sessions · 1 item");
        expect(taskText(task, "title", "x")).toBe("Server is 2 commits behind main (for 3 days)");
    });

    it("keeps a raw text, formats a date, and falls back to the German text for an unknown key or no texts", () => {
        expect(taskText({ texts: { tip: { text: "Event: fehlende Rechte" } } }, "tip", "x")).toBe("Event: fehlende Rechte");
        expect(taskText({ texts: { tip: { key: "trial.tip", params: { date: Date.UTC(2026, 9, 12, 12) } } } }, "tip", "x")).toBe("Die Probezeit endet am 12.10.");
        expect(taskText({ texts: { title: { key: "nope.title" } } }, "title", "Server-Text")).toBe("Server-Text");
        expect(taskText({ texts: { ref: [{ key: "inbox.sessions", params: { count: 1 } }, { key: "nope" }] } }, "ref", "Server-Text")).toBe("Server-Text");
        expect(taskText({}, "title", "Server-Text")).toBe("Server-Text");
    });
});
