import { useState, type FormEvent } from "react";
import type { ChannelsData } from "../../api";
import { Badge, Button, IconButton, Modal } from "../ui";
import { TrashIcon } from "../icons";
import { ChannelTypeIcon } from "./channelBits";
import { archivedLabel, BULK_DELETE_WORD } from "../../lib/channels";
import { useT } from "../../i18n";

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
    const t = useT();
    const { archive } = data;
    const category = data.categories.find((c) => c.id === archive.categoryId);

    if (!archive.categoryId) {
        return (
            <div className="kn-tree kn-archive-empty">
                <div className="kn-empty">
                    {t("channels.archive.empty")}
                </div>
                {canWrite && <Button onClick={onSettings}>{t("channels.archive.setUp")}</Button>}
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
                    <input type="checkbox" className="kn-cb" checked={all} aria-label={t("channels.archive.selectAll")} onChange={(e) => onSelect(ids, e.target.checked)} />
                )}
                <span className="kn-cat-title" data-tip={category?.name || t("channels.archive.title")} data-tip-sub={t("channels.archive.hintSub", { days: archive.hintDays })}>
                    {category?.name || t("channels.archive.categoryMissing")}
                </span>
                <Badge count>{archive.count}</Badge>
                {archive.overdue > 0 && <Badge tone="mid" tip={t("channels.archive.overdueTip")} tipSub={t("channels.archive.overdueSub", { days: archive.hintDays })}>{t("channels.archive.overdue", { count: archive.overdue, days: archive.hintDays })}</Badge>}
                {canWrite && <Button size="sm" variant="ghost" className="kn-push" onClick={onSettings}>{t("channels.archive.settings")}</Button>}
            </div>
            {!archive.rows.length && <div className="kn-empty">{t("channels.archive.isEmpty")}</div>}
            {archive.rows.map((r) => (
                <div key={r.id} className={`kn-row${selected.has(r.id) ? " sel" : ""}`} data-channel={r.id}>
                    {canWrite && (
                        <input type="checkbox" className="kn-cb" checked={selected.has(r.id)} aria-label={t("channels.selectOne", { name: r.name })} onChange={(e) => onSelect([r.id], e.target.checked)} />
                    )}
                    <span className="kn-type"><ChannelTypeIcon type={typeOf(r.id)} /></span>
                    <span className="kn-name" tabIndex={0} data-tip={`#${r.name}`} data-tip-sub={archivedLabel(r)}>{r.name}</span>
                    {r.waitingDays !== null && (
                        <Badge tone={r.overdue ? "mid" : undefined} tip={r.overdue ? t("channels.archive.waitingTip") : t("channels.archive.inArchive")} tipSub={archivedLabel(r)}>
                            {r.waitingDays === 0 ? t("common.relDay.today") : t("channels.archive.days", { count: r.waitingDays })}
                        </Badge>
                    )}
                    {canWrite && (
                        <span className="kn-row-icons">
                            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("common.delete")} tipSub={t("channels.archive.deleteSub")} onClick={() => onDelete([r.id])} />
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

export function DeleteChannelsDialog({ names, onClose, onConfirm, kicker, warnings = [] }: {
    names: string[];
    onClose: () => void;
    onConfirm: (confirm: string) => void;
    /** "Archiv" from the archive tab, "Kanäle" from the channel list. */
    kicker?: string;
    /** Channels that still carry something (an upcoming event) — named before the name is typed. */
    warnings?: string[];
}) {
    const t = useT();
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
            kicker={kicker ?? t("channels.archive.title")}
            title={single ? t("channels.deleteDialog.titleOne", { name: names[0] }) : t("channels.deleteDialog.titleMany", { count: names.length })}
            width={540}
            initialFocus="#kn-del-confirm"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-del" variant="danger" icon={<TrashIcon />} disabled={!matches}>{t("channels.deleteDialog.submit")}</Button>
                </>
            )}
        >
            <form id="kn-del" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-dlg-note">
                    {t("channels.deleteDialog.note")}
                </div>
                {warnings.length > 0 && (
                    <div className="kn-dlg-note kn-dlg-warn">
                        {warnings.map((w) => <div key={w}>{w}</div>)}
                    </div>
                )}
                {!single && (
                    <div className="kn-chips">{names.slice(0, 10).map((n) => <Badge key={n}>#{n}</Badge>)}{names.length > 10 && <Badge count>+{names.length - 10}</Badge>}</div>
                )}
                <div className="kn-field">
                    <label htmlFor="kn-del-confirm">{t("channels.deleteDialog.typeBefore")} <b className="kn-mono">{expected}</b> {t("channels.deleteDialog.typeAfter")}</label>
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
    const t = useT();
    const [categoryId, setCategoryId] = useState(data.archive.categoryId || (data.categories.length ? "" : NEW_CATEGORY));
    const [newName, setNewName] = useState(() => t("channels.archiveSettings.defaultName"));
    const [days, setDays] = useState(data.archive.hintDays || 14);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (categoryId === NEW_CATEGORY) onSave({ createArchiveCategory: newName.trim() || t("channels.archiveSettings.defaultName"), archiveDeleteHintDays: days });
        else onSave({ archiveCategoryId: categoryId, archiveDeleteHintDays: days });
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker={t("channels.archiveSettings.kicker")}
            title={t("channels.archiveSettings.title")}
            width={520}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-arch" disabled={!categoryId}>{t("common.save")}</Button>
                </>
            )}
        >
            <form id="kn-arch" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-arch-cat">{t("channels.archiveSettings.category")}</label>
                    <select id="kn-arch-cat" className="kn-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                        <option value="" disabled>{t("channels.archiveSettings.pick")}</option>
                        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value={NEW_CATEGORY}>{t("channels.archiveSettings.newCategory")}</option>
                    </select>
                </div>
                {categoryId === NEW_CATEGORY && (
                    <div className="kn-field">
                        <label htmlFor="kn-arch-new">{t("channels.archiveSettings.newName")}</label>
                        <div className="kn-input"><input id="kn-arch-new" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
                    </div>
                )}
                <div className="kn-field">
                    <label htmlFor="kn-arch-days">
                        <span className="tipped" tabIndex={0} data-tip={t("channels.archiveSettings.hintTip")} data-tip-sub={t("channels.archiveSettings.hintSub")}>{t("channels.archiveSettings.hintLabel")}</span>
                    </label>
                    <input id="kn-arch-days" className="kn-select" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} />
                </div>
            </form>
        </Modal>
    );
}
