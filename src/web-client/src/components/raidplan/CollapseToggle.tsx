import { ChevronDown } from "lucide-react";
import { IconButton } from "../ui";
import { useT } from "../../i18n";

/**
 * The one chevron that folds a block of the raid plan editor away (Roster slots, Taktik, the mobs bar, an assignment card
 * …): rotated to point sideways when folded (`rp-rot-90`, the assignment card's own look before this), `aria-expanded`
 * says the state for a screen reader, the fold/unfold tooltip is the same text everywhere. `label` names the block for
 * the aria-label ("Roster slots: Fold") since several of these chevrons can be on one page.
 */
export default function CollapseToggle({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label?: string }) {
    const t = useT();
    const tip = t(collapsed ? "raidBoard.block.unfold" : "raidBoard.block.fold");
    return (
        <IconButton
            size="sm"
            icon={<ChevronDown size={15} className={collapsed ? "rp-rot-90" : ""} />}
            tip={tip}
            aria-label={label ? `${label}: ${tip}` : tip}
            aria-expanded={!collapsed}
            onClick={onToggle}
        />
    );
}
