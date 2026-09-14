// The "Latest Loot" award list — the start page's card and the Historie tab of
// the same name render it identically, the tab just feeds it a filtered page
// instead of the newest five (see web/lootAwards.js on the server).
//
// One row per award: the item icon in its quality frame, the name, one grey
// line "Boss · Datum", and the winner with class icon, class colour and the
// award reason. The whole row leads to that raid's loot: the link is an overlay
// stretched across the row (.toploot-hit) instead of a wrapper, so the item link
// and the character link stay real links inside it instead of nested anchors.
// Who won it in which spec, and what they answered in the loot addon, is the
// winner's tooltip — not a native title.
import { Link } from "react-router-dom";
import type { TopLootAward } from "../api";
import { fmtMs } from "../lib/format";
import { shortDate } from "../lib/overviewDates";
import { itemQualityProps, itemQualityColor } from "../lib/itemQuality";
import { CharacterLink } from "./ClassSpec";
import { LootResponseBadge } from "./LootTable";
import WowIcon from "./ui/WowIcon";
import "../styles/uebersicht.css";

export const awardKey = (it: TopLootAward) => `${it.eventId}-${it.itemId}-${it.character}-${it.awardedAt}`;

/** The winner's tooltip: spec and class as head, the raw addon answer as explanation. */
export function winnerTip(it: Pick<TopLootAward, "character" | "className" | "spec" | "response">): { head: string; sub: string } {
    const who = [it.spec, it.className].filter(Boolean).join(" ");
    return {
        head: who ? `${it.character} · ${who}` : it.character,
        sub: it.response ? `Rückmeldung im Addon: „${it.response}“.` : "Keine Rückmeldung im Addon gespeichert.",
    };
}

/** "10.09." for this year's awards, the full date for older ones (the Historie tab pages back through years). */
function awardDate(ms: number): string {
    if (!ms) return "";
    const full = fmtMs(ms, false);
    return full.endsWith(String(new Date().getFullYear())) ? shortDate(ms) : full;
}

const classIcon =(className: string) => `classicon_${className === "DK" ? "deathknight" : className.toLowerCase()}`;

export default function TopLootList({ items }: { items: TopLootAward[] }) {
    return (
        <ul className="toploot">
            {items.map((it) => {
                const tip = winnerTip(it);
                const meta = [it.boss, awardDate(it.awardedAt)].filter(Boolean).join(" · ");
                return (
                    <li className="toploot-row" key={awardKey(it)}>
                        <Link
                            className="toploot-hit"
                            to={it.eventId ? `/history/event?event=${encodeURIComponent(it.eventId)}` : "/history"}
                            aria-label={`Loot von ${it.eventLabel || "diesem Raid"} öffnen`}
                        />
                        {it.itemIconUrl
                            ? (
                                <img
                                    className="toploot-ico" src={it.itemIconUrl} alt="" loading="lazy"
                                    style={{ borderColor: itemQualityColor(it.itemQuality) || "var(--line)" }}
                                />
                            )
                            : <span className="toploot-ico toploot-ico-empty" />}
                        <span className="toploot-main">
                            {it.itemLink
                                ? <a {...itemQualityProps(it.itemQuality, "toploot-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                : <span {...itemQualityProps(it.itemQuality, "toploot-name")}>{it.itemName || `Item ${it.itemId}`}</span>}
                            {meta && <span className="toploot-meta">{meta}</span>}
                        </span>
                        <span className="toploot-who">
                            <span className="toploot-char" data-tip={tip.head} data-tip-sub={tip.sub}>
                                {it.className && <WowIcon name={classIcon(it.className)} size={18} />}
                                <CharacterLink character={it.character} classColor={it.classColor} />
                            </span>
                            <LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} />
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
