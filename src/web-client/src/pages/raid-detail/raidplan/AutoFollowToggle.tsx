import { Radio } from "lucide-react";
import { useT } from "../../../i18n";

/**
 * "Automatisch mitgehen" (#534): the small switch at the end of the section bar, shown while the linked Warcraft Log is read
 * (hooks/useRaidProgress.ts). On, the plan turns to the boss being pulled (else the next one); picking a section by hand turns it off,
 * a click here turns it on again.
 */
export default function AutoFollowToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    const t = useT();
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
