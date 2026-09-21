import { useEffect, useState } from "react";
import {
    quickCreateChannels, saveChannelSchema, type ApiError, type ChannelNaming, type ChannelsData, type QuickCreatePlanRow,
} from "../../api";
import NamingBadge from "./NamingBadge";
import { Badge, Button, Modal } from "../ui";
import { ChannelsIcon } from "../icons";
import { useToast } from "../Jobs";
import { PlaceholderChips } from "./ChannelBulk";
import { isTextLike, ownSchemaOf } from "../../lib/channels";

// A category's naming schema on its own place (the pencil on the category head
// of the Kanäle page) — before, it could only be stored as a side effect of
// quick-create's "merken". Empty = new channels are named like the category's
// latest event channel (#285). The preview shows the next three weekly names
// exactly as the server would make them (quick-create's dry run); nothing is
// created here.

/** Today in the browser's calendar, as "2026-09-16". */
function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CategorySchemaDialog({ data, csrfToken, categoryId, onClose, onSaved }: {
    data: ChannelsData;
    csrfToken: string | null;
    categoryId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const toast = useToast();
    const stored = data.schemas?.[categoryId];
    // The default schema stored by an old quick-create is no schema of the category's own.
    const [schema, setSchema] = useState(ownSchemaOf(data, categoryId));
    const [raid, setRaid] = useState(stored?.raid || "");
    const [templateChannelId, setTemplate] = useState(stored?.templateChannelId || "");
    const [plan, setPlan] = useState<QuickCreatePlanRow[]>([]);
    const [naming, setNaming] = useState<ChannelNaming | null>(null);
    const [planError, setPlanError] = useState("");
    const [saving, setSaving] = useState(false);
    const categoryName = data.categories.find((c) => c.id === categoryId)?.name || "Kategorie";
    const archiveId = data.archive?.categoryId || "";
    const templates = data.channels.filter((c) => isTextLike(c) && c.parentId !== archiveId);

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            quickCreateChannels(csrfToken, {
                categoryId, schema, raid, from: today(), count: 3, interval: "weekly", templateChannelId, dryRun: true, ignoreStoredSchema: true,
            })
                .then((r) => { if (alive) { setPlan(r.plan); setNaming(r.naming || null); setPlanError(""); } })
                .catch((err: ApiError) => { if (alive) { setPlan([]); setNaming(null); setPlanError(err.message); } });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [csrfToken, categoryId, schema, raid, templateChannelId]);

    const save = async () => {
        setSaving(true);
        try {
            await saveChannelSchema(csrfToken, { categoryId, schema: schema.trim(), raid: raid.trim(), templateChannelId });
            toast(schema.trim() ? `${categoryName}: Namensschema gespeichert.` : `${categoryName}: Namen wieder wie der letzte Event-Kanal.`);
            onSaved();
        } catch (err) {
            toast((err as ApiError).message, "err");
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker={categoryName}
            title="Namensschema"
            width={560}
            initialFocus="#kn-cs-schema"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon="inv_letter_15" disabled={saving || !!planError} onClick={save}>Speichern</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-field">
                    <label htmlFor="kn-cs-schema">
                        <span
                            className="tipped"
                            tabIndex={0}
                            data-tip="Namensschema"
                            data-tip-sub="Gilt für jeden neuen Event-Kanal dieser Kategorie – Event anlegen im Web und im Bot, Schnell anlegen, /kanal anlegen. Leer: wie der letzte Event-Kanal, nur Datum, Wochentag und Raid werden ersetzt."
                        >
                            Schema
                        </span>
                    </label>
                    <div className="kn-input">
                        <input id="kn-cs-schema" type="text" value={schema} onChange={(e) => setSchema(e.target.value)} placeholder="leer = wie der letzte Event-Kanal" />
                    </div>
                </div>
                <PlaceholderChips data={data} onPick={(key) => setSchema((s) => `${s}{${key}}`)} />
                {planError && <Badge tone="bad">{planError}</Badge>}
                {naming && !planError && <div className="kn-naming"><NamingBadge naming={naming} /></div>}
                <div className="kn-preview" aria-live="polite" aria-label="Die nächsten Namen">
                    {plan.map((p, i) => (
                        <div key={`${p.date}-${i}`} className="kn-preview-row">
                            <span className="kn-type"><ChannelsIcon /></span>
                            <span className="kn-preview-name">{p.name || "—"}</span>
                        </div>
                    ))}
                </div>
                <details className="kn-details">
                    <summary className="kn-kicker">Raid &amp; Vorlage</summary>
                    <div className="kn-grid2">
                        <div className="kn-field">
                            <label htmlFor="kn-cs-raid">
                                <span className="tipped" tabIndex={0} data-tip="Raid" data-tip-sub="Für {raid}, wenn das Event selbst keinen Raid mitbringt (Schnell anlegen).">Raid</span>
                                <span className="kn-opt">optional</span>
                            </label>
                            <div className="kn-input"><input id="kn-cs-raid" type="text" value={raid} onChange={(e) => setRaid(e.target.value)} placeholder="z.B. ssc-tk" /></div>
                        </div>
                        <div className="kn-field">
                            <label htmlFor="kn-cs-tpl">
                                <span className="tipped" tabIndex={0} data-tip="Vorlage-Kanal" data-tip-sub="Neue Kanäle übernehmen Rechte, Thema und Slowmode dieses Kanals. Ohne Auswahl sind sie eine Kopie des letzten Event-Kanals der Kategorie.">Vorlage-Kanal</span>
                                <span className="kn-opt">optional</span>
                            </label>
                            <select id="kn-cs-tpl" className="kn-select" value={templateChannelId} onChange={(e) => setTemplate(e.target.value)}>
                                <option value="">— wie der letzte Event-Kanal —</option>
                                {templates.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` (${c.category})` : ""}</option>)}
                            </select>
                        </div>
                    </div>
                </details>
            </div>
        </Modal>
    );
}
