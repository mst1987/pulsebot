// The "Ausgegeben" tab of the guild bank: what went to whom, once it was
// ticked off — by the orga's button in Discord, in game in the addon's list, or
// sent by mail from the mailbox (#634). Handed-out requests are kept 90 days
// (guildBankStore.prune), GET /api/guildbank/handedout lists them newest first.
// Grouped by day ("Heute", "Gestern", the weekday); each row: the item icon,
// "2× Crimson Spinel", the recipient Charakter-Realm big, the raider, when, by
// whom and how, and "aus der Warteliste" when it came from there. The filter
// line (category, search in item, character or raider) applies; the order can
// be turned around. Reading takes "raids".
import { useEffect, useMemo } from "react";
import { getGuildBankHandedOut, type GuildBankHandedOut, type GuildBankHandoutVia, type GuildBankItem } from "../../api";
import { Badge, Segment } from "../../components/ui";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/ui/persistedState";
import { formatDateTime, formatTime } from "../../lib/format";
import { refreshWowheadLinks } from "../../lib/wow/wowheadTooltips";
import { useT } from "../../i18n";
import { dayLabel, filterHandedOut, groupHandedOutByDay, recipientName } from "./bankView";

const VIA_KEY: Record<GuildBankHandoutVia, string> = {
    mail: "guildbank.handedOut.viaMail",
    manual: "guildbank.handedOut.viaManual",
    discord: "guildbank.handedOut.viaDiscord",
    "": "guildbank.handedOut.viaDiscord",
};

type Order = "new" | "old";

function HandedOutRow({ request, item }: { request: GuildBankHandedOut; item: GuildBankItem | undefined }) {
    const t = useT();
    const to = recipientName(request);
    return (
        <li className="gb-out-row">
            <ItemIcon url={request.iconUrl} quality={item ? item.quality : null} />
            <div className="gb-req-text">
                <span className="gb-out-what">{t("guildbank.requests.amountItem", { amount: request.amount, item: request.item })}</span>
                <span className="gb-out-to">
                    <span className="gb-out-label">{t("guildbank.handedOut.to")}</span>
                    <b>{to || request.userName || "–"}</b>
                </span>
                <span className="gb-req-sub">
                    {[
                        request.userName && request.userName !== request.characterName ? t("guildbank.link.raider", { name: request.userName }) : "",
                        request.purpose ? t("guildbank.requests.purpose", { purpose: request.purpose }) : "",
                    ].filter(Boolean).join(" · ")}
                </span>
            </div>
            <div className="gb-out-meta">
                <span className="gb-out-time" data-tip={formatDateTime(request.handedOutAt)}>{formatTime(request.handedOutAt)}</span>
                <span className="gb-out-how">
                    <Badge size="sm" tone={request.handoutVia === "mail" ? "accent" : "ok"}>{t(VIA_KEY[request.handoutVia] || VIA_KEY.discord)}</Badge>
                    {request.fromWaitlist && <Badge size="sm" tip={t("guildbank.handedOut.fromWaitlistTip")}>{t("guildbank.handedOut.fromWaitlist")}</Badge>}
                </span>
                {request.handedOutByName && <span className="gb-req-sub">{t("guildbank.handedOut.by", { name: request.handedOutByName })}</span>}
            </div>
        </li>
    );
}

export default function HandedOutTab({ bankKey, items, category, search, reloadToken = 0 }: {
    bankKey: string;
    /** The bank's items: the category per request, the item quality. */
    items: GuildBankItem[];
    category: string;
    search: string;
    reloadToken?: number;
}) {
    const t = useT();
    const list = useApi(() => getGuildBankHandedOut(bankKey), [bankKey, reloadToken]);
    const [order, setOrder] = usePersistedState<Order>("guildbank-handedout-order", "new");
    const all = useMemo(() => list.data?.requests || [], [list.data]);
    const byId = useMemo(() => new Map(items.map((it) => [it.itemId, it])), [items]);
    const days = useMemo(
        () => groupHandedOutByDay(filterHandedOut(all, byId, { category, search }), { newestFirst: order !== "old" }),
        [all, byId, category, search, order],
    );
    useEffect(() => { refreshWowheadLinks(); }, [days]);

    return (
        <div className="gb-out-tab">
            <div className="gb-out-top">
                <p className="gb-hint">{t("guildbank.handedOut.hint")}</p>
                <Segment<Order>
                    size="sm"
                    ariaLabel={t("guildbank.handedOut.order")}
                    value={order === "old" ? "old" : "new"}
                    onChange={setOrder}
                    options={[{ value: "new", label: t("guildbank.handedOut.newest") }, { value: "old", label: t("guildbank.handedOut.oldest") }]}
                />
            </div>
            {list.error && !list.data && <div className="empty">{list.error.message}</div>}
            {!list.data && !list.error && <div className="empty">{t("guildbank.handedOut.loading")}</div>}
            {list.data && !all.length && <div className="empty">{t("guildbank.handedOut.empty")}</div>}
            {list.data && all.length > 0 && !days.length && <div className="empty">{t("guildbank.waitlist.noMatch")}</div>}
            <div className="gb-wl-groups">
                {days.map((d) => (
                    <section key={d.day} className="gb-wl-group" aria-label={dayLabel(d.at)}>
                        <header className="gb-wl-head">
                            <span className="gb-wl-item">{dayLabel(d.at)}</span>
                            <Badge size="sm">{t("guildbank.handedOut.count", { count: d.requests.length })}</Badge>
                        </header>
                        <ul className="gb-wl-list">
                            {d.requests.map((r) => <HandedOutRow key={r.id} request={r} item={byId.get(r.itemId)} />)}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
