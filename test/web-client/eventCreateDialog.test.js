// "Event anlegen" im Web (#261): the planning rules of the dialog
// (src/web-client/src/lib/eventPlan.ts), run for real against the server's
// rules, and the dialog's layout decisions, checked on the source — the client
// is TSX without a React renderer here.
//
// eventPlan.ts builds on lib/raidTemplates.ts; both are written strippable, and
// this loader concatenates them after removing exactly the syntax they may use
// (imports, `export type` blocks, the annotations of a one-line signature).
const fs = require("fs");
const path = require("path");
const { publicVersions } = require("../../src/config/gameVersions");
const { normalizePlan } = require("../../src/web/eventStore");
const { renderChannelName } = require("../../src/utils/channelNames");
const { makeT } = require("./i18nHelper");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function strip(source) {
    const lines = source.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import /.test(line)) continue;
        if (/^export type /.test(line)) {
            let depth = 0;
            for (; i < lines.length; i++) {
                for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
                if (depth === 0 && /;\s*$/.test(lines[i])) break;
            }
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    return out.join("\n");
}

// Both libs import `t` (the menu language); German keeps the server's wording.
function load(lang = "de") {
    const js = `${strip(read("lib", "raidTemplates.ts"))}\n${strip(read("lib", "eventPlan.ts"))}`;
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function("t", `${js}\nreturn { ${names.join(", ")} };`)(makeT(lang));
}

const logic = load();
const versions = publicVersions();
const v = (id) => versions.find((x) => x.id === id);

/** A plan in the server's input shape, the way planBody() sends it. */
const serverProblem = (plan) => normalizePlan(logic.planBody(plan)).error || "";

describe("Event anlegen: plan rules (client)", () => {
    it("walks Vorlage → Termin → Raid → Kanal & Anmeldung → Prüfen, the raid step only for EventHelper", () => {
        expect(logic.stepsFor(false, "eventhelper")).toEqual(["start", "termin", "raid", "kanal", "check"]);
        expect(logic.stepsFor(false, "raidhelper")).toEqual(["start", "termin", "kanal", "check"]);
        // editing starts at the event itself
        expect(logic.stepsFor(true, "eventhelper")).toEqual(["termin", "raid", "kanal", "check"]);
        expect(logic.stepLabel("kanal")).toBe("Kanal & Anmeldung");
        expect(load("en").stepLabel("kanal")).toBe("Channel & signups");
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
            color: "", image: { mode: "thumbnail", url: "" },
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
        const server = require("../../src/web/raidTemplates");
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
            overflow: "bench", lockAtLimit: false, color: "", image: { mode: "thumbnail", url: "" },
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
        const server = require("../../src/web/raidTemplates");
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
            overflow: "bench", lockAtLimit: false, color: "", image: { mode: "thumbnail", url: "" }, raidhelperTemplateId: "",
        });
        expect(fresh.id).toBeUndefined();
        const base = { id: "tpl-1", name: "Alt", raidhelperTemplateId: "rh-3" };
        expect(logic.templateFromPlan(plan, base, "")).toMatchObject({ id: "tpl-1", name: "Alt", raidhelperTemplateId: "rh-3", instanceIds: ["hyjal", "bt"] });
        // and it passes the server's template rules
        const server = require("../../src/web/raidTemplates");
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
        // "{raid}": the instances' short names like the server's raidTagOf (test/web/eventCreate.test.js), else the schema's own
        expect(logic.raidTag(v("tbc"), ["ssc", "tk"], "t5")).toBe("ssc-tk");
        expect(logic.raidTag(v("tbc"), [], "t5")).toBe("t5");
    });
});

