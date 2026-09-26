import { useEffect, useState } from "react";
import {
    quickCreateChannels, type ApiError, type ChannelNaming, type ChannelsData, type QuickCreateInput, type QuickCreatePlanRow,
} from "../../api";
import NamingBadge from "./NamingBadge";
import { Badge, Button, Modal, Segment } from "../ui";
import { ChannelsIcon } from "../icons";
import { SwitchRow } from "../RaidPlanFields";
import { PlaceholderChips } from "./ChannelBulk";
import { isTextLike } from "../../lib/channels";
import { tParts, useT } from "../../i18n";

const SOURCE_LABELS = { raidhelper: "Raid-Helper", eventhelper: "EventHelper" } as const;
const DEFAULT_EVENT_TIME = "19:30";

// Quick-create by naming schema (issue #259, artboard "Kanäle anlegen"): pick
// the category, the first day and how often; the preview shows every name the
// schema makes and which of them exist already — those are skipped, never
// duplicated. Schema, raid and template channel are remembered per category.
//
// An empty schema names the channels like the category's latest event channel
// and copies that channel (#285); one badge above the preview says where the
// names come from, the details in its tooltip.
//
// "Gleich Event anlegen" (raids write, a category chosen): one switch and one
// time field; every channel created gets an event on its day, with the
// category's default raid template and source — shown as one small badge, the
// details in its tooltip. The job toast lists per channel what did not work.

