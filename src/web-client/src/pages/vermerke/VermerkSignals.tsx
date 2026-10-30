import { useState } from "react";
import { getVermerkSignals, ignoreVermerkSignal, reasonOfSignal, type VermerkSignal } from "../../api/vermerke";
import { useApi } from "../../hooks/useApi";
import { Button, InfoTip } from "../../components/ui";
import { PlusIcon, EyeOffIcon } from "../../components/ui/icons";
import type { VermerkDialogPreset } from "../../components/vermerke/VermerkDialog";
import { useT } from "../../i18n";

// "Hinweise aus den Daten" (#982) under the list: what the signups and logs
// suggest (late signoff, no show, left early, left the server) — never a note
// until someone adds one. Five at most, then "Alle zeigen". The section is gone
// when the server has none or does not know the route yet (404 → []).

const SHOWN = 5;

export default function VermerkSignals({ canWrite, onAdd }: { canWrite: boolean; onAdd: (preset: VermerkDialogPreset) => void }) {
    const t = useT();
    const state = useApi(() => getVermerkSignals(), []);
    const [all, setAll] = useState(false);
    const [busy, setBusy] = useState("");
    const signals = state.data || [];
    if (signals.length === 0) return null;
    const rows = all ? signals : signals.slice(0, SHOWN);
    const keyOf = (s: VermerkSignal) => `${s.userId}:${s.kind}`;

    const ignore = async (s: VermerkSignal) => {
        setBusy(keyOf(s));
        try {
            await ignoreVermerkSignal(s.userId, s.kind);
            state.setData(signals.filter((x) => keyOf(x) !== keyOf(s)));
        } catch {
            // stays in the list; a second try is one click away
        } finally {
            setBusy("");
        }
    };

    return (
        <section className="vmk-signals" aria-labelledby="vmk-signals-title">
            <div className="vmk-signals-head">
                <h2 id="vmk-signals-title">{t("vermerke.signals.title")}</h2>
                <InfoTip head={t("vermerke.signals.title")} sub={t("vermerke.signals.tip")} />
            </div>
            <ul className="vmk-sig-list">
                {rows.map((s) => (
                    <li key={keyOf(s)} className="vmk-sig" data-user={s.userId}>
                        <span className="vmk-sig-who">
                            <span className="vmk-sig-name">{s.name}</span>
                            <span className="vmk-sig-what" data-tip={s.events.length ? s.events.map((e) => e.title).join(" · ") : undefined}>
                                {t(`vermerke.signals.kind.${s.kind}`)}
                                {s.kind !== "left_server" && ` · ${t("vermerke.signals.count", { count: s.count, days: s.windowDays })}`}
                            </span>
                        </span>
                        {canWrite && (
                            <span className="vmk-sig-acts">
                                <Button
                                    variant="ghost" size="sm" icon={<PlusIcon />}
                                    onClick={() => onAdd({ person: { userId: s.userId, name: s.name }, reason: reasonOfSignal(s.kind), eventIds: s.events.map((e) => e.eventId) })}
                                >
                                    {t("vermerke.signals.add")}
                                </Button>
                                <Button
                                    variant="ghost" size="sm" icon={<EyeOffIcon />} disabled={busy === keyOf(s)}
                                    data-tip={t("vermerke.signals.ignore")} data-tip-sub={t("vermerke.signals.ignoreSub")}
                                    onClick={() => ignore(s)}
                                >
                                    {t("vermerke.signals.ignore")}
                                </Button>
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            {signals.length > SHOWN && (
                <button type="button" className="vmk-more" onClick={() => setAll(!all)}>
                    {all ? t("vermerke.signals.showLess") : t("vermerke.signals.showAll", { count: signals.length - SHOWN })}
                </button>
            )}
        </section>
    );
}
