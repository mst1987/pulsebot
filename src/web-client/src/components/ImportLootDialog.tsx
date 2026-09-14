// "Loot importieren" as a dialog from the page head (design issue #225) — it
// used to be a whole tab with six help paragraphs.
//
// Ordered by what the admin has first: the export (pasted or from a file), then
// what it was recognised as, then the event it goes to. The preview under the
// text field comes from POST /api/history/import-preview, which runs the import's
// own parser, raid derivation and date match without storing anything — so the
// "32 Items importieren" on the button is the number the import will report.
import { useEffect, useRef, useState } from "react";
import {
    importLoot, previewLootImport,
    type ApiError, type HistoryData, type ImportPreview,
} from "../api";
import { formatEventTime } from "../lib/format";
import { useDraftState } from "../lib/persistedState";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import Segment from "./ui/Segment";
import Expand from "./ui/Expand";
import IconTile from "./ui/IconTile";
import { useToast } from "./Jobs";
import { InfoTip } from "./LootFilters";
import { contentIcon } from "./LootBadges";

// Everything typed into the import form. Kept as a draft (see useDraftState), so
// a pasted export survives closing the dialog and a detour to another page —
// re-pasting it is the one step nobody can redo from memory.
type ImportDraft = { eventId: string; manualLabel: string; categoryId: string; tool: string; text: string };
const IMPORT_DRAFT_DEFAULT: ImportDraft = { eventId: "__auto__", manualLabel: "", categoryId: "", tool: "auto", text: "" };

type Tool = "auto" | "gargul" | "rclc" | "eventhelper";
const TOOL_OPTIONS: { value: Tool; label: string; icon?: string; tip?: string }[] = [
    { value: "auto", label: "Automatisch", tip: "JSON = RCLootcouncil, CSV = Gargul, Envelope = EventHelper-Addon" },
    { value: "gargul", label: "Gargul" },
    { value: "rclc", label: "RCLootcouncil" },
    { value: "eventhelper", label: "EventHelper-Addon", icon: "inv_misc_enggizmos_27" },
];

// How long the text has to rest before the preview is asked for.
const PREVIEW_DELAY_MS = 350;

