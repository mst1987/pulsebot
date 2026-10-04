import { useState } from "react";
import { deleteAvailability, getAvailability, type ApiError, type AvailabilityEntry, type AvailabilityKind } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Button, IconButton, useConfirm } from "../ui";
import { AbsenceIcon, SignedIcon, TrashIcon } from "../icons";
import { useToast } from "../Jobs";
import AvailabilityDialog from "./AvailabilityDialog";
import { periodLabel } from "../../lib/availability";
import { specLabel } from "../../lib/wowNames";
import { useT } from "../../i18n";

// "Ab- & Anwesenheit" on the signup page: the raider's entries that are not over
// yet as small rows — the period large, the reason or character · spec small —
// and the two buttons that open the dialog. Saving there changes raids, so the
// page's raid list reloads too (`onChanged`).

export default function AvailabilitySection({ onChanged }: { onChanged: () => void }) {
    const t = useT();
    const state = useApi(() => getAvailability(), []);
    const [dialog, setDialog] = useState<AvailabilityKind | null>(null);

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
                <Button size="sm" variant="ghost" icon={<AbsenceIcon />} onClick={() => setDialog("absence")}>{t("signups.availability.addAbsence")}</Button>
                <Button size="sm" variant="ghost" icon={<SignedIcon />} onClick={() => setDialog("presence")}>{t("signups.availability.addPresence")}</Button>
            </div>
            {data.entries.length > 0 && (
                <ul className="an-av-list">
                    {data.entries.map((e) => <EntryRow key={e.id} entry={e} onRemoved={() => removed(e.id)} />)}
                </ul>
            )}
            <AvailabilityDialog
                kind={dialog}
                own={data}
                onClose={() => setDialog(null)}
                onSaved={() => { void state.reload(); onChanged(); }}
            />
        </section>
    );
}

function EntryRow({ entry, onRemoved }: { entry: AvailabilityEntry; onRemoved: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const absence = entry.kind === "absence";
    const detail = absence
        ? entry.comment
        : [entry.character, entry.spec ? specLabel(entry.spec, entry.specLabel) : ""].filter(Boolean).join(" · ");

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
                    {detail && <span>{absence ? t("signups.quoted", { text: detail }) : detail}</span>}
                    {entry.categoryName && <span>{t("signups.availability.onlyCategory", { name: entry.categoryName })}</span>}
                    {entry.done > 0 && <span>{t("signups.availability.done", { count: entry.done })}</span>}
                    {entry.byOrga && <Badge size="sm" tone="accent" tip={t("signups.availability.byOrgaTip")}>{t("signups.availability.byOrga")}</Badge>}
                </div>
            </div>
            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("signups.availability.remove")} onClick={remove} />
        </li>
    );
}
