import { Radio } from "lucide-react";
import { useT } from "../../../i18n";
import type { RaidplanProgressWaiting } from "../../../api";

/**
 * "Automatisch mitgehen" (#534): the small switch at the end of the section bar. While the linked Warcraft Log is read
 * (hooks/useRaidProgress.ts) it is a switch: on, the plan turns to the boss being pulled (else the next one); picking a section by
 * hand turns it off, a click here turns it on again. Inside the raid window without a readable log (`waiting`) it stays visible,
 * greyed and inert, as "Wartet auf Log" with the reason in its tooltip — so the switch is never a secret.
 */
export default function AutoFollowToggle({ on, onToggle, waiting = null }: { on: boolean; onToggle: () => void; waiting?: RaidplanProgressWaiting | null }) {
    const t = useT();
    if (waiting) {
        return (
            <button
                type="button" className="rp-bosschip rp-autofollow is-waiting" aria-disabled="true"
                data-tip={t("raidBoard.progress.waiting")}
                data-tip-sub={t(waiting === "no_log" ? "raidBoard.progress.waitingNoLogTip" : "raidBoard.progress.waitingErrorTip")}
            >
                <Radio size={14} aria-hidden="true" />
                <span>{t("raidBoard.progress.waiting")}</span>
            </button>
        );
    }
    return (
        <button
            type="button" className={`rp-bosschip rp-autofollow${on ? " is-on" : ""}`} aria-pressed={on}
            data-tip={t(on ? "raidBoard.progress.followOnTip" : "raidBoard.progress.followOffTip")} onClick={onToggle}
        >
            <Radio size={14} aria-hidden="true" />
            <span>{t("raidBoard.progress.follow")}</span>
        </button>
    );
}
