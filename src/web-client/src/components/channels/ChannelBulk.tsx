import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
    renamePreview, type ApiError, type Channel, type ChannelChanges, type ChannelsData, type RenamePreviewRow,
} from "../../api";
import { Badge, Button, IconButton, Modal } from "../ui";
import { XIcon } from "../icons";
import { PencilIcon } from "./channelBits";
import { bulkChanges, KEEP, SLOWMODE_OPTIONS, slowmodeLabel } from "../../lib/channels";

// Several channels at once (issue #259): the bar that appears at the bottom as
// soon as something is selected, the "only what you change" edit dialog behind
// its "Kategorie …" / "Thema …" buttons, and "Umbenennen nach Schema …".

export function BulkBar({ count, guildName, archiveLabel, onEdit, onRename, onArchive, onClear }: {
    count: number;
    guildName: string;
    /** "Archivieren" in the tree, "Löschen …" in the archive tab. */
    archiveLabel?: string;
    onEdit?: (focus: "category" | "topic") => void;
    onRename?: () => void;
    onArchive: () => void;
    onClear: () => void;
}) {
    if (!count) return null;
    const deleting = !onEdit;
    return (
        <div className="kn-bulk" role="toolbar" aria-label="Auswahl bearbeiten">
            <span className="kn-bulk-count">{count} ausgewählt</span>
            {guildName && <span className="kn-kicker">{guildName}</span>}
            {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit("category")}>Kategorie …</Button>}
            {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit("topic")}>Thema …</Button>}
            {onRename && <Button size="sm" variant="ghost" onClick={onRename}>Umbenennen nach Schema …</Button>}
            <Button size="sm" variant={deleting ? "danger" : "primary"} onClick={onArchive}>{archiveLabel || "Archivieren"}</Button>
            <IconButton size="sm" icon={<XIcon />} tip="Auswahl aufheben" onClick={onClear} />
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
            kicker="nur geänderte Felder werden übernommen"
            title={`${channels.length} ${channels.length === 1 ? "Kanal" : "Kanäle"} bearbeiten`}
            width={600}
            initialFocus={focus === "topic" ? "#kn-bulk-topic" : "#kn-bulk-cat"}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-bulk" disabled={!n}>Übernehmen</Button>
                </>
            )}
        >
            <form id="kn-bulk" className="kn-dlg-stack" onSubmit={submit}>
                <SelectionChips channels={channels} />
                <div className="kn-field">
                    <label htmlFor="kn-bulk-cat">Kategorie</label>
                    <select id="kn-bulk-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                        <option value={KEEP}>unverändert</option>
                        <option value="">— keine Kategorie —</option>
                        {data.categories.filter((c) => c.id !== archiveId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-bulk-topic">Thema</label>
                    <div className="kn-input">
                        <input id="kn-bulk-topic" type="text" value={clearTopic ? "" : topic} disabled={clearTopic} maxLength={1024} onChange={(e) => setTopic(e.target.value)} placeholder={clearTopic ? "wird geleert" : "unverändert"} />
                    </div>
                    <label className="kn-check">
                        <input type="checkbox" className="kn-cb" checked={clearTopic} onChange={(e) => setClearTopic(e.target.checked)} />
                        Thema leeren
                    </label>
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-bulk-slow">Slowmode</label>
                    <select id="kn-bulk-slow" className="kn-select" value={slowmode} onChange={(e) => setSlowmode(e.target.value)}>
                        <option value={KEEP}>unverändert</option>
                        {SLOWMODE_OPTIONS.map((s) => <option key={s} value={String(s)}>{slowmodeLabel(s)}</option>)}
                    </select>
                </div>
            </form>
        </Modal>
    );
}

export function RenameSchemaDialog({ channels, data, csrfToken, onClose, onApply }: {
    channels: Channel[];
    data: ChannelsData;
    csrfToken: string | null;
    onClose: () => void;
    onApply: (rows: RenamePreviewRow[]) => void;
}) {
    // A selection from one category starts from that category's stored schema.
    const categoryIds = [...new Set(channels.map((c) => c.parentId))];
    const stored = categoryIds.length === 1 ? data.schemas?.[categoryIds[0]] : undefined;
    const [schema, setSchema] = useState(stored?.schema || data.defaultSchema || "{name}");
    const [raid, setRaid] = useState(stored?.raid || "");
    const [rows, setRows] = useState<RenamePreviewRow[] | null>(null);
    const [previewError, setPreviewError] = useState("");
    const ids = useMemo(() => channels.map((c) => c.id), [channels]);

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            renamePreview(csrfToken, { ids, schema, raid })
                .then((r) => { if (alive) { setRows(r.rows); setPreviewError(""); } })
                .catch((err: ApiError) => { if (alive) setPreviewError(err.message); });
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [csrfToken, ids, schema, raid]);

    const todo = (rows || []).filter((r) => r.to && r.to !== r.from && !r.conflict);

    return (
        <Modal
            open
            onClose={onClose}
            icon={<PencilIcon />}
            tone="channels"
            kicker="Umbenennen nach Schema"
            title={`${channels.length} ${channels.length === 1 ? "Kanal" : "Kanäle"} umbenennen`}
            width={640}
            initialFocus="#kn-rename-schema"
            hint="Kanäle mit Konflikt bleiben, wie sie sind."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button disabled={!todo.length} onClick={() => onApply(todo)}>{todo.length} umbenennen</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-rename-schema">Schema</label>
                        <div className="kn-input"><input id="kn-rename-schema" type="text" value={schema} onChange={(e) => setSchema(e.target.value)} /></div>
                    </div>
                    <div className="kn-field">
                        <label htmlFor="kn-rename-raid">Raid</label>
                        <div className="kn-input"><input id="kn-rename-raid" type="text" value={raid} onChange={(e) => setRaid(e.target.value)} placeholder="z.B. ssc-tk" /></div>
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
                            {r.conflict && <Badge tone="mid" tip="Konflikt" tipSub="Der Name ist leer oder gehört schon einem anderen Kanal. Dieser Kanal wird übersprungen.">existiert</Badge>}
                            {!r.conflict && r.to === r.from && <Badge>unverändert</Badge>}
                            {!r.hasDate && /\{(tag|dd|mm|yy|yyyy)\}/.test(schema) && <Badge tip="Kein Event" tipSub="Der Kanal gehört zu keinem bekannten Event, die Datumsteile bleiben leer.">kein Datum</Badge>}
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

/** The schema's placeholders as small buttons; a click appends one. */
export function PlaceholderChips({ data, onPick }: { data: ChannelsData; onPick: (key: string) => void }) {
    return (
        <div className="kn-chips">
            {(data.placeholders || []).map((p) => (
                <button key={p.key} type="button" className="kn-ph" data-tip={`{${p.key}}`} data-tip-sub={p.hint} onClick={() => onPick(p.key)}>
                    {`{${p.key}}`}
                </button>
            ))}
        </div>
    );
}
