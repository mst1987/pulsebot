import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
    renamePreview, type ApiError, type Channel, type ChannelChanges, type ChannelsData, type RenamePreviewRow,
} from "../../api";
import { Badge, Button, IconButton, Modal } from "../ui";
import { XIcon } from "../icons";
import { PencilIcon } from "./channelBits";
import NamingBadge from "./NamingBadge";
import { bulkChanges, KEEP, placeholderHint, SLOWMODE_OPTIONS, slowmodeLabel } from "../../lib/channels";
import { tParts, useT } from "../../i18n";

// Several channels at once (issue #259): the bar that appears at the bottom as
// soon as something is selected, the "only what you change" edit dialog behind
// its "Kategorie …" / "Thema …" buttons, and "Umbenennen nach Schema …".

export function BulkBar({ count, guildName, archiveLabel, onEdit, onRename, onArchive, onDelete, onClear }: {
    count: number;
    guildName: string;
    /** "Archivieren" in the tree, "Löschen …" in the archive tab. */
    archiveLabel?: string;
    onEdit?: (focus: "category" | "topic") => void;
    onRename?: () => void;
    onArchive: () => void;
    /** The tree's "Löschen …" beside "Archivieren" — deleting for good, asked for by name. */
    onDelete?: () => void;
    onClear: () => void;
}) {
    const t = useT();
    if (!count) return null;
    const deleting = !onEdit;
    return (
        <div className="kn-bulk" role="toolbar" aria-label={t("channels.bulk.toolbar")}>
            <span className="kn-bulk-sel">
                <span className="kn-bulk-count">{tParts("channels.bulk.selected", { count })}</span>
                {guildName && <span className="kn-kicker">{guildName}</span>}
            </span>
            {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit("category")}>{t("channels.bulk.category")}</Button>}
            {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit("topic")}>{t("channels.bulk.topic")}</Button>}
            {onRename && <Button size="sm" variant="ghost" onClick={onRename}>{t("channels.bulk.renameSchema")}</Button>}
            {onDelete && <Button size="sm" variant="danger" onClick={onDelete}>{t("channels.bulk.delete")}</Button>}
            <Button size="sm" variant={deleting ? "danger" : "primary"} onClick={onArchive}>{archiveLabel || t("channels.bulk.archive")}</Button>
            <IconButton size="sm" icon={<XIcon />} tip={t("channels.bulk.clear")} onClick={onClear} />
        </div>
    );
}

