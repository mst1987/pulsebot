import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
    getRaidCreateContext, getChannelNameSuggestion, createRaid, updateRaid, saveRaidTemplate,
    type ApiError, type ChannelNameSuggestion, type EventSource, type RaidCreateContext, type RaidTemplate, type ReusableEvent,
} from "../api";
import { normalizeChannelName } from "../lib/channelNames";
import NamingBadge from "./channels/NamingBadge";
import { relativeDayLabel } from "../lib/format";
import { eventDay } from "../lib/raidTime";
import { instancesOf } from "../lib/raidTemplates";
import {
    PLAN_MAX_DURATION, PLAN_MIN_DURATION,
    STEP_LABELS, emptyPlan, planBody, planFromEvent, planFromTemplate, planProblem, plannedSeats, raidTag, schemaName,
    sourceOf, stepsFor, templateFromPlan, withInstance, withSize, withVersion,
    type EventPlan, type StepKey,
} from "../lib/eventPlan";
import { useToast } from "./Jobs";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import Segment from "./ui/Segment";
import WowIcon from "./ui/WowIcon";
import RaidIcon from "./RaidIcon";
import RaidLoader from "./ui/RaidLoader";
import CompositionEditor from "./CompositionEditor";
import { BuffPicker, InstancePicker, RoleRanges, SizePicker, SwitchRow } from "./RaidPlanFields";
import { CheckIcon, ChevronRightIcon } from "./icons";

// "Neues Event" as a guided dialog, one step at a time instead of a long page:
//   Vorlage            — repeat the latest event of a category, start from a raid
//                        template (#266), or start empty,
//   Termin             — title, date, time and the category; leader and
//                        description folded away under "Weitere Angaben",
//   Raid               — only for an EventHelper event (#261): version,
//                        instances, size, tanks/healers large; ranges, required
//                        buffs and the switches behind "Mehr",
//   Kanal & Anmeldung  — where it is posted (new by the category's schema, a
//                        clone, or an existing channel), how people sign up
//                        (preset from the category) and the deadline,
//   Prüfen             — the event as the list will show it.
// ?source=<id> (the list's "Wiederholen") opens it straight at "Termin".
// With `editEventId` the same dialog edits an own event (PATCH /api/raids):
// no start step, and the channel stays.

type Choice = { kind: "event" | "template" | "empty"; id: string } | null;
type ChannelMode = "new" | "clone" | "existing";
type StartTab = "events" | "templates";
type TemplateMode = "new" | "update";

const EMPTY_ICON = "inv_misc_note_02";

/** A label with its explanation in the tooltip instead of a hint paragraph under the field. */
function Label({ text, tip, htmlFor }: { text: string; tip?: string; htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="re-label">
            {text}
            {tip && <span className="re-info" tabIndex={0} data-tip={text} data-tip-sub={tip}>i</span>}
        </label>
    );
}

function Stepper({ steps, current }: { steps: StepKey[]; current: StepKey }) {
    const at = steps.indexOf(current);
    return (
        <ol className="re-steps" aria-label="Fortschritt">
            {steps.map((s, i) => (
                <li key={s} className={`re-step${i === at ? " on" : ""}${i < at ? " done" : ""}`} aria-current={i === at ? "step" : undefined}>
                    {i > 0 && <span className="re-step-line" aria-hidden="true" />}
                    <span className="n">{i < at ? <CheckIcon /> : i + 1}</span>
                    <span className="re-step-lbl">{STEP_LABELS[s]}</span>
                </li>
            ))}
        </ol>
    );
}

/** YYYY-MM-DD of a Date in local time. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** YYYY-MM-DD of an event start in the guild's time zone. */
const berlinDay = (startTime: number) => new Date(startTime * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

/**
 * The next date on the template's weekday, at least a day from now and after the
 * template itself — repeating Thursday's raid means next Thursday.
 */
function nextSameWeekday(startTime: number, now = Date.now()): string {
    if (!startTime) return "";
    const src = new Date(startTime * 1000);
    const d = new Date(Math.max(now, startTime * 1000) + 86400000);
    while (d.getDay() !== src.getDay()) d.setDate(d.getDate() + 1);
    return isoDay(d);
}

const clockOf = (startTime: number) => (startTime ? eventDay(startTime).time : "");

/** "t6-do-17-09" → "t6-do-24-09" for a new date; a name without a trailing date stays as it is. */
function channelNameForDate(name: string, date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m || !/\d{2}-\d{2}$/.test(name)) return name;
    return name.replace(/\d{2}-\d{2}$/, `${m[3]}-${m[2]}`);
}

