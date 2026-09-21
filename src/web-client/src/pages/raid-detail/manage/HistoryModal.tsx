// "Verlauf" (#288): who did what to the event and when, newest first — one
// line per entry, the action large, who and when small, the detail in muted text.
import { useEffect, useState } from "react";
import { getManageInfo, type ApiError, type ManageLogEntry } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { fmtMs } from "../../../lib/format";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function HistoryModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId } = ctx;
    const [log, setLog] = useState<ManageLogEntry[] | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        setLog(null);
        setError("");
        getManageInfo(eventId).then((i) => setLog(i.log)).catch((err: ApiError) => setError(err.message));
    }, [open, eventId]);

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_book_09" tone="raids"
            kicker={data.event.title} title={t("raidManage.history.title")} width={560}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {error ? <div className="flash flash-err">{error}</div>
                : !log ? <p className="rd-empty">{t("raidManage.history.loading")}</p>
                : !log.length ? <p className="rd-empty">{t("raidManage.history.empty")}</p>
                : (
                    <ol className="em-log">
                        {log.map((entry, i) => (
                            <li key={`${entry.at}-${i}`} className={`em-log-row em-act-${entry.action}`}>
                                <span className="em-log-head">
                                    <b>{entry.label}</b>
                                    <span className="em-sub">{entry.byName || entry.by || t("raidManage.history.unknown")} · {fmtMs(entry.at)}</span>
                                </span>
                                {entry.detail && <span className="em-log-detail">{entry.detail}</span>}
                            </li>
                        ))}
                    </ol>
                )}
        </Modal>
    );
}
