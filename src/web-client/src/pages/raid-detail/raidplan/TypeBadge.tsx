import WowIcon from "../../../components/ui/WowIcon";
import { ASSIGN_META } from "../../../lib/raidplan/assign";
import { useT } from "../../../i18n";

/**
 * A coloured label with the type's icon in front: "TANKT", "HEILT", "KICK" ... in the read view, the type's name in the
 * editor's card head. One component for both, so an assignment looks the same wherever it is shown.
 */
export default function TypeBadge({ type, label, size = 22 }: { type: string; label?: string; size?: number }) {
    const t = useT();
    const meta = ASSIGN_META[type] || ASSIGN_META.other;
    return (
        <span className={`rp-tbadge rp-tb-${type in ASSIGN_META ? type : "other"}`}>
            <WowIcon name={meta.icon} size={size} />
            <span>{label || t(`raidBoard.assign.badge.${type}`)}</span>
        </span>
    );
}