describe("Event anlegen: dialog", () => {
    const dialog = read("components", "RaidCreateDialog.tsx");
    const fields = read("components", "RaidPlanFields.tsx");
    const detail = read("pages", "RaidDetailPage.tsx");
    const hero = read("pages", "raid-detail", "RaidDetailHero.tsx");

    it("shows one step at a time and puts the planning step only where EventHelper plans", () => {
        expect(dialog).toContain("const steps = stepsFor(editing, source);");
        expect(dialog).toContain("<Stepper steps={steps} current={step} />");
        for (const s of ["start", "termin", "raid", "kanal"]) expect(dialog).toContain(`step === "${s}"`);
    });

    it("keeps the raid step calm: size and tanks/healers first, ranges, buffs and switches behind Mehr", () => {
        const raid = dialog.slice(dialog.indexOf("step === \"raid\""), dialog.indexOf("step === \"kanal\""));
        const more = raid.indexOf("<details className=\"rt-more\">");
        expect(more).toBeGreaterThan(raid.indexOf("<CompositionEditor"));
        expect(raid.indexOf("<SizePicker")).toBeLessThan(raid.indexOf("<CompositionEditor"));
        for (const later of ["<AppearanceFields", "<RoleRanges", "<BuffPicker", "raidCreate.raid.fairness", "raidCreate.raid.wishes", "raidCreate.raid.autoSuggest"]) {
            expect({ later, afterMore: raid.indexOf(later) > more }).toEqual({ later, afterMore: true });
        }
        // the sum check is one badge, not a paragraph
        expect(raid).toContain("t(\"raidCreate.raid.planned\", { planned: plannedSeats(plan), size: plan.size })}</Badge>");
    });

    it("offers instances as icon chips from the rule set with the Infos-fehlen badge, sizes as a segment with frei", () => {
        expect(fields).toContain("className={`rt-inst${on ? \" on\" : \"\"}`}");
        expect(fields).toContain("{t(\"raidPlan.fields.incomplete\")}</Badge>");
        expect(fields).toContain("{ value: FREE, label: t(\"raidPlan.fields.free\") }");
    });

    it("starts from the last events, a raid template or empty", () => {
        expect(dialog).toContain("{ value: \"events\", label: t(\"raidCreate.start.tabEvents\") }, { value: \"templates\", label: t(\"raidCreate.templatesLink\") }");
        expect(dialog).toContain("applyChoice(ctx, { kind: \"template\", id: tpl.id })");
        expect(dialog).toContain("title={t(\"raidCreate.start.empty\")}");
        // ?source= still jumps past the start step
        expect(dialog).toMatch(/applyChoice\(data, \{ kind: "event", id: sourceId \}\);\s+setStep\("termin"\);/);
    });

    it("sets channel by schema, deadline and source in Kanal & Anmeldung, the source preset from the category", () => {
        const kanal = dialog.slice(dialog.indexOf("step === \"kanal\""));
        expect(kanal).toContain("label: t(\"raidCreate.kanal.modeNew\")");
        expect(kanal).toContain("ariaLabel={t(\"raidCreate.kanal.source\")}");
        expect(kanal).toContain("id=\"re-deadline\"");
        expect(dialog).toContain("setSource(sourceOf(data.signupSources, catId));");
        expect(dialog).toContain("schemaName(schema?.schema || ctx?.defaultSchema || \"\", date, raidTag(");
        // a Raid-Helper event keeps today's template select
        expect(kanal).toContain("value={tpl.raidhelperTemplateId}");
    });

    // #305: the duration small beside the time, the voice channel in Kanal & Anmeldung
    it("puts the duration next to the time and the voice channel into Kanal & Anmeldung", () => {
        const termin = dialog.slice(dialog.indexOf("step === \"termin\""), dialog.indexOf("step === \"raid\""));
        expect(termin).toContain("id=\"re-time\"");
        expect(termin).toContain("aria-label={t(\"raidCreate.termin.durationAria\")}");
        expect(termin).toContain("durationMinutes: Math.floor(Number(e.target.value) || 0)");
        // the end follows from it and is shown small, not as a second field
        expect(termin).toContain("t(\"raidCreate.termin.end\", { time: endPreview.time })");
        const kanal = dialog.slice(dialog.indexOf("step === \"kanal\""));
        expect(kanal).toContain("id=\"re-voice\"");
        expect(kanal).toContain("text={t(\"raidCreate.kanal.voice\")}");
        // preset from the category until it is picked by hand
        expect(dialog).toContain("if (!voiceTouched) setVoiceChannelId((data.categoryVoiceChannel || {})[catId] || \"\");");
        expect(dialog).toContain("planBody(plan), announce, voiceChannelId");
    });

    it("saves the plan as a template without touching the event, and edits own events with the same dialog", () => {
        expect(dialog).toContain("saveRaidTemplate(csrfToken, templateFromPlan(plan, base, tplName))");
        expect(dialog).toContain(">{t(\"raidCreate.raid.saveAsTemplate\")}</Button>");
        expect(dialog).toContain("updateRaid(csrfToken, { id: editEventId,");
        expect(read("api.ts")).toContain("send(\"PATCH\", \"/api/raids\", csrfToken, input)");
        // the raid detail edits from its one "Verwalten" menu (#288), only for an own event and raids write
        expect(detail).toContain("data.event.source === \"eventhelper\" && canAccess(user, \"raids\", \"write\")");
        expect(detail).toContain("editEventId={data.event.id}");
        expect(detail).toContain("if (action === \"edit\") setEditing(true);");
        expect(hero).toContain("{manage}");
    });

    it("explains in tooltips, not hint paragraphs", () => {
        expect(dialog).not.toContain("className=\"hint\"");
        expect(fields).not.toContain("className=\"hint\"");
    });
});
