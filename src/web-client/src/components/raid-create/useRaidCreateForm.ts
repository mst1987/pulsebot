import { useEffect, useMemo, useState } from "react";
import {
    getRaidCreateContext, getChannelNameSuggestion, createRaid, updateRaid, saveRaidTemplate,
    type ApiError, type ChannelNameSuggestion, type EventSource, type RaidCreateContext,
} from "../../api";
import { useT } from "../../i18n";
import { eventDay } from "../../lib/raidTime";
import { instancesOf } from "../../lib/raidTemplates";
import {
    emptyPlan, planBody, planFromEvent, planFromTemplate, planProblem, raidTag, schemaName, sourceOf, stepsFor, templateFromPlan, withInstance,
    type EventPlan, type StepKey,
} from "../../lib/eventPlan";
import { useToast } from "../Jobs";
import { berlinDay, channelNameForDate, clockOf, latestPerCategory, nextSameWeekday, type ChannelMode, type Choice, type StartTab, type TemplateMode } from "./createHelpers";

/** What the dialog sends: the event's fields, where it is posted and how people sign up. */
export type RaidForm = {
    title: string;
    date: string;
    time: string;
    leaderId: string;
    /** "Andere Discord-ID…" picked in the leader dropdown: the id is typed in */
    leaderOther: boolean;
    description: string;
    categoryId: string;
    source: EventSource;
    /** "Beim Anlegen ankündigen" (#306) — prefilled from the category until it is touched. */
    announce: boolean;
    announceTouched: boolean;
    plan: EventPlan;
    freeSize: boolean;
    planTouched: boolean;
    /** The raid's voice channel (#305): preset from the category until it is picked by hand. */
    voiceChannelId: string;
    voiceTouched: boolean;
    channelMode: ChannelMode;
    channelId: string;
    channelName: string;
    channelTouched: boolean;
    /** The Raid-Helper template; picked by hand, a category change no longer swaps in its default. */
    templateId: string;
    templateTouched: boolean;
};

const EMPTY_FORM = (): RaidForm => ({
    title: "", date: "", time: "", leaderId: "", leaderOther: false, description: "", categoryId: "",
    source: "raidhelper", announce: false, announceTouched: false, plan: emptyPlan(null), freeSize: false, planTouched: false,
    voiceChannelId: "", voiceTouched: false, channelMode: "new", channelId: "", channelName: "", channelTouched: false,
    templateId: "", templateTouched: false,
});

/**
 * The state of "Neues Event": the context the server hands (categories,
 * channels, templates, versions), the step, the start choice and the form, with
 * everything that presets the form (a category, a repeated event, a raid
 * template, the event being edited), the channel name suggestion, what each
 * step needs to go on, and the two writes — the event and "Als Vorlage speichern".
 */
