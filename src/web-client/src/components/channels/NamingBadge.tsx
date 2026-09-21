import type { ChannelNaming } from "../../api";
import Badge from "../ui/Badge";
import { useT } from "../../i18n";

// Where a channel name comes from (#285), as one small badge: "abgeleitet aus
// #🔥・mi-17-09-ssc-tk", "nach Schema der Kategorie" or "Standard-Schema". What
// was replaced and which channel's rights the new one copies sit in its
// tooltip, so a dialog stays calm and the logic is still one hover away.
// `short` is for lists (one badge per row): only the kind, the rest in the tooltip.

const SHORT: ChannelNaming["source"][] = ["previous", "schema", "default", "typed"];

export default function NamingBadge({ naming, short = false }: { naming?: ChannelNaming | null; short?: boolean }) {
    const t = useT();
    if (!naming || !naming.label) return null;
    const tone = naming.source === "previous" ? "accent" : naming.source === "default" ? "mid" : undefined;
    return (
        <Badge
            className="naming-badge"
            tone={tone}
            tip={naming.label}
            tipSub={[naming.detail, naming.design].filter(Boolean).join(" · ")}
        >
            {short && SHORT.includes(naming.source) ? t(`raidCreate.naming.${naming.source}`) : naming.label}
        </Badge>
    );
}
