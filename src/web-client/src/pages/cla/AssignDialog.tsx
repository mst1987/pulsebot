import { useEffect, useState } from "react";
import type { ClaRow, MatchCandidate } from "../../api";
import { formatEventTime } from "../../lib/format";
import { raidIcon } from "../../lib/logRaids";
import { TrashIcon } from "../../components/icons";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { useT } from "../../i18n";
import { fmtEventDay, fmtPosted, formatMatchOffset } from "./shared";
import { QuestionIcon } from "./ClaIcons";

// ---- Modal "Raid-Event zuordnen" ----

export function AssignDialog({ row, onClose, onAssign, onUnlink }: {
    row: ClaRow | null;
    onClose: () => void;
    onAssign: (row: ClaRow, eventId: string) => void;
    onUnlink: (row: ClaRow) => void;
}) {
    const t = useT();
    const cands: MatchCandidate[] = row?.candidates || [];
    const [picked, setPicked] = useState("");
    useEffect(() => {
        if (!row) return;
        const current = cands.find((c) => c.eventId === row.eventId);
        setPicked(current ? current.eventId : (cands[0]?.eventId || ""));
        // re-pick only when another row opens the dialog
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.id]);

    const nearest = cands.length ? Math.min(...cands.map((c) => Math.abs(c.diffMs))) : 0;

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            icon="inv_misc_note_02"
            kicker={row ? t("cla.assign.kicker", { title: row.title, posted: fmtPosted(row.postedAt) }) : ""}
            title={t("cla.assign.title")}
            width={720}
            hint={row?.eventId ? undefined : t("cla.assign.hint")}
            footer={row && (
                <>
                    {row.eventId && (
                        <Button variant="danger" icon={<TrashIcon />} className="la-foot-left" onClick={() => onUnlink(row)}>{t("cla.assign.unlink")}</Button>
                    )}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="inv_misc_note_02" disabled={!picked || picked === row.eventId} onClick={() => onAssign(row, picked)}>{t("cla.assign.submit")}</Button>
                </>
            )}
        >
            {row && (
                <div className="la-assign">
                    {row.eventId && (
                        <div className="la-assign-now">
                            <Badge tone="accent" icon="inv_misc_note_02" className="plain">
                                {row.eventLabel || row.eventId}{row.eventStartTime ? ` · ${fmtEventDay(row.eventStartTime)}` : ""}
                            </Badge>
                            <span className="la-muted">{t("cla.assign.linked", { how: row.eventLinkSource === "auto" ? t("cla.assign.auto") : t("cla.assign.manual") })}</span>
                        </div>
                    )}
                    {row.matchAmbiguous && cands.length > 1 && (
                        <div className="la-assign-now">
                            <Badge tone="mid" icon={<QuestionIcon />}>{t("cla.assign.fitting", { count: cands.length })}</Badge>
                            <span className="la-muted">{t("cla.assign.sortedHint")}</span>
                        </div>
                    )}
                    {cands.length
                        ? (
                            <div className="la-cands" role="radiogroup" aria-label={t("cla.assign.candidatesAria")}>
                                {cands.map((c) => {
                                    const on = picked === c.eventId;
                                    return (
                                        <button
                                            key={c.eventId} type="button" role="radio" aria-checked={on}
                                            className={`la-cand${on ? " on" : ""}`}
                                            onClick={() => setPicked(c.eventId)}
                                        >
                                            <span className={`la-radio${on ? " on" : ""}`} aria-hidden="true" />
                                            <WowIcon name={raidIcon(c.contentId)} size={36} className="la-zicon" />
                                            <span className="la-cell-main">
                                                <span className="la-title">{c.title || c.eventId}</span>
                                                <span className="la-meta">{formatEventTime(c.startTime)}{c.categoryName ? ` · ${c.categoryName}` : ""}</span>
                                            </span>
                                            <span className="la-badges la-badges-end">
                                                <Badge tone={Math.abs(c.diffMs) === nearest ? "ok" : "mid"} icon="spell_holy_borrowedtime">{formatMatchOffset(c.diffMs)}</Badge>
                                                {c.sameCategory && <Badge tone="accent" className="plain">{t("cla.assign.sameCategory")}</Badge>}
                                                {c.eventId === row.eventId && <Badge className="plain">{t("cla.assign.current")}</Badge>}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )
                        : <p className="la-muted">{t("cla.assign.none")}</p>}
                </div>
            )}
        </Modal>
    );
}
