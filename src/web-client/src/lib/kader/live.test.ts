// Live in the Kaderplaner: an activity line as a sentence, the toast for the
// others' changes (one sentence, a summary, never one's own, a repeated edit
// once per two minutes), presence in words and the "inzwischen geändert" hint.
import { beforeEach, describe, expect, it } from "vitest";
import type { KaderActivityItem, KaderPresence } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { kader as kaderData, kaderView, ME, U } from "../../pages/kader/kader.fixture";
import { REPEAT_MS, activityText, changedSince, liveToast, presenceOn, presenceText, presenceTip } from "./live";

const view = kaderView({ names: { ...kaderView().names, [U.lead2]: "Lena" } });
const kader = kaderData();
const line = (over: Partial<KaderActivityItem>): KaderActivityItem => ({ rev: 10, at: "2026-10-01T19:49:00.000Z", by: U.lead2, type: "state", ...over });
const LENA_ON_LISS: KaderPresence = { userId: U.lead2, name: "Lena", sub: "vorauswahl", playerId: U.mage, what: "interview", edit: true };

beforeEach(async () => { await switchLang("de"); });

describe("lib/kader/live", () => {
    describe("activityText", () => {
        it("names who did what to whom", () => {
            expect(activityText(view, kader, line({ playerId: U.mage, from: "selected", to: "provisional" }))).toBe("Lena hat Liss ins vorläufige Roster geschoben");
            expect(activityText(view, kader, line({ count: 3, to: "selected" }))).toBe("Lena hat 3 Spieler in die Vorauswahl geschoben");
            expect(activityText(view, kader, line({ type: "interview", playerId: U.mage }))).toBe("Lena hat das Gespräch mit Liss bearbeitet");
            expect(activityText(view, kader, line({ type: "lead", playerId: U.mage, to: ME }))).toBe("Lena hat das Gespräch mit Liss an Admin gegeben");
            expect(activityText(view, kader, line({ type: "lead", playerId: U.mage, to: U.lead2 }))).toBe("Lena führt jetzt das Gespräch mit Liss");
            expect(activityText(view, kader, line({ type: "lead", playerId: U.mage }))).toBe("Lena hat die Gesprächsführung bei Liss entfernt");
            expect(activityText(view, kader, line({ type: "questions", questionId: "q2" }))).toBe("Lena hat die Frage „Im Voice-Chat aktiv?“ geändert");
            expect(activityText(view, kader, line({ type: "questions" }))).toBe("Lena hat die Fragen geändert");
            expect(activityText(view, kader, line({ type: "added", count: 12 }))).toBe("Lena hat 12 Spieler in den Pool übernommen");
        });

        it("speaks the menu language", async () => {
            await switchLang("en");
            expect(activityText(view, kader, line({ playerId: U.mage, from: "selected", to: "provisional" }))).toBe("Lena moved Liss to the provisional roster");
        });
    });

    describe("liveToast", () => {
        it("says one change as its sentence and several as a summary", () => {
            expect(liveToast(view, kader, [line({ playerId: U.mage, to: "provisional" })], ME, new Map())).toBe("Lena hat Liss ins vorläufige Roster geschoben");
            expect(liveToast(view, kader, [line({ rev: 11 }), line({ rev: 12, type: "vote", playerId: U.heal }), line({ rev: 13, type: "comment", playerId: U.heal })], ME, new Map()))
                .toBe("Lena hat 3 Änderungen gemacht");
            expect(liveToast(view, kader, [line({}), line({ by: U.tank, type: "vote", playerId: U.heal })], ME, new Map())).toBe("Lena und Aldric haben 2 Änderungen gemacht");
        });

        it("never toasts one's own changes", () => {
            expect(liveToast(view, kader, [line({ by: ME })], ME, new Map())).toBeNull();
        });

        it("says a repeated edit (somebody typing) once per two minutes", () => {
            const recent = new Map<string, number>();
            const typing = line({ type: "interview", playerId: U.mage });
            expect(liveToast(view, kader, [typing], ME, recent, 1000)).toBe("Lena hat das Gespräch mit Liss bearbeitet");
            expect(liveToast(view, kader, [{ ...typing, rev: 11 }], ME, recent, 1000 + 5000)).toBeNull();
            expect(liveToast(view, kader, [{ ...typing, rev: 12 }], ME, recent, 1000 + REPEAT_MS)).toBe("Lena hat das Gespräch mit Liss bearbeitet");
            // a move is no repetition: it always says so
            expect(liveToast(view, kader, [line({ playerId: U.mage, to: "provisional" })], ME, recent, 1000 + 5000)).not.toBeNull();
        });
    });

    describe("presence", () => {
        it("finds the others on a player and says what they do", () => {
            expect(presenceOn([LENA_ON_LISS], U.mage)).toEqual([LENA_ON_LISS]);
            expect(presenceOn([LENA_ON_LISS], U.mage, ["account"])).toEqual([]);
            expect(presenceOn([LENA_ON_LISS], "")).toEqual([]);
            expect(presenceText("Lena", LENA_ON_LISS)).toBe("Lena bearbeitet gerade dieses Gespräch");
            expect(presenceText("Lena", LENA_ON_LISS, true)).toBe("Lena bearbeitet gerade auch dieses Gespräch");
            expect(presenceText("Lena", { ...LENA_ON_LISS, edit: false })).toBe("Lena sieht sich dieses Gespräch gerade an");
            expect(presenceText("Lena", { ...LENA_ON_LISS, what: "drawer", edit: false })).toBe("Lena sieht sich die Diskussion gerade an");
            expect(presenceTip("Kurt", { ...LENA_ON_LISS, sub: "vorauswahl" })).toBe("Kurt · gerade in Gespräche");
        });
    });

    describe("changedSince", () => {
        it("finds the newest change by somebody else after a revision", () => {
            const k = kaderData({ activity: [line({ rev: 3, type: "settings" }), line({ rev: 5, type: "settings", by: ME }), line({ rev: 7, type: "vote" })] });
            expect(changedSince(k, 2, ME, ["settings"])).toMatchObject({ rev: 3, by: U.lead2 });
            expect(changedSince(k, 3, ME, ["settings"])).toBeNull();
            expect(changedSince(k, 0, ME, ["vote"], U.heal)).toBeNull();
            expect(t("kader.live.changed", { name: "Lena" })).toContain("Lena");
        });
    });
});
