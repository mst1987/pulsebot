import { useEffect, useState } from "react";
import {
    quickCreateChannels, type ApiError, type ChannelsData, type QuickCreateInput, type QuickCreatePlanRow,
} from "../../api";
import { Badge, Button, Modal, Segment } from "../ui";
import { ChannelsIcon } from "../icons";
import { SwitchRow } from "../RaidPlanFields";
import { PlaceholderChips } from "./ChannelBulk";
import { isTextLike } from "../../lib/channels";

const SOURCE_LABELS = { raidhelper: "Raid-Helper", eventhelper: "EventHelper" } as const;
const DEFAULT_EVENT_TIME = "19:30";

// Quick-create by naming schema (issue #259, artboard "Kanäle anlegen"): pick
// the category, the first day and how often; the preview shows every name the
// schema makes and which of them exist already — those are skipped, never
// duplicated. Schema, raid and template channel are remembered per category.
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

export function QuickCreateDialog({ data, csrfToken, initialCategoryId, onClose, onCreate }: {
    data: ChannelsData;
    csrfToken: string | null;
    initialCategoryId?: string;
    onClose: () => void;
    /** Runs the creation (as a job) with the final input. */
    onCreate: (input: QuickCreateInput, count: number) => void;
}) {
    const archiveId = data.archive?.categoryId || "";
    const categories = data.categories.filter((c) => c.id !== archiveId);
    const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || "");
    const stored = data.schemas?.[categoryId];
    const [mode, setMode] = useState<"once" | "weekly">("weekly");
    const [from, setFrom] = useState(today());
    const [count, setCount] = useState(4);
    const [schema, setSchema] = useState(stored?.schema || data.defaultSchema);
    const [raid, setRaid] = useState(stored?.raid || "");
    const [templateChannelId, setTemplate] = useState(stored?.templateChannelId || "");
    const [saveSchema, setSaveSchema] = useState(true);
    const [withEvent, setWithEvent] = useState(false);
    const [time, setTime] = useState(stored?.time || DEFAULT_EVENT_TIME);
    const [plan, setPlan] = useState<QuickCreatePlanRow[]>([]);
    const [planError, setPlanError] = useState("");

    // Switching the category loads what that category remembered.
    const pickCategory = (id: string) => {
        setCategoryId(id);
        const own = data.schemas?.[id];
        setSchema(own?.schema || data.defaultSchema);
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
            quickCreateChannels(csrfToken, { ...input, dryRun: true })
                .then((r) => { if (alive) { setPlan(r.plan); setPlanError(""); } })
                .catch((err: ApiError) => { if (alive) { setPlan([]); setPlanError(err.message); } });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [csrfToken, categoryId, schema, raid, from, count, mode]);

    const todo = plan.filter((p) => !p.exists).length;
    const categoryName = categories.find((c) => c.id === categoryId)?.name || "Ohne Kategorie";
    const templates = data.channels.filter((c) => isTextLike(c) && c.parentId !== archiveId);

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker={`${categoryName} · nach Schema`}
            title="Kanäle anlegen"
            width={620}
            initialFocus="#kn-qc-from"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon="inv_letter_15" disabled={!todo || (eventOn && !time)} onClick={() => onCreate(input, todo)}>{todo} anlegen</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-qc-head">
                    <select aria-label="Kategorie" className="kn-select" value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
                        <option value="">— keine Kategorie —</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Segment<"once" | "weekly">
                        ariaLabel="Einzeln oder Serie"
                        size="sm"
                        value={mode}
                        onChange={setMode}
                        options={[{ value: "once", label: "Einzeln" }, { value: "weekly", label: "Serie" }]}
                    />
                </div>
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-qc-from">{mode === "weekly" ? "Ab" : "Am"}</label>
                        <input id="kn-qc-from" className="kn-select" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </div>
                    {mode === "weekly" && (
                        <div className="kn-field">
                            <label htmlFor="kn-qc-count">Wie oft</label>
                            <select id="kn-qc-count" className="kn-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} × wöchentlich</option>)}
                            </select>
                        </div>
                    )}
                </div>
                {eventsPossible && (
                    <div className="kn-qc-event">
                        <SwitchRow
                            label="Gleich Event anlegen"
                            tip="Jeder neue Kanal bekommt an seinem Tag ein Event – mit der Standard-Vorlage und der Anmeldung der Kategorie."
                            checked={withEvent}
                            onChange={setWithEvent}
                        />
                        {eventOn && (
                            <>
                                <input
                                    aria-label="Uhrzeit"
                                    className="kn-select kn-qc-time"
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                />
                                <Badge
                                    tone={defaults?.templateId ? "accent" : "mid"}
                                    tip={defaults?.templateId ? `Vorlage: ${defaults.templateName}` : "Ohne Vorlage"}
                                    tipSub={defaults?.templateId
                                        ? `Größe, Tanks/Heiler und Anmeldeschluss kommen aus der Standard-Vorlage der Kategorie. Anmeldung über ${SOURCE_LABELS[defaults.source]}. Ändern: Einstellungen → Kategorien.`
                                        : `Die Kategorie hat keine Standard-Vorlage – das Event bekommt die Werte des Regelsatzes. Anmeldung über ${SOURCE_LABELS[defaults?.source || "raidhelper"]}. Festlegen: Einstellungen → Kategorien.`}
                                >
                                    {defaults?.templateName || "ohne Vorlage"} · {SOURCE_LABELS[defaults?.source || "raidhelper"]}
                                </Badge>
                            </>
                        )}
                    </div>
                )}
                {planError && <Badge tone="bad">{planError}</Badge>}
                <div className="kn-preview" aria-live="polite">
                    {plan.map((p, i) => (
                        <div key={`${p.date}-${i}`} className="kn-preview-row">
                            <span className="kn-type"><ChannelsIcon /></span>
                            <span className="kn-preview-name">{p.name || "—"}</span>
                            {p.exists && <Badge tone="mid" tip="Existiert schon" tipSub="Ein Kanal mit diesem Namen ist schon da (oder kommt in dieser Serie zweimal vor) — er wird übersprungen.">existiert</Badge>}
                        </div>
                    ))}
                </div>
                <details className="kn-details">
                    <summary className="kn-kicker">Schema &amp; Vorlage</summary>
                    <div className="kn-dlg-stack">
                        <div className="kn-grid2">
                            <div className="kn-field">
                                <label htmlFor="kn-qc-schema">Namensschema</label>
                                <div className="kn-input"><input id="kn-qc-schema" type="text" value={schema} onChange={(e) => setSchema(e.target.value)} /></div>
                            </div>
                            <div className="kn-field">
                                <label htmlFor="kn-qc-raid">Raid</label>
                                <div className="kn-input"><input id="kn-qc-raid" type="text" value={raid} onChange={(e) => setRaid(e.target.value)} placeholder="z.B. ssc-tk" /></div>
                            </div>
                        </div>
                        <PlaceholderChips data={data} onPick={(key) => setSchema((s) => `${s}{${key}}`)} />
                        <div className="kn-field">
                            <label htmlFor="kn-qc-tpl">
                                <span className="tipped" tabIndex={0} data-tip="Vorlage-Kanal" data-tip-sub="Die neuen Kanäle übernehmen Rechte, Thema und Slowmode dieses Kanals. Ohne Vorlage entstehen einfache Text-Kanäle.">Vorlage-Kanal</span>
                                <span className="kn-opt">optional</span>
                            </label>
                            <select id="kn-qc-tpl" className="kn-select" value={templateChannelId} onChange={(e) => setTemplate(e.target.value)}>
                                <option value="">— keine Vorlage —</option>
                                {templates.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` (${c.category})` : ""}</option>)}
                            </select>
                        </div>
                        {categoryId && (
                            <label className="kn-check">
                                <input type="checkbox" className="kn-cb" checked={saveSchema} onChange={(e) => setSaveSchema(e.target.checked)} />
                                Schema, Raid und Vorlage für „{categoryName}“ merken
                            </label>
                        )}
                    </div>
                </details>
            </div>
        </Modal>
    );
}
