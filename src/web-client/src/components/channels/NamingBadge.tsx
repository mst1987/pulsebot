import type { ChannelNaming } from "../../api";
import Badge from "../ui/Badge";

// Where a channel name comes from (#285), as one small badge: "abgeleitet aus
// #🔥・mi-17-09-ssc-tk", "nach Schema der Kategorie" or "Standard-Schema". What
// was replaced and which channel's rights the new one copies sit in its
// tooltip, so a dialog stays calm and the logic is still one hover away.
// `short` is for lists (one badge per row): only the kind, the rest in the tooltip.

const SHORT: Record<ChannelNaming["source"], string> = {
    previous: "abgeleitet",
    schema: "Schema",
    default: "Standard",
    typed: "Schema",
};

export default function NamingBadge({ naming, short = false }: { naming?: ChannelNaming | null; short?: boolean }) {
    if (!naming || !naming.label) return null;
    const tone = naming.source === "previous" ? "accent" : naming.source === "default" ? "mid" : undefined;
    return (
        <Badge
            className="naming-badge"
            tone={tone}
            tip={naming.label}
            tipSub={[naming.detail, naming.design].filter(Boolean).join(" · ")}
        >
            {short ? SHORT[naming.source] || naming.label : naming.label}
        </Badge>
    );
}
