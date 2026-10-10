import { useState } from "react";
import { getBackupStatus, runBackupNow, type BackupLight, type BackupPart, type BackupStatus } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import { Button } from "../../components/ui/Button";
import { formatDateTime } from "../../lib/format";
import { backupAgo, backupTone, duration } from "../../lib/system/backupFormat";
import { bytes } from "../../lib/system/systemFormat";

// "Datensicherung" (#696, docs/system-status.md): three tiles - the snapshot on this server, the off-site copy, the
// restore test - each with a traffic light, the time ("vor 3 Std.") and the size; the list of local snapshots one
// fold below; one button, "Jetzt sichern". No download of a snapshot, on purpose: it holds API keys and sessions.

const LIGHT_TONE: Record<BackupLight, "ok" | "mid" | "bad" | undefined> = { ok: "ok", warn: "mid", bad: "bad", none: undefined };

function PartTile({ part, now }: { part: BackupPart; now: number }) {
    const t = useT();
    const tone = backupTone(part.light);
    const never = !part.at;
    const size = part.bytes > 0
        ? (part.addedBytes ? t("system.backup.sizeAdded", { size: bytes(part.bytes), added: bytes(part.addedBytes) }) : t("system.backup.size", { size: bytes(part.bytes) }))
        : "";
    const sub = part.state === "failed"
        ? t("system.backup.error", { error: part.error || "?" })
        : [size, part.durationMs > 0 ? t("system.backup.duration", { time: duration(part.durationMs) }) : ""].filter(Boolean).join(" · ");
    const limits = part.key === "restoreTest" ? t("system.backup.limits.restoreTest") : t("system.backup.limits.snapshot");
    return (
        <div className={`sy-tile${tone ? ` sy-tone-${tone}` : ""}`} data-tip={t(`system.backup.partTips.${part.key}`)} data-tip-sub={limits} tabIndex={0}>
            <div className="sy-label">{t(`system.backup.parts.${part.key}`)}</div>
            <div className="sy-value sy-backup-when">{never ? t("system.backup.never") : backupAgo(part.at, now)}</div>
            <div className="sy-sub">{never ? "" : formatDateTime(part.at)}</div>
            {sub && <div className="sy-sub sy-backup-detail">{sub}</div>}
            <div className="sy-backup-light">
                <Badge tone={LIGHT_TONE[part.light]} tip={t(`system.backup.lightTip.${part.light}`)}>{t(`system.backup.light.${part.light}`)}</Badge>
            </div>
        </div>
    );
}

function SnapshotList({ status }: { status: BackupStatus }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    return (
        <div className="sy-slow">
            <Expand open={open} onToggle={() => setOpen(!open)} label={t("system.backup.list.label", { count: status.count })} />
            {open && (status.snapshots.length === 0
                ? <p className="hint sy-empty">{t("system.backup.list.empty")}</p>
                : (
                    <ul className="sy-slow-list sy-backup-list">
                        {status.snapshots.map((s) => (
                            <li key={s.name}>
                                <span className="sy-backup-snap">
                                    <strong>{formatDateTime(s.at)}</strong>
                                    <Badge size="sm">{t(`system.backup.list.reasons.${s.reason}`)}</Badge>
                                    {!s.complete && <Badge size="sm" tone="mid">{t("system.backup.list.incomplete")}</Badge>}
                                </span>
                                <span className="sy-backup-snap-fig" data-tip={s.complete ? t("system.backup.list.files", { count: s.files }) : undefined}>
                                    {s.complete ? bytes(s.bytes) : "–"}
                                </span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
}

export default function BackupSection() {
    const t = useT();
    const status = useApi(() => getBackupStatus(), []);
    const [running, setRunning] = useState(false);
    const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

    const run = () => {
        setRunning(true);
        setNote(null);
        runBackupNow()
            .then((res) => {
                if (res.ok) setNote({ tone: "ok", text: t("system.backup.done", { time: duration(res.durationMs), size: bytes(res.bytes) }) });
                else if (res.skipped === "locked") setNote({ tone: "bad", text: t("system.backup.locked") });
                else setNote({ tone: "bad", text: res.error ? t("system.backup.failed", { error: res.error }) : t("system.backup.failedPlain") });
            })
            .catch((e: Error) => setNote({ tone: "bad", text: t("system.backup.failed", { error: e.message }) }))
            .finally(() => {
                setRunning(false);
                status.reload();
            });
    };

    const data = status.data;
    return (
        <section className="sy-section sy-backup" aria-label={t("system.backup.title")}>
            <PartHead
                icon="inv_misc_bag_10"
                tone="system"
                title={t("system.backup.title")}
                crumb={data ? t(`system.backup.crumb.${data.light}`) : undefined}
                tip={t("system.backup.title")}
                tipSub={`${t("system.backup.tip")}\n${t("system.backup.tipSub")}`}
                action={(
                    <Button variant="run" icon="inv_misc_bag_10" running={running} onClick={run} data-tip={t("system.backup.nowTip")}>
                        {t("system.backup.now")}
                    </Button>
                )}
            />
            {note && <p className={`sy-backup-note sy-backup-note-${note.tone}`} role="status">{note.text}</p>}
            {status.error && !data && <p className="hint" role="alert">{t("system.backup.loadFailed")}</p>}
            {data && (
                <>
                    <div className="sy-tiles sy-backup-tiles">
                        {data.parts.map((p) => <PartTile key={p.key} part={p} now={data.now} />)}
                    </div>
                    {!data.enabled && <p className="hint">{t("system.backup.disabled")}</p>}
                    <SnapshotList status={data} />
                </>
            )}
        </section>
    );
}
