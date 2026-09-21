import WowIcon from "./ui/WowIcon";
import { useT } from "../i18n";
import { knownContents, raidIconName, raidLabel, raidSourceText, RAID_ICON_FALLBACK } from "../lib/raidIcons";

// The raid a row is, as its final boss' achievement icon — two overlapping when
// a night combines raids ("Hyjal + BT"). Nothing recognised shows the plain note,
// never a guessed boss. The tooltip names the raids and where they were read from.
export default function RaidIcon({ contentIds, sources, size = "md" }: {
    contentIds: string[] | undefined;
    sources?: string[];
    size?: "md" | "sm";
}) {
    const t = useT();
    const ids = knownContents(contentIds).slice(0, 2);
    const label = raidLabel(contentIds);
    const tip = label || t("raids.icon.unknown");
    const sub = label ? raidSourceText(sources) : t("raids.icon.unknownSub");
    const px = size === "sm" ? 28 : 36;
    return (
        <span
            className={`raid-ic${ids.length > 1 ? " duo" : ""}${size === "sm" ? " sm" : ""}`}
            data-tip={tip}
            data-tip-sub={sub || undefined}
        >
            {ids.length
                ? ids.map((id, i) => <WowIcon key={id} name={raidIconName(id)} size={px} className={i ? "b" : "a"} />)
                : <WowIcon name={RAID_ICON_FALLBACK} size={px} className="a" />}
        </span>
    );
}