/** The latest event of every category, newest first — what "Letzte Events" offers. */
function latestPerCategory(events: ReusableEvent[]): ReusableEvent[] {
    const best = new Map<string, ReusableEvent>();
    for (const ev of events) {
        const key = ev.categoryId || "__none__";
        const cur = best.get(key);
        if (!cur || (ev.startTime || 0) > (cur.startTime || 0)) best.set(key, ev);
    }
    return [...best.values()].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

function OptionCard({ selected, onSelect, icon, title, sub }: {
    selected: boolean; onSelect: () => void; icon: ReactNode; title: string; sub: ReactNode;
}) {
    return (
        <button type="button" role="radio" aria-checked={selected} className={`re-opt${selected ? " on" : ""}`} onClick={onSelect}>
            {icon}
            <span className="re-opt-text"><span className="re-title">{title}</span><span className="re-sub">{sub}</span></span>
            <span className="re-radio" aria-hidden="true" />
        </button>
    );
}

function EventSub({ ev }: { ev: { channelName?: string; categoryName?: string } }) {
    return (
        <>
            {ev.channelName && <span className="re-chan">#{ev.channelName}</span>}
            {ev.channelName && ev.categoryName && <span aria-hidden="true">·</span>}
            {ev.categoryName && <span>{ev.categoryName}</span>}
        </>
    );
}

/** The icons of a raid's instances, overlapping like the template list. */
function IconStack({ icons }: { icons: string[] }) {
    return (
        <span className="raid-ic re-icstack" aria-hidden="true">
            {(icons.length ? icons : [EMPTY_ICON]).slice(0, 3).map((icon, i) => <WowIcon key={`${icon}-${i}`} name={icon} size={36} className="a" />)}
        </span>
    );
}

/** A large value with a small label — the numbers the raid is about. */
function Figure({ label, value }: { label: string; value: ReactNode }) {
    return <div className="re-fig"><span className="re-fig-lbl">{label}</span><span className="re-fig-val">{value}</span></div>;
}

export default function RaidCreateDialog({ open, sourceId, editEventId = "", csrfToken, userId, onClose, onCreated }: {
    open: boolean;
    sourceId: string;
    /** an own event's id: the dialog edits it instead of creating one */
    editEventId?: string;
    csrfToken: string | null;
    userId: string;
    onClose: () => void;
    onCreated: () => void;
}) {
    const toast = useToast();
    const editing = !!editEventId;
    const [ctx, setCtx] = useState<RaidCreateContext | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [step, setStep] = useState<StepKey>(editing ? "termin" : "start");
    const [choice, setChoice] = useState<Choice>(null);
    const [startTab, setStartTab] = useState<StartTab>("events");
    const [saving, setSaving] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);

    const [title, setTitle] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [leaderId, setLeaderId] = useState("");
    const [description, setDescription] = useState("");
    const [categoryId, setCategoryId] = useState("");

    const [source, setSource] = useState<EventSource>("raidhelper");
    const [plan, setPlan] = useState<EventPlan>(() => emptyPlan(null));
    const [freeSize, setFreeSize] = useState(false);
    const [planTouched, setPlanTouched] = useState(false);

    // The raid's voice channel (#305): preset from the category until it is picked by hand.
    const [voiceChannelId, setVoiceChannelId] = useState("");
    const [voiceTouched, setVoiceTouched] = useState(false);

    const [channelMode, setChannelMode] = useState<ChannelMode>("new");
    const [channelId, setChannelId] = useState("");
    const [channelName, setChannelName] = useState("");
    const [channelTouched, setChannelTouched] = useState(false);
    // The Raid-Helper template; picked by hand, a category change no longer swaps in its default.
    const [templateId, setTemplateId] = useState("");
    const [templateTouched, setTemplateTouched] = useState(false);

    const [tplOpen, setTplOpen] = useState(false);
    const [tplMode, setTplMode] = useState<TemplateMode>("new");
    const [tplName, setTplName] = useState("");
    const [tplSaving, setTplSaving] = useState(false);

    const versions = ctx?.versions || [];
    const version = versions.find((v) => v.id === plan.versionId) || versions[0] || null;
    const raidTemplates = ctx?.raidTemplates || [];
    const categories = useMemo(() => {
        if (!ctx) return [];
        if (ctx.categories?.length) return ctx.categories;
        // Bot offline: the categories the known events sit in are better than none.
        const seen = new Map<string, string>();
        for (const ev of ctx.reusableEvents) if (ev.categoryId) seen.set(ev.categoryId, ev.categoryName);
        return [...seen].map(([id, name]) => ({ id, name }));
    }, [ctx]);
    const sourceEvent = ctx && choice?.kind === "event" ? ctx.reusableEvents.find((e) => e.id === choice.id) || null : null;
    const baseTemplate = raidTemplates.find((t) => t.id === plan.raidTemplateId) || null;
    const steps = stepsFor(editing, source);
    const stepAt = Math.max(0, steps.indexOf(step));

    /** The plan a category proposes: its default raid template, else the rule set. */
    const categoryPlan = (data: RaidCreateContext, catId: string): EventPlan => {
        const tplId = (data.categoryRaidTemplates || {})[catId];
        const tpl = (data.raidTemplates || []).find((t) => t.id === tplId);
        const vs = data.versions || [];
        if (tpl) return planFromTemplate(tpl, vs.find((v) => v.id === tpl.versionId));
        return emptyPlan(vs.find((v) => v.id === data.defaultVersion) || vs[0]);
    };

    const applyCategory = (data: RaidCreateContext, catId: string) => {
        setCategoryId(catId);
        setSource(sourceOf(data.signupSources, catId));
        if (!templateTouched) setTemplateId((data.categoryTemplates || {})[catId] || data.defaults.templateId || "");
        if (!planTouched && choice?.kind !== "template") setPlan(categoryPlan(data, catId));
        if (!voiceTouched) setVoiceChannelId((data.categoryVoiceChannel || {})[catId] || "");
    };

    const applyChoice = (data: RaidCreateContext, next: NonNullable<Choice>) => {
        setChoice(next);
        setChannelTouched(false);
        setTemplateTouched(false);
        setPlanTouched(false);
        setFreeSize(false);
        setVoiceTouched(false);
        const vs = data.versions || [];
        const defaultChannel = data.channels.find((c) => c.id === data.defaults.channelId);
        // The voice channel a category's raids meet in (#305) — the preset of every start.
        const presetVoice = (catId: string) => setVoiceChannelId((data.categoryVoiceChannel || {})[catId] || "");
        if (next.kind === "event") {
            const ev = data.reusableEvents.find((e) => e.id === next.id);
            if (!ev) return;
            setTitle(ev.title || "");
            setDescription(ev.description || "");
            setDate(nextSameWeekday(ev.startTime));
            setTime(clockOf(ev.startTime));
            setCategoryId(ev.categoryId);
            setSource(sourceOf(data.signupSources, ev.categoryId));
            // The event's own Raid-Helper template, else its category's default raid template.
            setTemplateId(ev.templateId || (data.categoryTemplates || {})[ev.categoryId] || data.defaults.templateId || "");
            // The category's default raid template; without one, the instances the event names.
            const catPlan = categoryPlan(data, ev.categoryId);
            const v = vs.find((x) => x.id === catPlan.versionId);
            const known = (ev.contentIds || []).filter((id) => !!v && v.instances.some((i) => i.id === id));
            setPlan(catPlan.raidTemplateId || !known.length ? catPlan : known.reduce((p, id) => withInstance(p, v, id), catPlan));
            presetVoice(ev.categoryId);
            setChannelMode("clone");
            setChannelId("");
        } else if (next.kind === "template") {
            const tpl = (data.raidTemplates || []).find((t) => t.id === next.id);
            if (!tpl) return;
            const catId = (tpl.defaultFor || [])[0] || defaultChannel?.parentId || "";
            setTitle(tpl.name || "");
            setDescription("");
            setDate("");
            setTime("");
            setCategoryId(catId);
            setSource(sourceOf(data.signupSources, catId));
            setTemplateId(tpl.raidhelperTemplateId || (data.categoryTemplates || {})[catId] || data.defaults.templateId || "");
            setPlan(planFromTemplate(tpl, vs.find((v) => v.id === tpl.versionId)));
            presetVoice(catId);
            setChannelMode(catId ? "new" : "existing");
            setChannelId("");
        } else {
            const catId = defaultChannel?.parentId || "";
            setTitle("");
            setDescription("");
            setDate("");
            setTime("");
            setCategoryId(catId);
            setSource(sourceOf(data.signupSources, catId));
            setTemplateId((data.categoryTemplates || {})[catId] || data.defaults.templateId || "");
            setPlan(categoryPlan(data, catId));
            presetVoice(catId);
            setChannelMode(catId ? "new" : "existing");
            setChannelId(data.defaults.channelId || "");
        }
    };

    useEffect(() => {
        if (!open) return;
        setStep(editing ? "termin" : "start");
        setChoice(null);
        setMoreOpen(false);
        setTplOpen(false);
        setLoadError(null);
        getRaidCreateContext(editEventId)
            .then((data) => {
                setCtx(data);
                setLeaderId(data.leaderId);
                setStartTab(data.reusableEvents.length || !(data.raidTemplates || []).length ? "events" : "templates");
                if (editing) {
                    const ev = data.editEvent;
                    if (!ev) {
                        setLoadError("Das Event gibt es nicht (mehr) oder es ist kein EventHelper-Event.");
                        return;
                    }
                    setTitle(ev.title);
                    setDescription(ev.description);
                    setLeaderId(ev.leaderId || data.leaderId);
                    setDate(berlinDay(ev.startTime));
                    setTime(clockOf(ev.startTime));
                    setCategoryId(ev.categoryId);
                    setSource("eventhelper");
                    setPlan(planFromEvent(ev));
                    setPlanTouched(true);
                    setChannelMode("existing");
                    setChannelId(ev.channelId);
                    setChannelName(ev.channelName);
                    setVoiceChannelId(ev.voiceChannelId || "");
                    setVoiceTouched(true);
                    return;
                }
                // ?source=<id>: the list's "Wiederholen" — straight to the date.
                if (sourceId && data.reusableEvents.some((e) => e.id === sourceId)) {
                    applyChoice(data, { kind: "event", id: sourceId });
                    setStep("termin");
                }
            })
            .catch((err: ApiError) => setLoadError(err.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sourceId, editEventId]);

    // The channel name follows date, category and raid until it is typed by hand.
    // The server names it like the category's previous event channel (#285) and
    // says so; the local schema is only the fallback while that answer is out.
    const schema = ctx ? (ctx.channelSchemas || {})[categoryId] : undefined;
    const [naming, setNaming] = useState<ChannelNameSuggestion | null>(null);
    const namingSourceId = channelMode === "clone" ? sourceEvent?.id || "" : "";
    const namingKey = [channelMode, categoryId, date, plan.instanceIds.join(","), namingSourceId].join("|");
    useEffect(() => {
        if (!open || editing || channelMode === "existing" || !categoryId) {
            setNaming(null);
            return;
        }
        let alive = true;
        const timer = setTimeout(() => {
            getChannelNameSuggestion({ categoryId, date, instanceIds: plan.instanceIds, sourceEventId: namingSourceId })
                .then((r) => { if (alive) setNaming(r); })
                .catch(() => { if (alive) setNaming(null); });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [namingKey, open, editing]);
    const suggestedName = useMemo(() => {
        if (naming?.name) return naming.name;
        if (channelMode === "clone" && !schema?.schema) return channelNameForDate(sourceEvent?.channelName || "", date);
        return schemaName(schema?.schema || ctx?.defaultSchema || "", date, raidTag(version, plan.instanceIds, schema?.raid || ""));
    }, [naming, channelMode, schema, ctx, date, version, plan.instanceIds, sourceEvent]);
    useEffect(() => {
        if (!editing && !channelTouched && channelMode !== "existing") setChannelName(suggestedName);
    }, [suggestedName, channelTouched, channelMode, editing]);

    const options = useMemo(() => {
        if (!ctx) return [];
        const latest = latestPerCategory(ctx.reusableEvents);
        // An explicitly requested source that is not its category's latest still gets a card.
        const extra = sourceId ? ctx.reusableEvents.find((e) => e.id === sourceId && !latest.includes(e)) : null;
        return extra ? [extra, ...latest] : latest;
    }, [ctx, sourceId]);

    // The raid templates that link a Raid-Helper template — only those can be sent,
    // one option per Raid-Helper id (two templates may share one).
    const rhTemplates = useMemo(() => {
        const seen = new Set<string>();
        return (ctx?.templates || []).filter((t) => {
            if (!t.raidhelperTemplateId || seen.has(t.raidhelperTemplateId)) return false;
            seen.add(t.raidhelperTemplateId);
            return true;
        });
    }, [ctx]);
    const rhTemplate = rhTemplates.find((t) => t.raidhelperTemplateId === templateId) || null;

    const categoryChannels = (ctx?.channels || []).filter((c) => !categoryId || c.parentId === categoryId);
    const channel = ctx?.channels.find((c) => c.id === channelId) || null;
    const categoryName = categories.find((c) => c.id === categoryId)?.name || sourceEvent?.categoryName || "";
    const canClone = !!sourceEvent && sourceEvent.categoryId === categoryId;
    const eh = source === "eventhelper";
    const problem = eh ? planProblem(plan) : "";
    const startPreview = date && time ? Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000) : 0;
    // When the raid would be over (#305) — shown small under the time.
    const endPreview = startPreview && plan.durationMinutes > 0 ? eventDay(startPreview + plan.durationMinutes * 60) : null;
    const chosenInstances = instancesOf(version, plan.instanceIds);

    const changePlan = (next: EventPlan) => {
        setPlan(next);
        setPlanTouched(true);
    };

    const readyAt = (key: StepKey): boolean => {
        if (key === "start") return choice !== null;
        if (key === "termin") return !!(title.trim() && date && time && leaderId.trim() && (categoryId || !categories.length));
        if (key === "raid") return !problem;
        if (key === "kanal") {
            if (editing) return true;
            const where = channelMode === "existing" ? !!channelId.trim() : !!channelName.trim() && (channelMode === "clone" || !!categoryId);
            return where && (eh || !!templateId.trim());
        }
        return true;
    };

    const submit = async () => {
        setSaving(true);
        try {
            if (editing) {
                const r = await updateRaid(csrfToken, { id: editEventId, title, date, time, leaderId, description, ...planBody(plan), voiceChannelId });
                if (r.messageError) toast(`Gespeichert — ${r.messageError}`, "err");
                else toast("Event gespeichert.");
            } else {
                const where = channelMode === "clone" && sourceEvent
                    ? { sourceEventId: sourceEvent.id, channelName }
                    : channelMode === "new" ? { newChannel: { name: channelName, categoryId } } : { channelId };
                const r = await createRaid(csrfToken, {
                    title, date, time, templateId, leaderId, description, signupSource: source, ...where,
                    ...(eh ? { ...planBody(plan), voiceChannelId } : { raidTemplateId: plan.raidTemplateId }),
                });
                if (r.messageError) toast(`Event angelegt — ${r.messageError}`, "err");
                else toast("Event angelegt.");
            }
            onCreated();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    // "Als Vorlage speichern": into the template the plan came from, or a new one.
    // The event itself is not touched by it, and nothing else writes a template.
    const openSaveTemplate = () => {
        setTplMode(baseTemplate ? "update" : "new");
        setTplName(baseTemplate ? "" : title.trim());
        setTplOpen(true);
    };
    const saveTemplate = async () => {
        setTplSaving(true);
        try {
            const base = tplMode === "update" ? baseTemplate : null;
            const saved = await saveRaidTemplate(csrfToken, templateFromPlan(plan, base, tplName));
            setCtx((c) => (c ? { ...c, raidTemplates: [saved, ...(c.raidTemplates || []).filter((t) => t.id !== saved.id)] } : c));
            setPlan((p) => ({ ...p, raidTemplateId: saved.id }));
            setTplOpen(false);
            toast(base ? `Vorlage „${saved.name}“ aktualisiert.` : `Vorlage „${saved.name}“ angelegt.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setTplSaving(false);
        }
    };

    const summaryIcon = choice?.kind === "event" && sourceEvent
        ? <RaidIcon contentIds={sourceEvent.contentIds} sources={["title"]} />
        : <IconStack icons={chosenInstances.map((i) => i.icon)} />;

    let body: ReactNode;
    if (loadError) {
        body = <div className="re-empty">Fehler beim Laden: {loadError}</div>;
    } else if (!ctx) {
        body = <RaidLoader compact text={editing ? "Event wird geladen" : "Vorlagen werden geladen"} />;
    } else if (step === "start") {
        const templateCard = (t: RaidTemplate) => {
            const v = versions.find((x) => x.id === t.versionId);
            const insts = instancesOf(v, t.instanceIds);
            const facts = [v?.short || t.versionId, t.size ? `${t.size} Spieler` : "", t.size ? `${t.composition.tank} Tanks · ${t.composition.healer} Heiler` : ""];
            return (
                <OptionCard
                    key={t.id}
                    selected={choice?.kind === "template" && choice.id === t.id}
                    onSelect={() => applyChoice(ctx, { kind: "template", id: t.id })}
                    icon={<IconStack icons={insts.map((i) => i.icon)} />}
                    title={t.name || "(ohne Name)"}
                    sub={(
                        <>
                            <span>{facts.filter(Boolean).join(" · ")}</span>
                            {t.incomplete && <Badge tone="mid">Infos fehlen</Badge>}
                            {t.needsSize && <Badge tone="mid">Größe ergänzen</Badge>}
                        </>
                    )}
                />
            );
        };
        body = (
            <>
                <div className="re-label-row re-start-head">
                    <Label text="Wovon ausgehen?" tip="Letztes Event: übernimmt Titel, Beschreibung und Uhrzeit, der Kanal wird fürs neue Datum geklont. Raid-Vorlage: Instanzen, Größe, Tanks und Heiler — für dieses Event weiter änderbar." />
                    <Segment<StartTab> size="sm" ariaLabel="Ausgangspunkt" value={startTab} onChange={setStartTab}
                        options={[{ value: "events", label: "Letzte Events" }, { value: "templates", label: "Raid-Vorlagen" }]} />
                </div>
                <div className="re-opts" role="radiogroup" aria-label="Vorlage">
                    {startTab === "events"
                        ? options.map((ev) => (
                            <OptionCard
                                key={ev.id}
                                selected={choice?.kind === "event" && choice.id === ev.id}
                                onSelect={() => applyChoice(ctx, { kind: "event", id: ev.id })}
                                icon={<RaidIcon contentIds={ev.contentIds} sources={["title"]} />}
                                title={ev.title || "(ohne Titel)"}
                                sub={<EventSub ev={ev} />}
                            />
                        ))
                        : raidTemplates.map(templateCard)}
                    {startTab === "events" && !options.length && <div className="re-empty">Noch kein Event zum Wiederholen.</div>}
                    {startTab === "templates" && !raidTemplates.length && (
                        <div className="re-empty">Noch keine Raid-Vorlage — <Link className="re-link" to="/raids/raid-templates">Raid-Vorlagen</Link></div>
                    )}
                    <span className="re-opts-sep" aria-hidden="true" />
                    <OptionCard
                        selected={choice?.kind === "empty"}
                        onSelect={() => applyChoice(ctx, { kind: "empty", id: "" })}
                        icon={<span className="raid-ic"><WowIcon name={EMPTY_ICON} size={36} className="a" /></span>}
                        title="Leer beginnen"
                        sub="Kategorie wählen, der Rest kommt aus ihrer Standard-Vorlage"
                    />
                </div>
            </>
        );
    } else if (step === "termin") {
        const leaderText = leaderId === userId ? "Leitung: du" : leaderId ? `Leitung: ${leaderId}` : "Keine Leitung";
        const descText = description.trim() ? (sourceEvent && description === sourceEvent.description ? "Beschreibung übernommen" : "Beschreibung gesetzt") : "ohne Beschreibung";
        let startName = "Leer beginnen";
        if (choice?.kind === "event" && sourceEvent) startName = `${sourceEvent.title || "(ohne Titel)"}${sourceEvent.categoryName ? ` · ${sourceEvent.categoryName}` : ""}`;
        else if (choice?.kind === "template") startName = baseTemplate?.name || "(ohne Name)";
        body = (
            <>
                {!editing && (
                    <div className="re-summary">
                        {choice?.kind === "empty" ? <span className="raid-ic"><WowIcon name={EMPTY_ICON} size={36} className="a" /></span> : summaryIcon}
                        <div className="re-opt-text">
                            <span className="kicker">{choice?.kind === "template" ? "Raid-Vorlage" : "Vorlage"}</span>
                            <strong>{startName}</strong>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setStep("start")}>Ändern</Button>
                    </div>
                )}
                <div className="field">
                    <Label text="Titel" htmlFor="re-title" />
                    <input id="re-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hyjal + Black Temple" required />
                </div>
                <div className="re-grid2">
                    <div className="field">
                        <Label text="Datum" htmlFor="re-date" />
                        <input id="re-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                    <div className="field">
                        <Label text="Uhrzeit" htmlFor="re-time" />
                        <div className="re-clock">
                            <input id="re-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                            {eh && (
                                <label className="re-duration" data-tip="Dauer" data-tip-sub={`Wie lange der Raid dauert, in Minuten (${PLAN_MIN_DURATION}–${PLAN_MAX_DURATION}). Daraus ergibt sich das Ende — es steht in der Anmelde-Nachricht und begrenzt das Discord-Event.`}>
                                    <input type="number" aria-label="Dauer in Minuten" min={PLAN_MIN_DURATION} max={PLAN_MAX_DURATION} step={15} value={plan.durationMinutes}
                                        onChange={(e) => changePlan({ ...plan, durationMinutes: Math.floor(Number(e.target.value) || 0) })} />
                                    <span className="re-sub">Min.</span>
                                </label>
                            )}
                        </div>
                        {eh && endPreview && <span className="re-sub">Ende {endPreview.time}</span>}
                    </div>
                </div>
                {categories.length > 0 && (
                    <div className="field">
                        <Label text="Kategorie" htmlFor="re-category" tip={editing ? "Das Event bleibt in seinem Kanal und seiner Kategorie." : "Bestimmt die Standard-Vorlage, das Kanal-Schema und ob die Anmeldung über den EventHelper oder Raid-Helper läuft."} />
                        <select id="re-category" value={categoryId} disabled={editing} onChange={(e) => {
                            applyCategory(ctx, e.target.value);
                            if (channelMode === "clone" && sourceEvent?.categoryId !== e.target.value) setChannelMode("new");
                        }}>
                            <option value="">— Kategorie wählen —</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}
                <div className={`re-more${moreOpen ? " open" : ""}`}>
                    <div className="re-more-head">
                        <WowIcon name="inv_misc_book_09" size={22} />
                        <div className="re-opt-text">
                            <strong>Weitere Angaben</strong>
                            <span className="re-sub">{leaderText} · {descText}</span>
                        </div>
                        <Expand open={moreOpen} onToggle={() => setMoreOpen((o) => !o)} />
                    </div>
                    {moreOpen && (
                        <div className="re-more-body">
                            <div className="field">
                                <Label text="Event-Leiter (Discord-User-ID)" htmlFor="re-leader" tip="Vorbelegt mit deiner ID." />
                                <input id="re-leader" className="re-mono" type="text" value={leaderId} onChange={(e) => setLeaderId(e.target.value)} required />
                            </div>
                            <div className="field">
                                <Label text="Beschreibung" htmlFor="re-desc" tip="Optional. Steht in der Event-Nachricht unter dem Titel." />
                                <textarea id="re-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weitere Infos zum Raid …" />
                            </div>
                        </div>
                    )}
                </div>
            </>
        );
    } else if (step === "raid") {
        const moreCount = [plan.melee, plan.ranged].filter(Boolean).length + plan.requiredBuffs.length
            + (plan.fairness ? 1 : 0) + (plan.wishes ? 1 : 0) + (plan.autoSuggest ? 1 : 0);
        const toggleBuff = (key: string) => changePlan({
            ...plan, requiredBuffs: plan.requiredBuffs.includes(key) ? plan.requiredBuffs.filter((b) => b !== key) : [...plan.requiredBuffs, key],
        });
        body = (
            <>
                <div className="re-raid-head">
                    <Segment size="sm" ariaLabel="Spielversion" value={plan.versionId}
                        onChange={(id) => { setFreeSize(false); changePlan(withVersion(plan, versions.find((v) => v.id === id))); }}
                        options={versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))} />
                    <span className="re-raid-tpl">
                        {baseTemplate && <Badge tip="Raid-Vorlage" tipSub="Die Werte kamen aus dieser Vorlage. Änderungen hier gelten nur für dieses Event.">{baseTemplate.name}</Badge>}
                        <Button variant="ghost" size="sm" icon="inv_misc_note_05" onClick={openSaveTemplate}>Als Vorlage speichern</Button>
                    </span>
                </div>
                {tplOpen && (
                    <div className="re-tpl-save" role="group" aria-label="Als Vorlage speichern">
                        {baseTemplate && (
                            <Segment<TemplateMode> size="sm" ariaLabel="Vorlage" value={tplMode} onChange={setTplMode}
                                options={[{ value: "update", label: `„${baseTemplate.name}“ aktualisieren` }, { value: "new", label: "Neue Vorlage" }]} />
                        )}
                        {tplMode === "new" && (
                            <input type="text" aria-label="Name der Vorlage" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Name, z. B. SSC + TK 25er" />
                        )}
                        <span className="re-tpl-acts">
                            <Button variant="ghost" size="sm" onClick={() => setTplOpen(false)}>Abbrechen</Button>
                            <Button size="sm" running={tplSaving} disabled={!!problem || (tplMode === "new" && !tplName.trim())} onClick={saveTemplate}>Speichern</Button>
                        </span>
                    </div>
                )}
                <InstancePicker version={version} value={plan.instanceIds} onToggle={(id) => changePlan(withInstance(plan, version, id))} />
                <SizePicker version={version} instanceIds={plan.instanceIds} size={plan.size} free={freeSize} onFree={setFreeSize}
                    onSize={(size) => changePlan(withSize(plan, version, size ?? 0))} />
                <CompositionEditor size={plan.size || null} value={{ tank: plan.tank, healer: plan.healer }}
                    onChange={(c) => changePlan({ ...plan, tank: c.tank, healer: c.healer })} />
                <div className="re-fit" role="status">
                    {problem
                        ? <Badge tone="bad">{problem}</Badge>
                        : <Badge tone="ok" icon={<CheckIcon />} tip="Summe passt zur Größe" tipSub="Tanks, Heiler und die Nah-/Fernkampf-Minima passen in den Raid.">{plannedSeats(plan)} / {plan.size} verplant</Badge>}
                </div>
                <details className="rt-more">
                    <summary>Mehr: Nah-/Fernkampf, Pflicht-Buffs, Setup{moreCount ? <Badge count>{moreCount}</Badge> : null}</summary>
                    <div className="rt-more-body">
                        <RoleRanges idPrefix="re" melee={plan.melee} ranged={plan.ranged} onChange={(r) => changePlan({ ...plan, ...r })} />
                        <BuffPicker version={version} value={plan.requiredBuffs} onToggle={toggleBuff} />
                        <div className="rt-switches">
                            <SwitchRow label="Fairness" tip="Wer zuletzt auf der Bank saß, wird beim Setup-Vorschlag bevorzugt." checked={plan.fairness} onChange={(v) => changePlan({ ...plan, fairness: v })} />
                            <SwitchRow label="Wünsche" tip="„Gerne zusammen raiden mit“ aus den Profilen fließt in den Setup-Vorschlag ein." checked={plan.wishes} onChange={(v) => changePlan({ ...plan, wishes: v })} />
                            <SwitchRow label="Vorschlag bei Anmeldeschluss" tip="Zum Anmeldeschluss entsteht automatisch ein Setup-Vorschlag — ein Entwurf, den jemand freigeben muss." checked={plan.autoSuggest} onChange={(v) => changePlan({ ...plan, autoSuggest: v })} />
                        </div>
                    </div>
                </details>
            </>
        );
    } else if (step === "kanal") {
        const deadlineAt = startPreview && plan.deadlineHours > 0 ? eventDay(startPreview - plan.deadlineHours * 3600) : null;
        const modes = [
            { value: "new" as ChannelMode, label: "Neu nach Schema", disabled: !categoryId },
            ...(canClone ? [{ value: "clone" as ChannelMode, label: "Klonen" }] : []),
            { value: "existing" as ChannelMode, label: "Vorhanden" },
        ];
        body = (
            <>
                {!editing && (
                    <div className="field">
                        <Label text="Anmeldung über" tip="Vorbelegt aus der Kategorie (Einstellungen → Kategorien). EventHelper: eigene Anmeldung mit Raid-Planung. Raid-Helper: wie bisher, mit Raid-Helper-Template." />
                        <Segment<EventSource> ariaLabel="Anmeldung über" value={source} onChange={setSource}
                            options={[{ value: "eventhelper", label: "EventHelper", icon: "inv_misc_note_05" }, { value: "raidhelper", label: "Raid-Helper", icon: "inv_misc_map_01" }]} />
                    </div>
                )}
                {editing
                    ? (
                        <div className="re-summary">
                            <WowIcon name="inv_letter_15" size={28} />
                            <div className="re-opt-text">
                                <span className="kicker">Kanal</span>
                                <strong className="re-mono">#{channelName || channelId}</strong>
                            </div>
                            <Badge tip="Kanal bleibt" tipSub="Ein Event zieht beim Bearbeiten nicht um — für einen anderen Kanal ein neues Event anlegen.">bleibt</Badge>
                        </div>
                    )
                    : (
                        <div className="field">
                            <div className="re-label-row">
                                <Label text="Kanal" htmlFor="re-channel" tip={`Neu: ein Kanal in der Kategorie, benannt nach ihrem Schema (Kanäle). Klonen: der Kanal #${sourceEvent?.channelName || "…"} mit Rechten und Thema. Vorhanden: ein bestehender Kanal.`} />
                                <Segment<ChannelMode> size="sm" ariaLabel="Kanal" value={channelMode} onChange={(m) => { setChannelMode(m); setChannelTouched(false); }} options={modes} />
                            </div>
                            {channelMode === "existing"
                                ? (ctx.channels.length
                                    ? (
                                        <select id="re-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                                            <option value="">— Kanal wählen —</option>
                                            {(categoryChannels.length ? categoryChannels : ctx.channels).map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                        </select>
                                    )
                                    : <input id="re-channel" type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Kanal-ID (kein Server gewählt)" required />)
                                : (
                                    <>
                                        <input id="re-channel" className="re-mono re-chan-name" type="text" value={channelName}
                                            onChange={(e) => { setChannelName(e.target.value); setChannelTouched(true); }} required
                                            data-tip="Kanalname" data-tip-sub={naming ? `${naming.label}${categoryName ? ` · ${categoryName}` : ""}` : `Schema ${schema?.schema || ctx.defaultSchema || ""}${categoryName ? ` · ${categoryName}` : ""}`} />
                                        {naming && (
                                            <div className="re-naming">
                                                {channelTouched && naming.name !== normalizeChannelName(channelName)
                                                    ? <Badge tip="Von Hand benannt" tipSub={`Vorschlag wäre #${naming.name} (${naming.label}). ${naming.design}.`}>von Hand benannt</Badge>
                                                    : <NamingBadge naming={naming} />}
                                            </div>
                                        )}
                                    </>
                                )}
                        </div>
                    )}
                {eh && (
                    <div className="field">
                        <Label text="Sprachkanal" htmlFor="re-voice" tip="Wo sich der Raid trifft. Steht als eigene Zeile in der Anmelde-Nachricht und ist der Ort des Discord-Events. Vorbelegt aus der Kategorie (Einstellungen → Kategorien)." />
                        {(ctx.voiceChannels || []).length
                            ? (
                                <select id="re-voice" value={voiceChannelId} onChange={(e) => { setVoiceChannelId(e.target.value); setVoiceTouched(true); }}>
                                    <option value="">— keiner —</option>
                                    {(ctx.voiceChannels || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                </select>
                            )
                            : <span className="note">Keine Sprachkanäle geladen (Bot offline).</span>}
                    </div>
                )}
                {eh
                    ? (
                        <div className="field">
                            <Label text="Anmeldeschluss" htmlFor="re-deadline" tip="Stunden vor dem Raidbeginn; leer = kein Anmeldeschluss." />
                            <div className="re-deadline">
                                <input id="re-deadline" type="number" min={0} max={336} value={plan.deadlineHours || ""} placeholder="keiner"
                                    onChange={(e) => changePlan({ ...plan, deadlineHours: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                                <span className="re-sub">Std. vorher</span>
                                {deadlineAt && <Badge tone="accent">{deadlineAt.day} · {deadlineAt.time}</Badge>}
                            </div>
                        </div>
                    )
                    : (
                        <div className="field">
                            <div className="re-label-row">
                                <Label text="Raid-Helper-Template" htmlFor="re-template" tip="Welche Rollen, Klassen und Plätze das Event hat. Angeboten werden die Raid-Vorlagen mit verknüpfter Raid-Helper-Vorlage; vorbelegt ist die Standard-Vorlage der Kategorie." />
                                <Link className="re-link" to="/raids/raid-templates">Raid-Vorlagen</Link>
                            </div>
                            <select id="re-template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setTemplateTouched(true); }} required>
                                <option value="">— Template wählen —</option>
                                {templateId && !rhTemplate && <option value={templateId}>ID {templateId} (nicht in der Liste)</option>}
                                {rhTemplates.map((t) => <option key={t.id} value={t.raidhelperTemplateId}>{t.name || "(ohne Name)"} · ID {t.raidhelperTemplateId}</option>)}
                            </select>
                        </div>
                    )}
            </>
        );
    } else {
        const when = eventDay(startPreview);
        let where: ReactNode = <code>#{channel?.name || channelName || channelId}</code>;
        if (!editing && channelMode === "clone") where = <>neu: <code>#{channelName}</code>, geklont aus <code>#{sourceEvent?.channelName}</code></>;
        else if (!editing && channelMode === "new") where = <>neu: <code>#{channelName}</code>{categoryName ? ` in ${categoryName}` : ""}</>;
        body = (
            <>
                <div className="re-review">
                    {eh ? <IconStack icons={chosenInstances.map((i) => i.icon)} /> : summaryIcon}
                    <div className="re-ev">
                        <span className="re-title">{title}</span>
                        <span className="re-sub"><EventSub ev={{ channelName: channelName || channel?.name, categoryName }} /></span>
                    </div>
                    <div className="re-when"><b>{when.day}</b><span>{when.time}{startPreview ? ` · ${relativeDayLabel(startPreview)}` : ""}</span></div>
                </div>
                {eh && (
                    <div className="re-figs">
                        <Figure label="Größe" value={plan.size} />
                        <Figure label="Tanks" value={plan.tank} />
                        <Figure label="Heiler" value={plan.healer} />
                        <Figure label="DPS" value={Math.max(0, plan.size - plan.tank - plan.healer)} />
                    </div>
                )}
                <dl className="re-facts">
                    <dt>Anmeldung</dt>
                    <dd>{eh ? "EventHelper" : "Raid-Helper"}{!editing && source !== sourceOf(ctx.signupSources, categoryId) && <Badge tone="mid">abweichend von der Kategorie</Badge>}</dd>
                    {eh
                        ? (
                            <>
                                <dt>Raid</dt>
                                <dd>{chosenInstances.map((i) => i.name).join(" + ") || "—"}{chosenInstances.some((i) => i.status === "incomplete") && <Badge tone="mid">Infos fehlen</Badge>}</dd>
                                <dt>Dauer</dt>
                                <dd>{plan.durationMinutes} Min.{endPreview ? ` · Ende ${endPreview.time}` : ""}</dd>
                                <dt>Sprachkanal</dt>
                                <dd>{voiceChannelId ? (ctx.voiceChannels || []).find((c) => c.id === voiceChannelId)?.name || voiceChannelId : "keiner"}</dd>
                                <dt>Anmeldeschluss</dt>
                                <dd>{plan.deadlineHours > 0 ? `${plan.deadlineHours} Std. vorher` : "keiner"}</dd>
                            </>
                        )
                        : (
                            <>
                                <dt>Template</dt>
                                <dd>{rhTemplate ? rhTemplate.name || "(ohne Name)" : "eigene ID"} <Badge>ID {templateId}</Badge></dd>
                            </>
                        )}
                    <dt>Kanal</dt>
                    <dd>{where}</dd>
                    <dt>Leitung</dt>
                    <dd>{leaderId === userId ? "du" : <code>{leaderId}</code>}</dd>
                    <dt>Beschreibung</dt>
                    <dd className="re-desc-preview">{description.trim() || "—"}</dd>
                </dl>
            </>
        );
    }

    const cancel = <Button variant="ghost" onClick={onClose}>Abbrechen</Button>;
    const back = stepAt > 0 ? <Button variant="ghost" onClick={() => setStep(steps[stepAt - 1])}>Zurück</Button> : undefined;
    const next = steps[stepAt + 1];
    const footer = step === "check" || !next
        ? <>{cancel}<Button icon="inv_misc_note_05" running={saving} disabled={!ctx || !!problem} onClick={submit}>{editing ? "Speichern" : "Event anlegen"}</Button></>
        : <>{cancel}<Button disabled={!ctx || !readyAt(step)} onClick={() => setStep(next)}>Weiter: {STEP_LABELS[next]} <ChevronRightIcon /></Button></>;

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_note_05"
            kicker={`Schritt ${stepAt + 1} von ${steps.length}`}
            title={editing ? "Event bearbeiten" : "Neues Raid-Event"}
            width={680}
            hint={back}
            footer={footer}
        >
            <Stepper steps={steps} current={step} />
            <div className="re-dlg-body">{body}</div>
        </Modal>
    );
}