/** The selected channels as small mono chips, at most eight and "+n". */
export function SelectionChips({ channels }: { channels: Channel[] }) {
    const shown = channels.slice(0, 8);
    return (
        <div className="kn-chips">
            {shown.map((c) => <Badge key={c.id}>#{c.name}</Badge>)}
            {channels.length > shown.length && <Badge count>+{channels.length - shown.length}</Badge>}
        </div>
    );
}

export function BulkEditDialog({ channels, data, focus, onClose, onApply }: {
    channels: Channel[];
    data: ChannelsData;
    focus: "category" | "topic";
    onClose: () => void;
    onApply: (changes: ChannelChanges) => void;
}) {
    const t = useT();
    const [parentId, setParentId] = useState(KEEP);
    const [topic, setTopic] = useState("");
    const [clearTopic, setClearTopic] = useState(false);
    const [slowmode, setSlowmode] = useState(KEEP);
    const changes = bulkChanges({ parentId, topic, clearTopic, slowmode });
    const n = Object.keys(changes).length;
    const archiveId = data.archive?.categoryId || "";

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (n) onApply(changes);
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={<PencilIcon />}
            tone="channels"
            kicker={t("channels.bulk.editKicker")}
            title={t("channels.bulk.editTitle", { count: channels.length })}
            width={600}
            initialFocus={focus === "topic" ? "#kn-bulk-topic" : "#kn-bulk-cat"}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-bulk" disabled={!n}>{t("common.apply")}</Button>
                </>
            )}
        >
            <form id="kn-bulk" className="kn-dlg-stack" onSubmit={submit}>
                <SelectionChips channels={channels} />
                <div className="kn-field">
                    <label htmlFor="kn-bulk-cat">{t("channels.category")}</label>
                    <select id="kn-bulk-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                        <option value={KEEP}>{t("channels.unchanged")}</option>
                        <option value="">{t("channels.noCategoryOption")}</option>
                        {data.categories.filter((c) => c.id !== archiveId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-bulk-topic">{t("channels.topic")}</label>
                    <div className="kn-input">
                        <input id="kn-bulk-topic" type="text" value={clearTopic ? "" : topic} disabled={clearTopic} maxLength={1024} onChange={(e) => setTopic(e.target.value)} placeholder={clearTopic ? t("channels.bulk.topicCleared") : t("channels.unchanged")} />
                    </div>
                    <label className="kn-check">
                        <input type="checkbox" className="kn-cb" checked={clearTopic} onChange={(e) => setClearTopic(e.target.checked)} />
                        {t("channels.bulk.clearTopic")}
                    </label>
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-bulk-slow">{t("channels.slowmode")}</label>
                    <select id="kn-bulk-slow" className="kn-select" value={slowmode} onChange={(e) => setSlowmode(e.target.value)}>
                        <option value={KEEP}>{t("channels.unchanged")}</option>
                        {SLOWMODE_OPTIONS.map((s) => <option key={s} value={String(s)}>{slowmodeLabel(s)}</option>)}
                    </select>
                </div>
            </form>
        </Modal>
    );
}

export function RenameSchemaDialog({ channels, data, onClose, onApply }: {
    channels: Channel[];
    data: ChannelsData;
    onClose: () => void;
    onApply: (rows: RenamePreviewRow[]) => void;
}) {
    // A selection from one category starts from that category's own schema;
    // without one the field stays empty, which names every channel like the
    // latest other event channel of its category (#285).
    const t = useT();
    const categoryIds = [...new Set(channels.map((c) => c.parentId))];
    const stored = categoryIds.length === 1 ? data.schemas?.[categoryIds[0]] : undefined;
    const ownSchema = stored?.schema && stored.schema !== data.defaultSchema ? stored.schema : "";
    const [schema, setSchema] = useState(ownSchema);
    const [raid, setRaid] = useState(stored?.raid || "");
    const [rows, setRows] = useState<RenamePreviewRow[] | null>(null);
    const [previewError, setPreviewError] = useState("");
    const ids = useMemo(() => channels.map((c) => c.id), [channels]);

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            renamePreview({ ids, schema, raid })
                .then((r) => { if (alive) { setRows(r.rows); setPreviewError(""); } })
                .catch((err: ApiError) => { if (alive) setPreviewError(err.message); });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [ids, schema, raid]);

    const todo = (rows || []).filter((r) => r.to && r.to !== r.from && !r.conflict);

    return (
        <Modal
            open
            onClose={onClose}
            icon={<PencilIcon />}
            tone="channels"
            kicker={t("channels.bulk.renameKicker")}
            title={t("channels.bulk.renameTitle", { count: channels.length })}
            width={640}
            initialFocus="#kn-rename-schema"
            hint={t("channels.bulk.renameHint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!todo.length} onClick={() => onApply(todo)}>{tParts("channels.bulk.renameSubmit", { count: todo.length })}</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-rename-schema">{t("channels.schema")}</label>
                        <div className="kn-input"><input id="kn-rename-schema" type="text" value={schema} onChange={(e) => setSchema(e.target.value)} placeholder={t("channels.schemaPlaceholder")} /></div>
                    </div>
                    <div className="kn-field">
                        <label htmlFor="kn-rename-raid">{t("channels.raid")}</label>
                        <div className="kn-input"><input id="kn-rename-raid" type="text" value={raid} onChange={(e) => setRaid(e.target.value)} placeholder={t("channels.raidPlaceholder")} /></div>
                    </div>
                </div>
                <PlaceholderChips data={data} onPick={(key) => setSchema((s) => `${s}{${key}}`)} />
                {previewError && <Badge tone="bad">{previewError}</Badge>}
                <div className="kn-preview" aria-live="polite">
                    {(rows || []).map((r) => (
                        <div key={r.id} className="kn-preview-row">
                            <span className="kn-preview-from">{r.from}</span>
                            <span className="kn-kicker">→</span>
                            <span className="kn-preview-name">{r.to || "—"}</span>
                            {r.conflict && <Badge tone="mid" tip={t("channels.bulk.conflictTip")} tipSub={t("channels.bulk.conflictSub")}>{t("channels.exists")}</Badge>}
                            {!r.conflict && r.to === r.from && <Badge>{t("channels.unchanged")}</Badge>}
                            {!r.conflict && r.to !== r.from && <NamingBadge naming={r.naming} short />}
                            {!r.hasDate && !schema.trim() && <Badge tip={t("channels.bulk.noEventTip")} tipSub={t("channels.bulk.noEventKeepSub")}>{t("channels.bulk.noDate")}</Badge>}
                            {!r.hasDate && /\{(tag|dd|mm|mon|yy|yyyy)\}/.test(schema) && <Badge tip={t("channels.bulk.noEventTip")} tipSub={t("channels.bulk.noEventEmptySub")}>{t("channels.bulk.noDate")}</Badge>}
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

/** The schema's placeholders as small buttons; a click appends one. */
export function PlaceholderChips({ data, onPick }: { data: ChannelsData; onPick: (key: string) => void }) {
    useT();
    return (
        <div className="kn-chips">
            {(data.placeholders || []).map((p) => (
                <button key={p.key} type="button" className="kn-ph" data-tip={`{${p.key}}`} data-tip-sub={placeholderHint(p)} onClick={() => onPick(p.key)}>
                    {`{${p.key}}`}
                </button>
            ))}
        </div>
    );
}
