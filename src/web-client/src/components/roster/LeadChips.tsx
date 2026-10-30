import Chip from "../ui/Chip";
import { CheckMark, CrownIcon } from "../ui/icons/icons";
import WowIcon from "../ui/icons/WowIcon";
import { instanceName } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { leadList } from "../../lib/roster/leaders";
import type { LeadInstance } from "../../api/roster/leaders";

// Leader flags (#1034): the instances somebody can lead as toggle chips (no
// checkboxes), and the small crown that marks a leader in the setup and the roster.

/** The instances of one version as toggle chips; a click switches one on or off. */
export function LeadChips({ instances, value, onChange, disabled = false, label }: {
    instances: LeadInstance[];
    value: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
    /** what the row is for, read by a screen reader */
    label?: string;
}) {
    const t = useT();
    const on = new Set(value);
    return (
        <div className="chip-row lead-chips" role="group" aria-label={label || t("roster.leaders.chipsAria")}>
            {instances.map((i) => {
                const pressed = on.has(i.id);
                const name = instanceName(i.id, i.name);
                return (
                    <Chip
                        key={i.id} pressed={pressed} tone={pressed ? "accent" : undefined} disabled={disabled}
                        icon={pressed ? <CheckMark /> : (i.icon ? <WowIcon name={i.icon} size={16} /> : undefined)}
                        tip={name} tipSub={pressed ? t("roster.leaders.chipOn") : t("roster.leaders.chipOff")}
                        onClick={() => onChange(pressed ? value.filter((x) => x !== i.id) : [...value, i.id])}
                    >
                        {i.short || name}
                    </Chip>
                );
            })}
        </div>
    );
}

/** The crown beside a name: this person can lead raids, the tooltip says which. Nothing without a flag. */
export function LeadMark({ instances, ids }: { instances: LeadInstance[]; ids: string[] | undefined }) {
    const t = useT();
    if (!ids || !ids.length) return null;
    const list = leadList(instances, ids);
    return (
        <span className="lead-mark" role="img" aria-label={t("roster.leaders.mark", { list })} data-tip={t("roster.leaders.markTip")} data-tip-sub={list}>
            <CrownIcon />
        </span>
    );
}
