import { useState, type FormEvent } from "react";
import type { ChannelsData } from "../../api";
import { Badge, Button, IconButton, Modal } from "../ui";
import { TrashIcon } from "../icons";
import { ChannelTypeIcon } from "./channelBits";
import { archivedLabel, BULK_DELETE_WORD } from "../../lib/channels";

// The archive (issue #259): channels nobody needs any more wait here until an
// admin deletes them. Deleting happens only here, only with the name typed (or
// LÖSCHEN for several), and never on its own — the page and the dashboard only
// remind, once a channel has waited longer than the deadline.

export function ArchiveTab({ data, selected, onSelect, canWrite, onDelete, onSettings }: {
    data: ChannelsData;
    selected: Set<string>;
    onSelect: (ids: string[], on: boolean) => void;
    canWrite: boolean;
    onDelete: (ids: string[]) => void;
    onSettings: () => void;
}) {
    const { archive } = data;
    const category = data.categories.find((c) => c.id === archive.categoryId);

    if (!archive.categoryId) {
        return (
            <div className="kn-tree kn-archive-empty">
                <div className="kn-empty">
                    Noch keine Archiv-Kategorie. Archivierte Kanäle wandern dorthin, niemand kann darin mehr schreiben — gelöscht wird erst, wenn ein Admin es hier tut.
                </div>
                {canWrite && <Button onClick={onSettings}>Archiv festlegen</Button>}
            </div>
        );
    }

    const typeOf = (id: string) => data.channels.find((c) => c.id === id)?.type ?? 0;
    const ids = archive.rows.map((r) => r.id);
    const all = ids.length > 0 && ids.every((id) => selected.has(id));

    return (
        <div className="kn-tree">
            <div className="kn-tree-tools">
                {canWrite && ids.length > 0 && (
                    <input type="checkbox" className="kn-cb" checked={all} aria-label="Alle im Archiv wählen" onChange={(e) => onSelect(ids, e.target.checked)} />
                )}
                <span className="kn-cat-title" data-tip={category?.name || "Archiv"} data-tip-sub={`Nach ${archive.hintDays} Tagen wird ein wartender Kanal gelb markiert. Gelöscht wird nie automatisch.`}>
                    {category?.name || "Archiv (Kategorie fehlt)"}
                </span>
                <Badge count>{archive.count}</Badge>
                {archive.overdue > 0 && <Badge tone="mid" tip="Wartet zu lange" tipSub={`Länger als ${archive.hintDays} Tage im Archiv.`}>{archive.overdue} über {archive.hintDays} Tage</Badge>}
                {canWrite && <Button size="sm" variant="ghost" className="kn-push" onClick={onSettings}>Archiv-Einstellungen</Button>}
            </div>
            {!archive.rows.length && <div className="kn-empty">Das Archiv ist leer.</div>}
            {archive.rows.map((r) => (
                <div key={r.id} className={`kn-row${selected.has(r.id) ? " sel" : ""}`} data-channel={r.id}>
                    {canWrite && (
                        <input type="checkbox" className="kn-cb" checked={selected.has(r.id)} aria-label={`#${r.name} wählen`} onChange={(e) => onSelect([r.id], e.target.checked)} />
                    )}
                    <span className="kn-type"><ChannelTypeIcon type={typeOf(r.id)} /></span>
                    <span className="kn-name" tabIndex={0} data-tip={`#${r.name}`} data-tip-sub={archivedLabel(r)}>{r.name}</span>
                    {r.waitingDays !== null && (
                        <Badge tone={r.overdue ? "mid" : undefined} tip={r.overdue ? "Wartet auf Löschung" : "Im Archiv"} tipSub={archivedLabel(r)}>
                            {r.waitingDays === 0 ? "heute" : `${r.waitingDays} ${r.waitingDays === 1 ? "Tag" : "Tage"}`}
                        </Badge>
                    )}
                    {canWrite && (
                        <span className="kn-row-icons">
                            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Löschen" tipSub="Endgültig aus Discord löschen — mit Namen bestätigen." onClick={() => onDelete([r.id])} />
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

export function DeleteChannelsDialog({ names, onClose, onConfirm }: {
    names: string[];
    onClose: () => void;
    onConfirm: (confirm: string) => void;
}) {
    const single = names.length === 1;
    const expected = single ? names[0] : BULK_DELETE_WORD;
    const [typed, setTyped] = useState("");
    const matches = typed.trim() === expected;

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (matches) onConfirm(typed.trim());
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={<TrashIcon />}
            tone="bad"
            kicker="Archiv"
            title={single ? `#${names[0]} löschen` : `${names.length} Kanäle löschen`}
            width={540}
            initialFocus="#kn-del-confirm"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-del" variant="danger" icon={<TrashIcon />} disabled={!matches}>Endgültig löschen</Button>
                </>
            )}
        >
            <form id="kn-del" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-dlg-note">
                    Der Kanal und alle Nachrichten darin sind danach weg — auch in Discord lässt sich das nicht rückgängig machen.
                </div>
                {!single && (
                    <div className="kn-chips">{names.slice(0, 10).map((n) => <Badge key={n}>#{n}</Badge>)}{names.length > 10 && <Badge count>+{names.length - 10}</Badge>}</div>
                )}
                <div className="kn-field">
                    <label htmlFor="kn-del-confirm">Zum Bestätigen <b className="kn-mono">{expected}</b> eintippen</label>
                    <div className="kn-input"><input id="kn-del-confirm" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
                </div>
            </form>
        </Modal>
    );
}

const NEW_CATEGORY = "__new";

export function ArchiveSettingsDialog({ data, onClose, onSave }: {
    data: ChannelsData;
    onClose: () => void;
    onSave: (input: { archiveCategoryId?: string; archiveDeleteHintDays: number; createArchiveCategory?: string }) => void;
}) {
    const [categoryId, setCategoryId] = useState(data.archive.categoryId || (data.categories.length ? "" : NEW_CATEGORY));
    const [newName, setNewName] = useState("Archiv");
    const [days, setDays] = useState(data.archive.hintDays || 14);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (categoryId === NEW_CATEGORY) onSave({ createArchiveCategory: newName.trim() || "Archiv", archiveDeleteHintDays: days });
        else onSave({ archiveCategoryId: categoryId, archiveDeleteHintDays: days });
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker="Kanäle › Archiv"
            title="Archiv-Einstellungen"
            width={520}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-arch" disabled={!categoryId}>Speichern</Button>
                </>
            )}
        >
            <form id="kn-arch" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-arch-cat">Archiv-Kategorie</label>
                    <select id="kn-arch-cat" className="kn-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                        <option value="" disabled>— wählen —</option>
                        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value={NEW_CATEGORY}>+ neue Kategorie anlegen</option>
                    </select>
                </div>
                {categoryId === NEW_CATEGORY && (
                    <div className="kn-field">
                        <label htmlFor="kn-arch-new">Name der neuen Kategorie</label>
                        <div className="kn-input"><input id="kn-arch-new" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
                    </div>
                )}
                <div className="kn-field">
                    <label htmlFor="kn-arch-days">
                        <span className="tipped" tabIndex={0} data-tip="Hinweis nach" data-tip-sub="Ab dann steht ein archivierter Kanal gelb auf der Kanäle-Seite und in den offenen Aufgaben der Übersicht. Gelöscht wird nie automatisch.">Hinweis nach (Tagen)</span>
                    </label>
                    <input id="kn-arch-days" className="kn-select" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} />
                </div>
            </form>
        </Modal>
    );
}
