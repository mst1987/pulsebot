// "Event anlegen" im Web (#261): the planning rules of the dialog
// (lib/eventPlan.ts on top of lib/raidTemplates.ts), run for real against the
// server's rules. The dialog itself is rendered in
// components/raid-create/RaidCreateDialog.test.tsx and RaidCreateDialog.plan.test.tsx.
import { describe, expect, it } from "vitest";
import * as eventPlan from "./eventPlan";
import * as raidTemplates from "./raidTemplates";
import { requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";

const { publicVersions } = requireBackend("config/gameVersions");
const { normalizePlan } = requireBackend("stores/eventStore");
const { renderChannelName } = requireBackend("utils/channelNames");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests hand the libs loose fixtures, as the Jest version did
const logic: any = { ...raidTemplates, ...eventPlan };
const versions = publicVersions();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (id: string) => versions.find((x: any) => x.id === id);

/** A plan in the server's input shape, the way planBody() sends it. */
const serverProblem = (plan: unknown) => normalizePlan(logic.planBody(plan)).error || "";

describe("Event anlegen: plan rules (client)", () => {
    it("walks Vorlage → Termin → Raid → Kanal & Anmeldung → Prüfen, the raid step only for EventHelper", async () => {
        expect(logic.stepsFor(false, "eventhelper")).toEqual(["start", "termin", "raid", "kanal", "check"]);
        expect(logic.stepsFor(false, "raidhelper")).toEqual(["start", "termin", "kanal", "check"]);
        // editing starts at the event itself
        expect(logic.stepsFor(true, "eventhelper")).toEqual(["termin", "raid", "kanal", "check"]);
        expect(logic.stepLabel("kanal")).toBe("Kanal & Anmeldung");
        expect(await inLang("en", () => logic.stepLabel("kanal"))).toBe("Channel & signups");
    });

    it("presets the source from the category", () => {
        expect(logic.sourceOf({ c1: "eventhelper" }, "c1")).toBe("eventhelper");
        expect(logic.sourceOf({ c1: "eventhelper" }, "c2")).toBe("raidhelper");
        expect(logic.sourceOf(undefined, "c1")).toBe("raidhelper");
    });

    it("takes size, tanks, healers, ranges and buffs from a raid template", () => {
        const t = {
            id: "t5", name: "SSC + TK", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
            composition: { tank: 4, healer: 7, melee: { min: 6, max: 8 }, ranged: null },
            requiredBuffs: ["windfury"], signupDeadline: { hoursBefore: 24 }, fairness: true, wishes: false, raidhelperTemplateId: "",
        };
        expect(logic.planFromTemplate(t, v("tbc"))).toMatchObject({
            raidTemplateId: "t5", instanceIds: ["ssc", "tk"], size: 25, tank: 4, healer: 7,
            melee: { min: 6, max: 8 }, ranged: null, requiredBuffs: ["windfury"], deadlineHours: 24, fairness: true,
        });
        // a migrated template without size gets its instances' default and the rule set's suggestion
        const migrated = logic.planFromTemplate({ ...t, size: null, composition: { tank: 0, healer: 0, melee: null, ranged: null } }, v("tbc"));
        const suggestion = logic.proposeComposition(v("tbc"), ["ssc", "tk"], 25);
        expect(migrated).toMatchObject({ size: 25, tank: suggestion.tank, healer: suggestion.healer });
        expect(suggestion.tank).toBeGreaterThan(0);
    });

    it("changing the plan for one event leaves the template object alone", () => {
        const t = {
            id: "t1", name: "Kara", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
            fairness: false, wishes: false, raidhelperTemplateId: "",
        };
        const before = JSON.stringify(t);
        const plan = logic.planFromTemplate(t, v("tbc"));
        const changed = logic.withInstance(logic.withSize(plan, v("tbc"), 25), v("tbc"), "gruul");
        changed.requiredBuffs.push("kings");
        changed.instanceIds.push("mag");
        expect(JSON.stringify(t)).toBe(before);
    });

    it("proposes tanks and healers on a size change, and a new instance brings its own size", () => {
        const plan = logic.planFromTemplate({
            id: "k", versionId: "tbc", instanceIds: ["kara"], size: 10, composition: { tank: 1, healer: 2, melee: null, ranged: null },
            requiredBuffs: [], signupDeadline: null,
        }, v("tbc"));
        expect(logic.withSize(plan, v("tbc"), 25)).toMatchObject({ size: 25, tank: 3, healer: 6 });
        // Gruul only comes in 25: adding it to a 10-player Kara night moves to 25
        expect(logic.withInstance(plan, v("tbc"), "gruul")).toMatchObject({ instanceIds: ["kara", "gruul"], size: 25 });
        // removing an instance whose size still fits keeps the numbers
        expect(logic.withInstance({ ...plan, instanceIds: ["kara", "za"] }, v("tbc"), "za")).toMatchObject({ size: 10, tank: 1 });
    });

    it("a version change drops instances and buffs, keeps the switches", () => {
        const plan = { ...logic.emptyPlan(v("tbc")), instanceIds: ["ssc"], requiredBuffs: ["windfury"], fairness: true, deadlineHours: 12 };
        expect(logic.withVersion(plan, v("classic"))).toMatchObject({ versionId: "classic", instanceIds: [], requiredBuffs: [], fairness: true, deadlineHours: 12 });
    });

    it("validates sum against size and the ranges exactly like the server", () => {
        const base = { ...logic.emptyPlan(v("tbc")), size: 10, tank: 2, healer: 3 };
        const cases = [
            base,
            { ...base, tank: 5, healer: 6 },
            { ...base, melee: { min: 3, max: 2 } },
            { ...base, ranged: { min: 1, max: 12 } },
            { ...base, melee: { min: 3, max: null }, ranged: { min: 3, max: null } },
            { ...base, melee: { min: 2, max: 9 }, ranged: { min: 2, max: 9 } },
            { ...base, size: 41 },
            { ...base, size: 0 },
        ];
        for (const plan of cases) {
            expect({ plan, msg: logic.planProblem(plan) }).toEqual({ plan, msg: serverProblem(plan) });
        }
        expect(logic.planProblem(base)).toBe("");
        expect(logic.planProblem({ ...base, tank: 5, healer: 6 })).toMatch(/größer als der Raid/);
        expect(logic.plannedSeats({ ...base, melee: { min: 2, max: 4 } })).toBe(7);
    });

    it("prefills the edit mode from a stored event", () => {
        const ev = {
            id: "eh-1", versionId: "tbc", instanceIds: ["bt"], size: 25, startTime: 2000000000, signupDeadline: 2000000000 - 48 * 3600,
            composition: { tank: 3, healer: 7, melee: 5, ranged: 0 }, compositionMax: { melee: 8, ranged: null },
            requiredBuffs: ["kings"], raidTemplateId: "tpl", fairness: false, wishes: true, autoSuggest: true,
        };
        expect(logic.planFromEvent(ev)).toEqual({
            raidTemplateId: "tpl", versionId: "tbc", instanceIds: ["bt"], size: 25, tank: 3, healer: 7,
            melee: { min: 5, max: 8 }, ranged: null, requiredBuffs: ["kings"], deadlineHours: 48, durationMinutes: 180,
            fairness: false, wishes: true, autoSuggest: true, overflow: "bench", lockAtLimit: false,
            color: "", image: { mode: "thumbnail", url: "" }, emojiStyle: "arcane",
        });
        // the event's own duration wins over the default (#305)
        expect(logic.planFromEvent({ ...ev, durationMinutes: 240 }).durationMinutes).toBe(240);
        // #306: was das Event gespeichert hat, steht auch im Entwurf.
        expect(logic.planFromEvent({ ...ev, overflow: "off", lockAtLimit: true }))
            .toMatchObject({ overflow: "off", lockAtLimit: true });
    });

    it("trägt die Warteliste durch Vorlage, Versionswechsel und Prüfen-Zeile (#306)", () => {
        const t = {
            id: "t1", name: "Kara", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
            fairness: false, wishes: false, overflow: "off", lockAtLimit: true, raidhelperTemplateId: "",
        };
        const plan = logic.planFromTemplate(t, v("tbc"));
        expect(plan).toMatchObject({ overflow: "off", lockAtLimit: true });
        expect(logic.withVersion(plan, v("classic"))).toMatchObject({ overflow: "off", lockAtLimit: true });
        expect(logic.overflowLine(plan)).toBe("voll: keine Anmeldung mehr · Anmeldung schließt bei Voll");
        expect(logic.overflowLine(logic.emptyPlan(v("tbc")))).toBe("voll: Warteliste (Bank)");
        // und der Server nimmt die Vorlage so an
        const server = requireBackend("services/events/raidTemplates");
        const saved = logic.templateFromPlan(plan, null, "Kara");
        expect(server.validateTemplate(server.normalizeTemplate(saved))).toBe("");
        expect(server.normalizeTemplate(saved)).toMatchObject({ overflow: "off", lockAtLimit: true });
    });

    it("sends the plan in the shape POST/PATCH /api/raids take", () => {
        const plan = { ...logic.emptyPlan(v("tbc")), raidTemplateId: "t", instanceIds: ["ssc"], melee: { min: 4, max: 6 }, deadlineHours: 3 };
        expect(logic.planBody(plan)).toEqual({
            raidTemplateId: "t", versionId: "tbc", instanceIds: ["ssc"], size: 25,
            composition: { tank: 3, healer: 6, melee: { min: 4, max: 6 }, ranged: null },
            requiredBuffs: [], durationMinutes: 180, signupDeadlineHours: 3, fairness: false, wishes: false, autoSuggest: false,
            overflow: "bench", lockAtLimit: false, color: "", image: { mode: "thumbnail", url: "" }, emojiStyle: "arcane",
        });
    });

    it("trägt Farbe und Bild von der Vorlage ins Event und wortgleich zum Server (#307)", () => {
        const t = {
            id: "t1", name: "SSC", versionId: "tbc", instanceIds: ["ssc"], size: 25,
            composition: { tank: 3, healer: 7, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
            fairness: false, wishes: false, raidhelperTemplateId: "",
            color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" },
        };
        const plan = logic.planFromTemplate(t, v("tbc"));
        expect(plan).toMatchObject({ color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" } });
        // ein Versionswechsel hängt nicht am Aussehen
        expect(logic.withVersion(plan, v("classic"))).toMatchObject({ color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" } });
        // und beides geht so zum Server und zurück in eine Vorlage
        expect(logic.planBody(plan)).toMatchObject({ color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" } });
        const server = requireBackend("services/events/raidTemplates");
        const saved = logic.templateFromPlan(plan, null, "SSC");
        expect(server.validateTemplate(server.normalizeTemplate(saved), saved)).toBe("");
        expect(server.normalizeTemplate(saved)).toMatchObject({ color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/a.png" } });
        // eine Vorlage von vor #307 bringt leere Felder mit
        expect(logic.planFromTemplate({ ...t, color: undefined, image: undefined }, v("tbc")))
            .toMatchObject({ color: "", image: { mode: "thumbnail", url: "" } });
    });

    it("wortet eine kaputte Farbe oder Bild-Adresse wie der Server (#307)", () => {
        const base = { ...logic.emptyPlan(v("tbc")), size: 10, tank: 2, healer: 3 };
        const cases = [
            { color: "rot" }, { color: "#abc" }, { color: "#1f8ba5" }, { color: "" },
            { image: { mode: "banner", url: "http://x/y.png" } },
            { image: { mode: "banner", url: "https://x/y.png" } },
            { image: { mode: "gross", url: "https://x/y.png" } },
        ];
        for (const over of cases) {
            const plan = { ...base, ...over };
            expect({ over, msg: logic.planProblem(plan) }).toEqual({ over, msg: serverProblem(plan) });
        }
    });

    it("words a duration outside 30–600 minutes exactly like the server (#305)", () => {
        const base = { ...logic.emptyPlan(v("tbc")), size: 10, tank: 2, healer: 3 };
        for (const durationMinutes of [180, 30, 600, 29, 601, 0]) {
            const plan = { ...base, durationMinutes };
            expect({ durationMinutes, msg: logic.planProblem(plan) }).toEqual({ durationMinutes, msg: serverProblem(plan) });
        }
    });

    it("Als Vorlage speichern: a new template, or an update that keeps id and Raid-Helper link", () => {
        const plan = { ...logic.emptyPlan(v("tbc")), instanceIds: ["hyjal", "bt"], deadlineHours: 24, requiredBuffs: ["kings"] };
        const fresh = logic.templateFromPlan(plan, null, "  T6 25er ");
        expect(fresh).toEqual({
            name: "T6 25er", versionId: "tbc", instanceIds: ["hyjal", "bt"], size: 25,
            composition: { tank: 3, healer: 6, melee: null, ranged: null }, requiredBuffs: ["kings"],
            signupDeadline: { hoursBefore: 24 }, durationMinutes: 180, fairness: false, wishes: false,
            overflow: "bench", lockAtLimit: false, color: "", image: { mode: "thumbnail", url: "" }, emojiStyle: "arcane", raidhelperTemplateId: "",
        });
        expect(fresh.id).toBeUndefined();
        const base = { id: "tpl-1", name: "Alt", raidhelperTemplateId: "rh-3" };
        expect(logic.templateFromPlan(plan, base, "")).toMatchObject({ id: "tpl-1", name: "Alt", raidhelperTemplateId: "rh-3", instanceIds: ["hyjal", "bt"] });
        // and it passes the server's template rules
        const server = requireBackend("services/events/raidTemplates");
        expect(server.validateTemplate(server.normalizeTemplate(fresh))).toBe("");
    });

    it("names a new channel by the category's schema exactly like the server", () => {
        const cases = [
            ["{tag}-{dd}-{mm}-{raid}", "2026-09-24", ["ssc", "tk"], ""],
            ["{raid}-{dd}-{mm}", "2026-10-01", [], "t5"],
            ["Raid {yyyy}/{mm}/{dd} {raid}", "2026-02-28", ["kara"], ""],
            ["🔥・{tag}-{dd}-{mon}-{raid}", "2026-10-07", ["bt"], ""],
            ["{tag}-{yy}-{unknown}-{raid}", "2026-13-40", ["bt"], ""],
            ["", "2026-09-24", [], ""],
        ];
        for (const [schema, date, ids, fallback] of cases) {
            const raid = logic.raidTag(v("tbc"), ids, fallback);
            expect({ schema, date, name: logic.schemaName(schema, date, raid) })
                .toEqual({ schema, date, name: renderChannelName(schema || undefined, { date, raid }) });
        }
        expect(logic.schemaName("{tag}-{dd}-{mm}-{raid}", "2026-09-24", "ssc-tk")).toBe("do-24-09-ssc-tk");
        // "{raid}": the instances' short names like the server's raidTagOf (test/services/events/eventCreate.test.js), else the schema's own
        expect(logic.raidTag(v("tbc"), ["ssc", "tk"], "t5")).toBe("ssc-tk");
        expect(logic.raidTag(v("tbc"), [], "t5")).toBe("t5");
    });
});
