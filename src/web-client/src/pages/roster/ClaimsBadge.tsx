import type { CharacterClaim } from "../../api";
import { Badge } from "../../components/ui";
import { tParts, useT } from "../../i18n";

/**
 * Characters more than one account added to its profile. There is no
 * confirmation step on purpose (#255), so the orga sees the conflicts here and
 * resolves them — a badge with the list in its tooltip, not a block.
 */
export function ClaimsBadge({ claims }: { claims: CharacterClaim[] }) {
    const t = useT();
    const lines = claims.map((c) => `${c.character}: ${c.claims.map((x) => x.name || x.userId).join(", ")}`).join("\n");
    return (
        <Badge
            tone="mid"
            tip={t("roster.claims.tip", { count: claims.length })}
            tipSub={t("roster.claims.sub", { lines })}
        >
            {tParts("roster.claims.badge", { count: claims.length })}
        </Badge>
    );
}
