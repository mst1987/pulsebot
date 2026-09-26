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
} from "../../api";
import { formatEventTime } from "../../lib/format";
import { useDraftState } from "../../lib/persistedState";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Segment from "../../components/ui/Segment";
import Expand from "../../components/ui/Expand";
import IconTile from "../../components/ui/IconTile";
import { useToast } from "../../components/Jobs";
import { InfoTip } from "../../components/loot/LootFilters";
import { contentIcon } from "../../components/loot/LootBadges";
import { tParts, useT, type TFunction } from "../../i18n";

// Everything typed into the import form. Kept as a draft (see useDraftState), so
// a pasted export survives closing the dialog and a detour to another page —
// re-pasting it is the one step nobody can redo from memory.
type ImportDraft = { eventId: string; manualLabel: string; categoryId: string; tool: string; text: string };
const IMPORT_DRAFT_DEFAULT: ImportDraft = { eventId: "__auto__", manualLabel: "", categoryId: "", tool: "auto", text: "" };

type Tool = "auto" | "gargul" | "rclc" | "eventhelper";
const TOOLS: Tool[] = ["auto", "gargul", "rclc", "eventhelper"];

/** The format choices, in the active language (a function, never a module-level table). */
function toolOptions(t: TFunction): { value: Tool; label: string; icon?: string; tip?: string }[] {
    return [
        { value: "auto", label: t("history.import.toolAuto"), tip: t("history.import.toolAutoTip") },
        { value: "gargul", label: "Gargul" },
        { value: "rclc", label: "RCLootcouncil" },
        { value: "eventhelper", label: t("history.import.toolAddon"), icon: "inv_misc_enggizmos_27" },
    ];
}

// How long the text has to rest before the preview is asked for.
const PREVIEW_DELAY_MS = 350;

export function ImportLootDialog({ open, onClose, data, onImported }: {
    open: boolean;
    onClose: () => void;
    data: HistoryData;
    onImported: (msg: string) => void;
}) {
    const t = useT();
    // categoryId is only used when the import lands without a Raid-Helper event:
    // a real event brings its own Discord category along (see api/loot.ts's
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
            previewLootImport({ data: text, tool, event: eventId })
                .then((p) => { if (!cancelled) { setPreview(p); setPreviewError(""); } })
                .catch((err: ApiError) => { if (!cancelled) { setPreview(null); setPreviewError(err.message); } });
        }, PREVIEW_DELAY_MS);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [open, text, tool, eventId]);

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
            const r = await importLoot({ data: text, tool, event: eventId, manualLabel, categoryId });
            onImported(r.skipped
                ? t("history.import.importedSkipped", { count: r.added, skipped: r.skipped, event: r.eventLabel })
                : t("history.import.imported", { count: r.added, event: r.eventLabel }));
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

    const tools = toolOptions(t);

    return (
        <Modal
            open={open}
            onClose={onClose}
            initialFocus="#import-text"
            width={740}
            icon="inv_scroll_03"
            tone="history"
            kicker={t("history.import.kicker")}
            title={t("history.page.import")}
            hint={t("history.import.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button onClick={submit} disabled={!canSubmit} running={busy}>
                        {preview ? t("history.import.submitCount", { count: toImport }) : t("history.page.import")}
                    </Button>
                </>
            )}
        >
            <div className="hl-field">
                <label className="hl-lbl" htmlFor="import-text">{t("history.import.exportLabel")}</label>
                <div className="hl-drop">
                    <textarea
                        id="import-text" value={text} rows={6}
                        onChange={(e) => patch({ text: e.target.value })}
                        placeholder={t("history.import.placeholder")}
                    />
                    <div className="hl-drop-foot">
                        {preview && (
                            <>
                                <Badge tone="ok" icon="inv_misc_bag_10">{tParts("history.import.recognized", { count: preview.count })}</Badge>
                                <Badge>{preview.formatLabel}</Badge>
                                {preview.content.label && (
                                    <Badge tone="accent" icon={contentIcon(preview.content.contentIds[0])} tip={t("history.import.raidTip")} tipSub={t("history.import.raidSub", { matched: preview.content.matched, count: preview.count })}>
                                        {preview.content.label}
                                    </Badge>
                                )}
                                {preview.duplicates > 0 && (
                                    <Badge tone="mid" count tip={t("history.import.dupTip")} tipSub={t("history.import.dupSub")}>
                                        {t("history.import.dups", { count: preview.duplicates })}
                                    </Badge>
                                )}
                            </>
                        )}
                        {!preview && previewError && <Badge tone="bad" tip={t("history.import.unreadableTip")} tipSub={previewError}>{t("history.import.unreadable")}</Badge>}
                        {!preview && !previewError && <span className="muted">{t("history.import.previewHint")}</span>}
                        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>{t("history.import.chooseFile")}</Button>
                        <input ref={fileRef} type="file" accept=".json,.csv,.txt,.tsv" onChange={onFile} hidden />
                    </div>
                </div>
            </div>

            <div className="hl-field">
                <span className="hl-lbl">
                    {t("history.import.format")}
                    <InfoTip tip={t("history.import.format")} sub={t("history.import.formatSub")} />
                </span>
                <div><Segment<Tool> ariaLabel={t("history.import.format")} options={tools} value={(TOOLS.includes(tool as Tool) ? tool : "auto") as Tool} onChange={(v) => patch({ tool: v })} /></div>
            </div>

            <div className="hl-field">
                <span className="hl-lbl">
                    {t("history.import.event")}
                    <InfoTip
                        tip={t("history.import.matchTip")}
                        sub={t("history.import.matchSub")}
                    />
                </span>
                {candidates.length > 0 && (
                    <div className={candidates.length > 1 ? "hl-radio-grid" : "hl-radio-list"} role="radiogroup" aria-label={t("history.import.event")}>
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
                                    {!match?.ambiguous && <Badge tone="ok">{t("history.import.fitsDate")}</Badge>}
                                </button>
                            );
                        })}
                    </div>
                )}
                {match?.ambiguous && eventId === "__auto__" && (
                    <Badge tone="bad">{tParts("history.import.ambiguous", { count: candidates.length })}</Badge>
                )}
                {preview && !candidates.length && !manual && !inList && (
                    <Badge tone="mid" tip={t("history.import.noEventTip")} tipSub={t("history.import.noEventSub")}>{t("history.shared.noEvent")}</Badge>
                )}
                <div className="hl-row-inline">
                    <select aria-label={t("history.import.otherAria")} value={inList && !candidates.some((c) => c.id === eventId) ? eventId : ""} onChange={(e) => selectEvent(e.target.value || "__auto__")}>
                        <option value="">{t("history.import.otherOption")}</option>
                        {data.events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.title || t("history.shared.untitled")}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                            </option>
                        ))}
                    </select>
                    <Expand open={manual} onToggle={() => patch({ eventId: manual ? "__auto__" : "__manual__" })} label={t("history.import.withoutEvent")} />
                </div>
                {manual && (
                    <div className="hl-manual">
                        <input type="text" aria-label={t("history.shared.titleAria")} value={manualLabel} onChange={(e) => patch({ manualLabel: e.target.value })} placeholder={t("history.import.titlePlaceholder")} />
                        <select
                            aria-label={t("history.shared.category")} value={categoryId} onChange={(e) => patch({ categoryId: e.target.value })}
                            data-tip={t("history.shared.category")}
                            data-tip-sub={t("history.import.categorySub")}
                        >
                            <option value="">{t("history.shared.noCategory")}</option>
                            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}
            </div>
        </Modal>
    );
}