/** Today in the browser's calendar, as "2026-09-16". */
function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function QuickCreateDialog({ data, initialCategoryId, onClose, onCreate }: {
    data: ChannelsData;
    initialCategoryId?: string;
    onClose: () => void;
    /** Runs the creation (as a job) with the final input. */
    onCreate: (input: QuickCreateInput, count: number) => void;
}) {
    const t = useT();
    const archiveId = data.archive?.categoryId || "";
    const categories = data.categories.filter((c) => c.id !== archiveId);
    const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || "");
    const stored = data.schemas?.[categoryId];
    const [mode, setMode] = useState<"once" | "weekly">("weekly");
    const [from, setFrom] = useState(today());
    const [count, setCount] = useState(4);
    // Only a schema of the category's own counts; the default one is what an empty field falls back to anyway.
    const ownSchema = (s?: string) => (s && s !== data.defaultSchema ? s : "");
    const [schema, setSchema] = useState(ownSchema(stored?.schema));
    const [raid, setRaid] = useState(stored?.raid || "");
    const [templateChannelId, setTemplate] = useState(stored?.templateChannelId || "");
    const [saveSchema, setSaveSchema] = useState(true);
    const [withEvent, setWithEvent] = useState(false);
    const [time, setTime] = useState(stored?.time || DEFAULT_EVENT_TIME);
    const [plan, setPlan] = useState<QuickCreatePlanRow[]>([]);
    const [planError, setPlanError] = useState("");
    const [naming, setNaming] = useState<ChannelNaming | null>(null);

    // Switching the category loads what that category remembered.
    const pickCategory = (id: string) => {
        setCategoryId(id);
        const own = data.schemas?.[id];
        setSchema(ownSchema(own?.schema));
        setRaid(own?.raid || "");
        setTemplate(own?.templateChannelId || "");
        if (own?.time) setTime(own.time);
    };

    // Events need a category (its template and source) and the right to create raids.
    const eventsPossible = !!data.canCreateEvents && !!categoryId;
    const eventOn = eventsPossible && withEvent;
    const defaults = data.eventDefaults?.[categoryId];
    const input: QuickCreateInput = {
        categoryId, schema, raid, from, count: mode === "weekly" ? count : 1, interval: mode, templateChannelId, saveSchema,
        ...(eventOn ? { withEvent: true, time } : {}),
    };

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            quickCreateChannels({ ...input, dryRun: true })
                .then((r) => { if (alive) { setPlan(r.plan); setNaming(r.naming || null); setPlanError(""); } })
                .catch((err: ApiError) => { if (alive) { setPlan([]); setNaming(null); setPlanError(err.message); } });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, schema, raid, from, count, mode, templateChannelId]);

    const todo = plan.filter((p) => !p.exists).length;
    const categoryName = categories.find((c) => c.id === categoryId)?.name || t("channels.noCategory");
    const templates = data.channels.filter((c) => isTextLike(c) && c.parentId !== archiveId);

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker={t("channels.quick.kicker", { category: categoryName })}
            title={t("channels.quick.title")}
            width={620}
            initialFocus="#kn-qc-from"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="inv_letter_15" disabled={!todo || (eventOn && !time)} onClick={() => onCreate(input, todo)}>{tParts("channels.quick.submit", { count: todo })}</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-qc-head">
                    <select aria-label={t("channels.category")} className="kn-select" value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
                        <option value="">{t("channels.noCategoryOption")}</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Segment<"once" | "weekly">
                        ariaLabel={t("channels.quick.mode")}
                        size="sm"
                        value={mode}
                        onChange={setMode}
                        options={[{ value: "once", label: t("channels.quick.once") }, { value: "weekly", label: t("channels.quick.weekly") }]}
                    />
                </div>
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-qc-from">{mode === "weekly" ? t("channels.quick.from") : t("channels.quick.on")}</label>
                        <input id="kn-qc-from" className="kn-select" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </div>
                    {mode === "weekly" && (
                        <div className="kn-field">
                            <label htmlFor="kn-qc-count">{t("channels.quick.howOften")}</label>
                            <select id="kn-qc-count" className="kn-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{tParts("channels.quick.times", { count: n })}</option>)}
                            </select>
                        </div>
                    )}
                </div>
                {eventsPossible && (
                    <div className="kn-qc-event">
                        <SwitchRow
                            label={t("channels.quick.withEvent")}
                            tip={t("channels.quick.withEventTip")}
                            checked={withEvent}
                            onChange={setWithEvent}
                        />
                        {eventOn && (
                            <>
                                <input
                                    aria-label={t("channels.quick.time")}
                                    className="kn-select kn-qc-time"
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                />
                                <Badge
                                    tone={defaults?.templateId ? "accent" : "mid"}
                                    tip={defaults?.templateId ? t("channels.quick.templateTip", { name: defaults.templateName }) : t("channels.quick.noTemplateTip")}
                                    tipSub={defaults?.templateId
                                        ? t("channels.quick.templateSub", { source: SOURCE_LABELS[defaults.source] })
                                        : t("channels.quick.noTemplateSub", { source: SOURCE_LABELS[defaults?.source || "raidhelper"] })}
                                >
                                    {defaults?.templateName || t("channels.quick.noTemplate")} · {SOURCE_LABELS[defaults?.source || "raidhelper"]}
                                </Badge>
                            </>
                        )}
                    </div>
                )}
                {planError && <Badge tone="bad">{planError}</Badge>}
                {naming && !planError && <div className="kn-naming"><NamingBadge naming={naming} /></div>}
                <div className="kn-preview" aria-live="polite">
                    {plan.map((p, i) => (
                        <div key={`${p.date}-${i}`} className="kn-preview-row">
                            <span className="kn-type"><ChannelsIcon /></span>
                            <span className="kn-preview-name">{p.name || "—"}</span>
                            {p.exists && <Badge tone="mid" tip={t("channels.quick.existsTip")} tipSub={t("channels.quick.existsSub")}>{t("channels.exists")}</Badge>}
                        </div>
                    ))}
                </div>
                <details className="kn-details">
                    <summary className="kn-kicker">{t("channels.quick.schemaTemplate")}</summary>
                    <div className="kn-dlg-stack">
                        <div className="kn-grid2">
                            <div className="kn-field">
                                <label htmlFor="kn-qc-schema">{t("channels.namingSchema")}</label>
                                <div className="kn-input"><input id="kn-qc-schema" type="text" value={schema} onChange={(e) => setSchema(e.target.value)} placeholder={t("channels.schemaPlaceholder")} /></div>
                            </div>
                            <div className="kn-field">
                                <label htmlFor="kn-qc-raid">{t("channels.raid")}</label>
                                <div className="kn-input"><input id="kn-qc-raid" type="text" value={raid} onChange={(e) => setRaid(e.target.value)} placeholder={t("channels.raidPlaceholder")} /></div>
                            </div>
                        </div>
                        <PlaceholderChips data={data} onPick={(key) => setSchema((s) => `${s}{${key}}`)} />
                        <div className="kn-field">
                            <label htmlFor="kn-qc-tpl">
                                <span className="tipped" tabIndex={0} data-tip={t("channels.templateChannel")} data-tip-sub={t("channels.quick.templateChannelSub")}>{t("channels.templateChannel")}</span>
                                <span className="kn-opt">{t("channels.optional")}</span>
                            </label>
                            <select id="kn-qc-tpl" className="kn-select" value={templateChannelId} onChange={(e) => setTemplate(e.target.value)}>
                                <option value="">{categoryId ? t("channels.likeLastEventChannel") : t("channels.quick.noTemplateOption")}</option>
                                {templates.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` (${c.category})` : ""}</option>)}
                            </select>
                        </div>
                        {categoryId && (
                            <label className="kn-check">
                                <input type="checkbox" className="kn-cb" checked={saveSchema} onChange={(e) => setSaveSchema(e.target.checked)} />
                                {tParts("channels.quick.remember", { name: categoryName })}
                            </label>
                        )}
                    </div>
                </details>
            </div>
        </Modal>
    );
}
