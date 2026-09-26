import type { CharacterClaim } from "../../api";
import { Badge } from "../../components/ui";

/**
 * Characters more than one account added to its profile. There is no
 * confirmation step on purpose (#255), so the orga sees the conflicts here and
 * resolves them — a badge with the list in its tooltip, not a block.
 */
export function ClaimsBadge({ claims }: { claims: CharacterClaim[] }) {
    const lines = claims.map((c) => `${c.character}: ${c.claims.map((x) => x.name || x.userId).join(", ")}`).join("\n");
    return (
        <Badge
            tone="mid"
            tip={`${claims.length} Charakter${claims.length === 1 ? "" : "e"} doppelt beansprucht`}
            tipSub={`Mehrere Konten haben denselben Charakter in „Mein Profil" eingetragen:\n${lines}`}
        >
            {claims.length} doppelt vergeben
        </Badge>
    );
}
