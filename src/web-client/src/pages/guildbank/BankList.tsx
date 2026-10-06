// The stock as one list, a group line per category (design "Webseite:
// Gildenbank"): the item like the loot views draw it (30-px icon in its
// quality frame, the name as a Wowhead link, the bank tab under it), the
// numbers, "Verfügbar" as a badge, the sorting as a three-icon switch and the
// item's settings behind a small button. Numbers that only matter for a
// requestable item (set aside, reserve, available) read "–" elsewhere.
import { Fragment } from "react";
import type { GuildBankItem, GuildBankStatus, GuildBankTab } from "../../api";
import { Badge, IconButton, Segment } from "../../components/ui";
import { ItemIcon } from "../../components/loot/LootBadges";
import { EyeIcon, EyeOffIcon, GiftIcon, SlidersIcon } from "../../components/icons";
import { itemQualityProps } from "../../lib/itemQuality";
import { wowheadItemUrl } from "../../lib/wowheadItems";
import { useT } from "../../i18n";
import { availableTone, itemName, tabLine, type ItemGroup } from "./bankView";

type SettableStatus = Exclude<GuildBankStatus, "new">;

function Head({ label, tip }: { label: string; tip?: string }) {
    return <span role="columnheader" className="gb-num" data-tip={tip ? label : undefined} data-tip-sub={tip}>{label}</span>;
}

function ItemCell({ item, tabs, wowheadPath }: { item: GuildBankItem; tabs: GuildBankTab[]; wowheadPath: string }) {
    const name = itemName(item);
    const href = wowheadItemUrl(item.itemId, [], wowheadPath);
    const nameProps = itemQualityProps(item.quality, "hl-item-name gb-name");
    return (
        <div className="hl-item" role="cell">
            <ItemIcon url={item.iconUrl} quality={item.quality} />
            <div className="hl-item-text">
                {href
                    ? <a {...nameProps} href={href} target="_blank" rel="noreferrer">{name}</a>
                    : <span {...nameProps}>{name}</span>}
                <span className="hl-item-sub">{tabLine(item, tabs)}</span>
            </div>
        </div>
    );
}

function Row({ item, tabs, wowheadPath, canWrite, busy, onStatus, onSettings }: {
    item: GuildBankItem;
    tabs: GuildBankTab[];
    wowheadPath: string;
    canWrite: boolean;
    busy: boolean;
    onStatus: (item: GuildBankItem, status: SettableStatus) => void;
    onSettings: (item: GuildBankItem) => void;
}) {
    const t = useT();
    const give = item.status === "give";
    const dash = <span className="lc-num gb-num muted">–</span>;
    return (
        <div className="gb-row" role="row">
            <ItemCell item={item} tabs={tabs} wowheadPath={wowheadPath} />
            <span className="lc-num gb-num" role="cell">{item.count}</span>
            {give ? <span className="lc-num gb-num muted" role="cell">{item.reserved}</span> : dash}
            {give ? <span className="lc-num gb-num muted" role="cell">{item.reserve}</span> : dash}
            <span className="gb-end" role="cell">
                {give
                    ? <Badge tone={availableTone(item.available)} tip={item.maxPerRequest ? t("guildbank.list.max", { count: item.maxPerRequest }) : undefined}>{item.available}</Badge>
                    : <span className="lc-num gb-num muted">–</span>}
            </span>
            <span className="gb-center" role="cell">
                {/* a new item has none of the three lit: it is still to be sorted */}
                <Segment<GuildBankStatus>
                    iconOnly
                    size="sm"
                    ariaLabel={t("guildbank.list.statusAria", { name: itemName(item) })}
                    value={item.status}
                    onChange={(status) => { if (canWrite && !busy && status !== item.status && status !== "new") onStatus(item, status); }}
                    options={[
                        { value: "hide", label: t("guildbank.status.hide"), tip: t("guildbank.status.hideTip"), icon: <EyeOffIcon />, disabled: !canWrite || busy },
                        { value: "show", label: t("guildbank.status.show"), tip: t("guildbank.status.showTip"), icon: <EyeIcon />, disabled: !canWrite || busy },
                        { value: "give", label: t("guildbank.status.give"), tip: t("guildbank.status.giveTip"), icon: <GiftIcon />, disabled: !canWrite || busy },
                    ]}
                />
            </span>
            <span className="gb-end" role="cell">
                {canWrite && (
                    <IconButton
                        icon={<SlidersIcon />}
                        size="sm"
                        tip={t("guildbank.list.settings")}
                        tipSub={t("guildbank.list.settingsSub")}
                        aria-label={`${t("guildbank.list.settings")}: ${itemName(item)}`}
                        onClick={() => onSettings(item)}
                    />
                )}
            </span>
        </div>
    );
}

export default function BankList({ groups, tabs, wowheadPath, canWrite, busyId, onStatus, onSettings }: {
    groups: ItemGroup[];
    tabs: GuildBankTab[];
    wowheadPath: string;
    canWrite: boolean;
    /** The item a change is being saved for: its switch waits. */
    busyId: number;
    onStatus: (item: GuildBankItem, status: SettableStatus) => void;
    onSettings: (item: GuildBankItem) => void;
}) {
    const t = useT();
    return (
        <div className="gb-scroll">
            <div className="gb-list" role="table" aria-label={t("guildbank.list.aria")}>
                <div className="gb-row gb-head" role="row">
                    <span role="columnheader">{t("guildbank.list.item")}</span>
                    <Head label={t("guildbank.list.stock")} tip={t("guildbank.list.stockTip")} />
                    <Head label={t("guildbank.list.reserved")} tip={t("guildbank.list.reservedTip")} />
                    <Head label={t("guildbank.list.reserve")} tip={t("guildbank.list.reserveTip")} />
                    <Head label={t("guildbank.list.available")} tip={t("guildbank.list.availableTip")} />
                    <span role="columnheader" className="gb-center">{t("guildbank.list.status")}</span>
                    <span role="columnheader" aria-label={t("guildbank.list.settings")} />
                </div>
                {groups.map((g) => (
                    <Fragment key={g.name}>
                        <div className="gb-group" role="row">
                            <span className="gb-group-name" role="cell">{g.name}</span>
                            <span className="gb-group-count">{g.items.length}</span>
                        </div>
                        {g.items.map((it) => (
                            <Row
                                key={it.itemId}
                                item={it}
                                tabs={tabs}
                                wowheadPath={wowheadPath}
                                canWrite={canWrite}
                                busy={busyId === it.itemId}
                                onStatus={onStatus}
                                onSettings={onSettings}
                            />
                        ))}
                    </Fragment>
                ))}
                {!groups.length && <div className="gb-empty-row empty" role="row"><span role="cell">{t("guildbank.list.empty")}</span></div>}
            </div>
        </div>
    );
}
