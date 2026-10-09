import { useCallback, useEffect, useState } from "react";
import { getRaidhelperSync, refreshRaidhelperSync, type ApiError, type RaidhelperSync } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import RaidLoader from "../../components/ui/RaidLoader";
import { AdminOnlyBadge, CheckMark, WarnIcon } from "../../components/settings/settingsUi";
import { InfoTip } from "../../components/ui/Field";
import { useT } from "../../i18n";
import { formatTime as clock } from "../../lib/format";

// Einstellungen → Verbindungen → "Raid-Helper-Abgleich" (#608). The pages never
// ask Raid-Helper for the event list; one job fetches it every few minutes. This
// card says when that last happened and how much of Raid-Helper's daily limit
// is used, and "Jetzt aktualisieren" runs the job right away.

const minutesSince = (ms: number, now: number) => Math.max(0, Math.round((now - ms) / 60000));

export default function RaidhelperSyncCard() {
    const [sync, setSync] = useState<RaidhelperSync | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();

    const load = useCallback(() => {
        getRaidhelperSync()
            .then((d) => { setSync(d); setError(""); })
            .catch((err) => setError((err as ApiError).message));
    }, []);
    useEffect(load, [load]);

    const refresh = async () => {
        setBusy(true);
        try {
            const d = await refreshRaidhelperSync();
            setSync(d);
            if (d.throttled) toast(t("settings.rhSync.throttled"));
            else if (d.ok) toast(t("settings.rhSync.done", { count: d.events }));
            else toast(d.error || t("settings.rhSync.failed"), "err");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const now = Date.now();
    const failed = !!sync && !!sync.error && sync.errorAt >= sync.syncedAt;
    const tone = !sync ? undefined : sync.disabled ? undefined : failed || !sync.syncedAt ? "bad" : "ok";
    const status = !sync ? "" : sync.disabled ? t("settings.rhSync.off")
        : !sync.syncedAt ? t("settings.rhSync.never")
            : t("settings.rhSync.ago", { count: minutesSince(sync.syncedAt, now) });

    return (
        <section className="conn-card rhr-card" data-conn="raidhelper-sync">
            <div className="conn-head">
                <IconTile icon="spell_nature_timestop" tone={tone === "bad" ? "mid" : "settings"} />
                <div className="conn-title">
                    <span>{t("settings.rhSync.title")}</span>
                    <InfoTip head={t("settings.rhSync.title")} sub={t("settings.rhSync.infoSub", { minutes: sync ? Math.round(sync.intervalMs / 60000) : 5 })} />
                </div>
                {sync && <Badge tone={tone} icon={tone === "ok" ? <CheckMark /> : tone === "bad" ? <WarnIcon /> : undefined}>{status}</Badge>}
            </div>
            {!sync ? (
                error ? <div className="note rhr-pad">{error}</div> : <RaidLoader compact text={t("settings.rhSync.loading")} />
            ) : (
                <ul className="rhr-list">
                    <li className="rhr-item">
                        <span className="rhr-label">{t("settings.rhSync.lastSync")}</span>
                        <span className="rhr-value">
                            {sync.syncedAt ? t("settings.rhSync.lastSyncValue", { time: clock(sync.syncedAt), count: sync.events }) : "—"}
                        </span>
                    </li>
                    <li className="rhr-item">
                        <span className="rhr-label tipped" tabIndex={0} data-tip={t("settings.rhSync.budget")} data-tip-sub={t("settings.rhSync.budgetSub", { cap: sync.budget.caps.read })}>
                            {t("settings.rhSync.budget")}
                        </span>
                        <span className="rhr-value">{t("settings.rhSync.budgetValue", { used: sync.budget.used, limit: sync.budget.limit })}</span>
                    </li>
                    {sync.budget.blockedUntil > 0 && (
                        <li className="rhr-item is-bad">
                            <span className="rhr-label">{t("settings.rhSync.blocked")}</span>
                            <span className="rhr-value">{t("settings.rhSync.blockedUntil", { time: clock(sync.budget.blockedUntil) })}</span>
                        </li>
                    )}
                    {failed && (
                        <li className="rhr-item is-bad">
                            <span className="rhr-label">{t("settings.rhSync.lastError")}</span>
                            <span className="rhr-value">{sync.error}</span>
                        </li>
                    )}
                </ul>
            )}
            {sync && (
                <div className="conn-foot rhr-foot">
                    <Button size="sm" icon="spell_nature_timestop" onClick={refresh} disabled={busy || sync.disabled}>
                        {busy ? t("settings.rhSync.running") : t("settings.rhSync.refresh")}
                    </Button>
                    <span className="grow" />
                    <AdminOnlyBadge />
                </div>
            )}
        </section>
    );
}