export function ImportLootDialog({ open, onClose, data, csrfToken, onImported }: {
    open: boolean;
    onClose: () => void;
    data: HistoryData;
    csrfToken: string | null;
    onImported: (msg: string) => void;
}) {
    // categoryId is only used when the import lands without a Raid-Helper event:
    // a real event brings its own Discord category along (see api.ts's
    // ImportLootInput).
    const [draft, patch] = useDraftState<ImportDraft>("history-import", IMPORT_DRAFT_DEFAULT);
    const { eventId, manualLabel, categoryId, tool, text } = draft;
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [previewError, setPreviewError] = useState("");
    const toast = useToast();
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        if (!text.trim()) { setPreview(null); setPreviewError(""); return undefined; }
        let cancelled = false;
        const handle = setTimeout(() => {
            previewLootImport(csrfToken, { data: text, tool, event: eventId })
                .then((p) => { if (!cancelled) { setPreview(p); setPreviewError(""); } })
                .catch((err: ApiError) => { if (!cancelled) { setPreview(null); setPreviewError(err.message); } });
        }, PREVIEW_DELAY_MS);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [open, text, tool, eventId, csrfToken]);

    const selectEvent = (id: string) => {
        const ev = data.events.find((e) => e.id === id);
        const preferred = ev ? (data.categoryLootTool[ev.categoryId || ""] || "") : "";
        patch(preferred ? { eventId: id, tool: preferred } : { eventId: id });
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => patch({ text: String(reader.result || "") });
        reader.readAsText(file);
    };

    const submit = async () => {
        setBusy(true);
        try {
            const r = await importLoot(csrfToken, { data: text, tool, event: eventId, manualLabel, categoryId });
            onImported(`${r.added} Item(s) importiert${r.skipped ? ` · ${r.skipped} Duplikat(e) übersprungen` : ""} · ${r.eventLabel}`);
            // Only the imported content goes — the event and tool choice stay, the
            // next import of the evening usually belongs to the same raid.
            patch({ text: "", manualLabel: "" });
            if (fileRef.current) fileRef.current.value = "";
            onClose();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const match = preview?.match;
    const suggested = match?.suggested || null;
    const candidates = match?.ambiguous ? match.candidates : (suggested ? [suggested] : []);
    const manual = eventId === "__manual__";
    // "__auto__" means: the suggestion — its card is the checked one.
    const checkedId = eventId === "__auto__" ? (suggested?.id || "") : eventId;
    const inList = data.events.some((ev) => ev.id === eventId);
    const toImport = preview ? Math.max(0, preview.count - preview.duplicates) : 0;
    const canSubmit = !!text.trim() && !busy && !(eventId === "__auto__" && match?.ambiguous);

    return (
        <Modal
            open={open}
            onClose={onClose}
            initialFocus="#import-text"
            width={740}
            icon="inv_scroll_03"
            tone="history"
            kicker="RCLootcouncil, Gargul oder EventHelper-Addon"
            title="Loot importieren"
            hint="Der Entwurf bleibt erhalten, wenn du das Fenster schließt."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button onClick={submit} disabled={!canSubmit} running={busy}>
                        {preview ? `${toImport} Item${toImport === 1 ? "" : "s"} importieren` : "Loot importieren"}
                    </Button>
                </>
            )}
        >
            <div className="hl-field">
                <label className="hl-lbl" htmlFor="import-text">Export</label>
                <div className="hl-drop">
                    <textarea
                        id="import-text" value={text} rows={6}
                        onChange={(e) => patch({ text: e.target.value })}
                        placeholder="RCLootcouncil-JSON, Gargul-CSV oder EventHelper-Addon-Export hier einfügen …"
                    />
                    <div className="hl-drop-foot">
                        {preview && (
                            <>
                                <Badge tone="ok" icon="inv_misc_bag_10">{preview.count} Items erkannt</Badge>
                                <Badge>{preview.formatLabel}</Badge>
                                {preview.content.label && (
                                    <Badge tone="accent" icon={contentIcon(preview.content.contentIds[0])} tip="Raid aus den Items" tipSub={`${preview.content.matched} von ${preview.count} Items einem Raid zugeordnet.`}>
                                        {preview.content.label}
                                    </Badge>
                                )}
                                {preview.duplicates > 0 && (
                                    <Badge tone="mid" count tip="Duplikate" tipSub="Diese Zeilen liegen im Ziel-Event schon vor und werden übersprungen.">
                                        {preview.duplicates} Duplikat{preview.duplicates === 1 ? "" : "e"}
                                    </Badge>
                                )}
                            </>
                        )}
                        {!preview && previewError && <Badge tone="bad" tip="Nicht lesbar" tipSub={previewError}>Export nicht lesbar</Badge>}
                        {!preview && !previewError && <span className="muted">Die Vorschau erscheint, sobald ein Export eingefügt ist.</span>}
                        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>Datei wählen</Button>
                        <input ref={fileRef} type="file" accept=".json,.csv,.txt,.tsv" onChange={onFile} hidden />
                    </div>
                </div>
            </div>

            <div className="hl-field">
                <span className="hl-lbl">
                    Format
                    <InfoTip tip="Format" sub="Wird aus der Kategorie des Events vorbelegt. „Automatisch“ erkennt alle drei Formate selbst: JSON = RCLootcouncil, CSV = Gargul, Envelope = EventHelper-Addon." />
                </span>
                <div><Segment<Tool> ariaLabel="Format" options={TOOL_OPTIONS} value={(TOOL_OPTIONS.some((o) => o.value === tool) ? tool : "auto") as Tool} onChange={(v) => patch({ tool: v })} /></div>
            </div>

            <div className="hl-field">
                <span className="hl-lbl">
                    Event
                    <InfoTip
                        tip="Zuordnung nach Datum"
                        sub="Vorgeschlagen wird das Raid-Helper-Event am Tag des Exports. Gibt es keins oder mehrere, wählst du selbst — ohne Event bekommt der Loot einen eigenen Titel und eine Kategorie."
                    />
                </span>
                {candidates.length > 0 && (
                    <div className={candidates.length > 1 ? "hl-radio-grid" : "hl-radio-list"} role="radiogroup" aria-label="Event">
                        {candidates.map((c) => {
                            const on = !manual && checkedId === c.id;
                            return (
                                <button key={c.id} type="button" role="radio" aria-checked={on} className={`hl-radio${on ? " on" : ""}`} onClick={() => selectEvent(c.id)}>
                                    <span className="dot" aria-hidden="true" />
                                    <IconTile icon="inv_misc_note_02" tone={on ? undefined : "none"} />
                                    <span className="txt">
                                        <b>{c.title || c.id}</b>
                                        <small>{c.startTime ? formatEventTime(Math.round(c.startTime / 1000)) : ""}</small>
                                    </span>
                                    {!match?.ambiguous && <Badge tone="ok">passt zum Datum</Badge>}
                                </button>
                            );
                        })}
                    </div>
                )}
                {match?.ambiguous && eventId === "__auto__" && (
                    <Badge tone="bad">{candidates.length} Raids an diesem Tag — bitte eins wählen</Badge>
                )}
                {preview && !candidates.length && !manual && !inList && (
                    <Badge tone="mid" tip="Kein Event gefunden" tipSub="Ohne Auswahl bekommt der Loot den Titel „Raid vom …“ nach dem Datum im Export.">Kein Event an diesem Tag</Badge>
                )}
                <div className="hl-row-inline">
                    <select aria-label="Anderes Event wählen" value={inList && !candidates.some((c) => c.id === eventId) ? eventId : ""} onChange={(e) => selectEvent(e.target.value || "__auto__")}>
                        <option value="">Anderes Event wählen …</option>
                        {data.events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.title || "(ohne Titel)"}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                            </option>
                        ))}
                    </select>
                    <Expand open={manual} onToggle={() => patch({ eventId: manual ? "__auto__" : "__manual__" })} label="Ohne Event" />
                </div>
                {manual && (
                    <div className="hl-manual">
                        <input type="text" aria-label="Titel" value={manualLabel} onChange={(e) => patch({ manualLabel: e.target.value })} placeholder="Titel, z.B. SSC/TK — 12.07.2026" />
                        <select
                            aria-label="Kategorie" value={categoryId} onChange={(e) => patch({ categoryId: e.target.value })}
                            data-tip="Kategorie"
                            data-tip-sub="Ohne Event fehlt dem Loot sonst die Kategorie (Pug, Montagsraid, …) und er taucht in den nach Kategorie gruppierten Übersichten nicht auf."
                        >
                            <option value="">Keine Kategorie</option>
                            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}
            </div>
        </Modal>
    );
}
