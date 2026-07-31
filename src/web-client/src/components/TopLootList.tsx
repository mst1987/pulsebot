// The "Latest Loot" award list — the dashboard card and the Historie tab of the
// same name render it identically, the tab just feeds it a filtered page
// instead of the newest five (see web/lootAwards.js on the server).
//
// Every row is a highlight by design, so it carries the accent rail and the
// item's own quality colour rather than table-row styling. The whole row leads
// to that raid's loot: the link is an overlay stretched across the row
// (.toploot-hit) instead of a wrapper, so the item link and the character link
// stay real links inside it instead of becoming nested anchors. Which raid the
// loot came from is therefore the row's target and not a badge — only the boss
// and the date are shown.
import { Link } from "react-router-dom";
import type { TopLootAward } from "../api";
import { fmtMs } from "../lib/format";
import { itemQualityProps, itemQualityColor } from "../lib/itemQuality";
import { CharacterLink, ClassSpecIcon } from "./ClassSpec";
import { LootResponseBadge } from "./LootTable";

export const awardKey = (it: TopLootAward) => `${it.eventId}-${it.itemId}-${it.character}-${it.awardedAt}`;

export default function TopLootList({ items }: { items: TopLootAward[] }) {
    return (
        <ul className="toploot">
            {items.map((it) => (
                <li className="toploot-row" key={awardKey(it)}>
                    <Link
                        className="toploot-hit"
                        to={it.eventId ? `/history/event?event=${encodeURIComponent(it.eventId)}` : "/history"}
                        aria-label={`Loot von ${it.eventLabel || "diesem Raid"} öffnen`}
                    />
                    {it.itemIconUrl && (
                        <img
                            className="toploot-ico" src={it.itemIconUrl} alt="" loading="lazy"
                            style={{ borderColor: itemQualityColor(it.itemQuality) || "var(--line)" }}
                        />
                    )}
                    <span className="toploot-main">
                        {it.itemLink
                            ? <a {...itemQualityProps(it.itemQuality, "mlink")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                            : <span {...itemQualityProps(it.itemQuality)}>{it.itemName || `Item ${it.itemId}`}</span>}
                        <span className="toploot-meta">
                            {it.boss && <span className="toploot-badge">{it.boss}</span>}
                            <span className="toploot-badge">{fmtMs(it.awardedAt, false)}</span>
                        </span>
                    </span>
                    <span className="toploot-who">
                        <span className="toploot-char" title={it.className ? [it.spec, it.className].filter(Boolean).join(" ") : undefined}>
                            <ClassSpecIcon iconUrl={it.specIconUrl} />
                            <CharacterLink character={it.character} classColor={it.classColor} />
                        </span>
                        <LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} />
                    </span>
                </li>
            ))}
        </ul>
    );
}
