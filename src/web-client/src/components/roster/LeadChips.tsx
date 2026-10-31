import Chip from "../ui/Chip";
import { CheckMark, CrownIcon } from "../ui/icons/icons";
import WowIcon from "../ui/icons/WowIcon";
import { instanceName } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { leadList } from "../../lib/roster/leaders";
import type { LeadInstance } from "../../api/roster/leaders";

// Leader flags (#1034): the instances somebody can lead as toggle chips (no
// checkboxes), and the small crown that marks a leader in the setup and the roster.

/**
 * The instances of one version as toggle chips; a click switches one on or off.
 * With `editable` (the orga, #1034) only those instances are chips - the context
 * of the raid or the category - and `onChange` gets only them (the server merges
 * them into the other flags); the person's other flags stand beside as text.
 */
export function LeadChips({ instances, value, onChange, disabled = false, label, editable }: {
    instances: LeadInstance[];
    value: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
    /** what the row is for, read by a screen reader */
    label?: string;
    /** the instance ids that may be switched here; left out: all */
    editable?: string[];
}) {
    const t = useT();
    const scope = editable ? new Set(editable) : null;
    const shown = scope ? instances.filter((i) => scope.has(i.id)) : instances;
    const own = scope ? value.filter((id) => scope.has(id)) : value;
    const others = scope ? leadList(instances, value.filter((id) => !scope.has(id))) : "";
    const on = new Set(own);
    return (
        <div className="chip-row lead-chips" role="group" aria-label={label || t("roster.leaders.chipsAria")}>
            {shown.map((i) => {
                const pressed = on.has(i.id);
                const name = instanceName(i.id, i.name);
                return (
                    <Chip
                        key={i.id} pressed={pressed} tone={pressed ? "accent" : undefined} disabled={disabled}
                        icon={pressed ? <CheckMark /> : (i.icon ? <WowIcon name={i.icon} size={16} /> : undefined)}
                        tip={name} tipSub={pressed ? t("roster.leaders.chipOn") : t("roster.leaders.chipOff")}
                        onClick={() => onChange(pressed ? own.filter((x) => x !== i.id) : [...own, i.id])}
                    >
                        {i.short || name}
                    </Chip>
                );
            })}
            {others && (
                <span className="lead-elsewhere" data-tip={t("roster.leaders.elsewhereTip")} data-tip-sub={t("roster.leaders.elsewhereSub")}>
                    {t("roster.leaders.elsewhere", { list: others })}
                </span>
            )}
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
