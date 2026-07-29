// The Items count with the actual loot behind it: hovering (or tabbing to) the
// number opens a list of every piece the character won — icon, name and the
// award reason from the loot tool ("BiS", "Mainspec", …) — so "5 Items" can be
// checked without opening the character page. The list already travels with the
// character row (lootStore's charLootPreview), so no request happens here.
//
// Shared by the Historie tab's Charaktere table and the Roster overview.
import type { CharLootPreview } from "../api";
import { fmtMs } from "../lib/format";
import { HoverPanel } from "./HoverPanel";
import { LootResponseBadge } from "./LootTable";

export function CharLootHover({ items, count, categoryNameById, showCategory }: {
    items: CharLootPreview[];
    count: number;
    categoryNameById: Map<string, string>;
    /** Only shown for characters raiding under more than one category, where
     *  the count alone wouldn't say which raid a piece came from. */
    showCategory: boolean;
}) {
    if (!items.length) return <>{count}</>;
    return (
        <HoverPanel trigger={count} head={`${items.length} Item${items.length === 1 ? "" : "s"}`}>
            {items.map((it, i) => (
                <div className="loot-pop-row" key={`${it.itemId}-${it.awardedAt}-${i}`}>
                    {it.itemIconUrl
                        ? <img className="loot-pop-ico" src={it.itemIconUrl} alt="" loading="lazy" />
                        : <span className="loot-pop-ico loot-pop-ico-ph" />}
                    <div className="loot-pop-body">
                        <div className="loot-pop-name" title={it.itemName || `Item ${it.itemId}`}>{it.itemName || `Item ${it.itemId}`}</div>
                        <div className="loot-pop-meta">
                            <LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} />
                            {showCategory && !!it.categoryId && (
                                <span className="lbadge lbadge-neutral">{categoryNameById.get(it.categoryId) || it.categoryId}</span>
                            )}
                            {!!it.awardedAt && <span className="sub">{fmtMs(it.awardedAt, false)}</span>}
                        </div>
                    </div>
                </div>
            ))}
        </HoverPanel>
    );
}
