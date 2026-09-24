import type { RaidplanMarkName } from "../../api";
import { markUrl } from "../../lib/raidplan";

/**
 * A raid target mark: the game's own icon (UI-RaidTargetingIcon_1..8, 64 px), served
 * from public/raidmarks/ next to the boss icons. Where the files come from is in
 * docs/raidplan.md ("Raid marks").
 */
export function MarkIcon({ mark, size = 30 }: { mark: RaidplanMarkName; size?: number }) {
    return <img className="rp-mark-img" src={markUrl(mark)} width={size} height={size} alt="" draggable={false} />;
}