export function useRaidCreateForm({ open, sourceId, editEventId, onCreated }: {
    open: boolean;
    sourceId: string;
    editEventId: string;
    onCreated: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const editing = !!editEventId;
    const [ctx, setCtx] = useState<RaidCreateContext | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [step, setStep] = useState<StepKey>(editing ? "termin" : "start");
    const [choice, setChoice] = useState<Choice>(null);
    const [startTab, setStartTab] = useState<StartTab>("events");
    const [saving, setSaving] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [form, setForm] = useState<RaidForm>(EMPTY_FORM);
    /** Changes some fields of the form. */
    const patch = (next: Partial<RaidForm> | ((f: RaidForm) => Partial<RaidForm>)) => setForm((f) => ({ ...f, ...(typeof next === "function" ? next(f) : next) }));

    const [tplOpen, setTplOpen] = useState(false);
    const [tplMode, setTplMode] = useState<TemplateMode>("new");
    const [tplName, setTplName] = useState("");
    const [tplSaving, setTplSaving] = useState(false);

    const { plan, categoryId, channelMode, date } = form;
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
    const baseTemplate = raidTemplates.find((tp) => tp.id === plan.raidTemplateId) || null;
    const steps = stepsFor(editing, form.source);
    const stepAt = Math.max(0, steps.indexOf(step));

    /** The plan a category proposes: its default raid template, else the rule set. */
    const categoryPlan = (data: RaidCreateContext, catId: string): EventPlan => {
        const tplId = (data.categoryRaidTemplates || {})[catId];
        const tpl = (data.raidTemplates || []).find((tp) => tp.id === tplId);
        const vs = data.versions || [];
        if (tpl) return planFromTemplate(tpl, vs.find((v) => v.id === tpl.versionId));
        return emptyPlan(vs.find((v) => v.id === data.defaultVersion) || vs[0]);
    };

    const applyCategory = (data: RaidCreateContext, catId: string) => {
        const next: Partial<RaidForm> = { categoryId: catId, source: sourceOf(data.signupSources, catId) };
        if (!form.announceTouched) next.announce = ((data.categoryAnnounce || {})[catId] || {}).enabled === true;
        if (!form.templateTouched) next.templateId = (data.categoryTemplates || {})[catId] || data.defaults.templateId || "";
        if (!form.planTouched && choice?.kind !== "template") next.plan = categoryPlan(data, catId);
        if (!form.voiceTouched) next.voiceChannelId = (data.categoryVoiceChannel || {})[catId] || "";
        patch(next);
    };

    const applyChoice = (data: RaidCreateContext, next: NonNullable<Choice>) => {
        setChoice(next);
        patch({ channelTouched: false, templateTouched: false, planTouched: false, freeSize: false, voiceTouched: false });
        const vs = data.versions || [];
        const defaultChannel = data.channels.find((c) => c.id === data.defaults.channelId);
        // The voice channel a category's raids meet in (#305) — the preset of every start.
        const presetVoice = (catId: string) => (data.categoryVoiceChannel || {})[catId] || "";
        if (next.kind === "event") {
            const ev = data.reusableEvents.find((e) => e.id === next.id);
            if (!ev) return;
            // The category's default raid template; without one, the instances the event names.
            const catPlan = categoryPlan(data, ev.categoryId);
            const v = vs.find((x) => x.id === catPlan.versionId);
            const known = (ev.contentIds || []).filter((id) => !!v && v.instances.some((i) => i.id === id));
            patch({
                title: ev.title || "",
                description: ev.description || "",
                date: nextSameWeekday(ev.startTime),
                time: clockOf(ev.startTime),
                categoryId: ev.categoryId,
                source: sourceOf(data.signupSources, ev.categoryId),
                // The event's own Raid-Helper template, else its category's default raid template.
                templateId: ev.templateId || (data.categoryTemplates || {})[ev.categoryId] || data.defaults.templateId || "",
                plan: catPlan.raidTemplateId || !known.length ? catPlan : known.reduce((p, id) => withInstance(p, v, id), catPlan),
                voiceChannelId: presetVoice(ev.categoryId),
                channelMode: "clone",
                channelId: "",
            });
        } else if (next.kind === "template") {
            const tpl = (data.raidTemplates || []).find((tp) => tp.id === next.id);
            if (!tpl) return;
            const catId = (tpl.defaultFor || [])[0] || defaultChannel?.parentId || "";
            patch({
                title: tpl.name || "",
                description: "",
                date: "",
                time: "",
                categoryId: catId,
                source: sourceOf(data.signupSources, catId),
                templateId: tpl.raidhelperTemplateId || (data.categoryTemplates || {})[catId] || data.defaults.templateId || "",
                plan: planFromTemplate(tpl, vs.find((v) => v.id === tpl.versionId)),
                voiceChannelId: presetVoice(catId),
                channelMode: catId ? "new" : "existing",
                channelId: "",
            });
        } else {
            const catId = defaultChannel?.parentId || "";
            patch({
                title: "",
                description: "",
                date: "",
                time: "",
                categoryId: catId,
                source: sourceOf(data.signupSources, catId),
                templateId: (data.categoryTemplates || {})[catId] || data.defaults.templateId || "",
                plan: categoryPlan(data, catId),
                voiceChannelId: presetVoice(catId),
                channelMode: catId ? "new" : "existing",
                channelId: data.defaults.channelId || "",
            });
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
                patch({ leaderId: data.leaderId, leaderOther: false });
                setStartTab(data.reusableEvents.length || !(data.raidTemplates || []).length ? "events" : "templates");
                if (editing) {
                    const ev = data.editEvent;
                    if (!ev) {
                        setLoadError(t("raidCreate.load.missing"));
                        return;
                    }
                    patch({
                        title: ev.title,
                        description: ev.description,
                        leaderId: ev.leaderId || data.leaderId,
                        leaderOther: !!ev.leaderId && !(data.leaderCandidates || []).some((c) => c.id === ev.leaderId),
                        date: berlinDay(ev.startTime),
                        time: clockOf(ev.startTime),
                        categoryId: ev.categoryId,
                        source: "eventhelper",
                        plan: planFromEvent(ev),
                        planTouched: true,
                        channelMode: "existing",
                        channelId: ev.channelId,
                        channelName: ev.channelName,
                        voiceChannelId: ev.voiceChannelId || "",
                        voiceTouched: true,
                    });
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
        if (!editing && !form.channelTouched && channelMode !== "existing") patch({ channelName: suggestedName });
    }, [suggestedName, form.channelTouched, channelMode, editing]);

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
        return (ctx?.templates || []).filter((tp) => {
            if (!tp.raidhelperTemplateId || seen.has(tp.raidhelperTemplateId)) return false;
            seen.add(tp.raidhelperTemplateId);
            return true;
        });
    }, [ctx]);
    const rhTemplate = rhTemplates.find((tp) => tp.raidhelperTemplateId === form.templateId) || null;

    const categoryChannels = (ctx?.channels || []).filter((c) => !categoryId || c.parentId === categoryId);
    const channel = ctx?.channels.find((c) => c.id === form.channelId) || null;
    const categoryName = categories.find((c) => c.id === categoryId)?.name || sourceEvent?.categoryName || "";
    const canClone = !!sourceEvent && sourceEvent.categoryId === categoryId;
    const eh = form.source === "eventhelper";
    const problem = eh ? planProblem(plan) : "";
    const startPreview = date && form.time ? Math.floor(new Date(`${date}T${form.time}:00`).getTime() / 1000) : 0;
    // When the raid would be over (#305) — shown small under the time.
    const endPreview = startPreview && plan.durationMinutes > 0 ? eventDay(startPreview + plan.durationMinutes * 60) : null;
    const chosenInstances = instancesOf(version, plan.instanceIds);

    const changePlan = (next: EventPlan) => patch({ plan: next, planTouched: true });

    const readyAt = (key: StepKey): boolean => {
        if (key === "start") return choice !== null;
        if (key === "termin") return !!(form.title.trim() && date && form.time && form.leaderId.trim() && (categoryId || !categories.length));
        if (key === "raid") return !problem;
        if (key === "kanal") {
            if (editing) return true;
            const where = channelMode === "existing" ? !!form.channelId.trim() : !!form.channelName.trim() && (channelMode === "clone" || !!categoryId);
            return where && (eh || !!form.templateId.trim());
        }
        return true;
    };

    const submit = async () => {
        const { title, time, leaderId, description, voiceChannelId, channelName, channelId, templateId, source, announce } = form;
        setSaving(true);
        try {
            if (editing) {
                const r = await updateRaid({ id: editEventId, title, date, time, leaderId, description, ...planBody(plan), voiceChannelId });
                if (r.messageError) toast(t("raidCreate.toast.savedWithError", { error: r.messageError }), "err");
                else toast(t("raidCreate.toast.saved"));
            } else {
                const where = channelMode === "clone" && sourceEvent
                    ? { sourceEventId: sourceEvent.id, channelName }
                    : channelMode === "new" ? { newChannel: { name: channelName, categoryId } } : { channelId };
                const r = await createRaid({
                    title, date, time, templateId, leaderId, description, signupSource: source, ...where,
                    ...(eh ? { ...planBody(plan), announce, voiceChannelId } : { raidTemplateId: plan.raidTemplateId }),
                });
                if (r.messageError) toast(t("raidCreate.toast.createdWithError", { error: r.messageError }), "err");
                else if (r.announceError) toast(t("raidCreate.toast.announceError", { error: r.announceError }), "err");
                else toast(r.announced ? t("raidCreate.toast.createdAnnounced") : t("raidCreate.toast.created"));
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
        setTplName(baseTemplate ? "" : form.title.trim());
        setTplOpen(true);
    };
    const saveTemplate = async () => {
        setTplSaving(true);
        try {
            const base = tplMode === "update" ? baseTemplate : null;
            const saved = await saveRaidTemplate(templateFromPlan(plan, base, tplName));
            setCtx((c) => (c ? { ...c, raidTemplates: [saved, ...(c.raidTemplates || []).filter((tp) => tp.id !== saved.id)] } : c));
            patch((f) => ({ plan: { ...f.plan, raidTemplateId: saved.id } }));
            setTplOpen(false);
            toast(base ? t("raidCreate.toast.templateUpdated", { name: saved.name }) : t("raidCreate.toast.templateCreated", { name: saved.name }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setTplSaving(false);
        }
    };

    return {
        editing, ctx, loadError, step, setStep, choice, startTab, setStartTab, saving, moreOpen, setMoreOpen,
        form, patch, changePlan, applyCategory, applyChoice,
        versions, version, raidTemplates, categories, sourceEvent, baseTemplate, steps, stepAt,
        schema, naming, options, rhTemplates, rhTemplate, categoryChannels, channel, categoryName, canClone, eh, problem,
        startPreview, endPreview, chosenInstances, readyAt, submit,
        template: { open: tplOpen, setOpen: setTplOpen, mode: tplMode, setMode: setTplMode, name: tplName, setName: setTplName, saving: tplSaving, openSave: openSaveTemplate, save: saveTemplate },
    };
}

export type RaidCreateForm = ReturnType<typeof useRaidCreateForm>;
