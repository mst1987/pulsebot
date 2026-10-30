import { useState } from "react";
import { deleteAvailability, getAvailability, type ApiError, type AvailabilityEntry, type AvailabilityKind } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Button, IconButton, useConfirm } from "../ui";
import { AbsenceIcon, EditIcon, SignedIcon, TrashIcon } from "../ui/icons/icons";
import { useToast } from "../shell/Jobs";
import AvailabilityDialog from "./AvailabilityDialog";
import { entryCharacters, periodLabel, scopeLabel } from "../../lib/signups/availability";
import { useT } from "../../i18n";

// "Ab- & Anwesenheit" on the signup page: the raider's entries that are not over
// yet as small rows — the period large; where it holds, the reason or the
// characters small — with edit and delete, and the two buttons that open the
// dialog. Saving there changes raids, so the page's raid list reloads too (`onChanged`).

type Open = { kind: AvailabilityKind; entryId: string };

export default function AvailabilitySection({ onChanged }: { onChanged: () => void }) {
    const t = useT();
    const state = useApi(() => getAvailability(), []);
    const [dialog, setDialog] = useState<Open | null>(null);

    if (state.error && !state.data) return <p className="an-av-note">{t("signups.availability.loadError", { message: state.error.message })}</p>;
    // a calm page: the section appears once it is known, no loader of its own
    if (!state.data) return null;
    const data = state.data;

    const removed = (id: string) => state.setData((d) => d && { ...d, entries: d.entries.filter((e) => e.id !== id) });

    return (
        <section className="an-av" aria-label={t("signups.availability.title")}>
            <div className="an-av-head">
                <span className="an-av-label tipped" tabIndex={0} data-tip={t("signups.availability.title")} data-tip-sub={t("signups.availability.tipSub")}>
                    {t("signups.availability.title")}
                </span>
                <Button size="sm" variant="no" icon={<AbsenceIcon />} onClick={() => setDialog({ kind: "absence", entryId: "" })}>{t("signups.availability.addAbsence")}</Button>
                <Button size="sm" variant="yes" icon={<SignedIcon />} onClick={() => setDialog({ kind: "presence", entryId: "" })}>{t("signups.availability.addPresence")}</Button>
            </div>
            {data.entries.length > 0 && (
                <ul className="an-av-list">
                    {data.entries.map((e) => (
                        <EntryRow key={e.id} entry={e} onEdit={() => setDialog({ kind: e.kind, entryId: e.id })} onRemoved={() => removed(e.id)} />
                    ))}
                </ul>
            )}
            <AvailabilityDialog
                key={dialog ? `${dialog.kind}:${dialog.entryId}` : "closed"}
                kind={dialog ? dialog.kind : null}
                entryId={dialog ? dialog.entryId : ""}
                own={data}
                onClose={() => setDialog(null)}
                onSaved={() => { void state.reload(); onChanged(); }}
            />
        </section>
    );
}

/** One entry: the period large, below it the kind, where it holds and the reason or the characters. */
export function EntryRow({ entry, onEdit, onRemoved }: { entry: AvailabilityEntry; onEdit: () => void; onRemoved: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const absence = entry.kind === "absence";
    const chars = absence ? [] : entryCharacters(entry);

    const remove = async () => {
        const ok = await ask({ title: t("signups.availability.removeTitle"), text: t("signups.availability.removeText"), action: t("common.delete") });
        if (!ok) return;
        try {
            await deleteAvailability(entry.id);
            onRemoved();
            toast(t("signups.availability.removed"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    return (
        <li className={`an-av-entry ${absence ? "an-av-absence" : "an-av-presence"}`}>
            <span className="an-av-ic" role="img" aria-label={t(`signups.availability.kind.${entry.kind}`)} data-tip={t(`signups.availability.kind.${entry.kind}`)}>
                {absence ? <AbsenceIcon /> : <SignedIcon />}
            </span>
            <div className="an-av-main">
                <div className="an-av-period">{periodLabel(entry.from, entry.to)}</div>
                <div className="an-av-sub">
                    <span>{t(`signups.availability.kind.${entry.kind}`)}</span>
                    <span className="an-av-scope">{scopeLabel(entry)}</span>
                    {absence && entry.comment && <span>{t("signups.quoted", { text: entry.comment })}</span>}
                    {entry.done > 0 && <span>{t("signups.availability.done", { count: entry.done })}</span>}
                    {entry.byOrga && <Badge size="sm" tone="accent" tip={t("signups.availability.byOrgaTip")}>{t("signups.availability.byOrga")}</Badge>}
                </div>
                {chars.length > 0 && <div className="an-av-sub an-av-charlist">{chars.map((c) => <span key={c}>{c}</span>)}</div>}
            </div>
            <div className="an-av-acts">
                <IconButton size="sm" icon={<EditIcon />} tip={t("signups.availability.edit")} onClick={onEdit} />
                <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("signups.availability.remove")} onClick={remove} />
            </div>
        </li>
    );
}
