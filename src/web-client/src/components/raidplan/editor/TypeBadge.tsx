import WowIcon from "../../ui/WowIcon";
import { ASSIGN_META } from "../../../lib/raidplan/assign/assign";
import { useT } from "../../../i18n";

/**
 * The type's icon with its name: in the read view a group heading in sentence case ("Heilen", "Unterbrechen", "Flüche" ...;
 * stage.css drops the coloured frame there), in the editor's card head a coloured label with the type's name. One component for both, so an assignment looks the same wherever it is shown.
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
