// The stock as one list, a group line per category (design "Webseite:
// Gildenbank"): the item like the loot views draw it (30-px icon in its
// quality frame, the name as a Wowhead link, the bank tab under it), the
// numbers, "Verfügbar" as a badge, the sorting as a three-icon switch and the
// item's settings behind a small button. Numbers that only matter for a
// requestable item (set aside, reserve, available) read "–" elsewhere. An
// item somebody waits for says so under its name ("3 warten", #775).
import { Fragment, useEffect, useRef, useState } from "react";
import type { GuildBankItem, GuildBankRequest, GuildBankStatus, GuildBankTab } from "../../api";
import { Badge, IconButton, Segment } from "../../components/ui";
import Popover from "../../components/ui/overlay/Popover";
import { panelPlacement } from "../../lib/ui/popoverPosition";
import { ItemIcon } from "../../components/loot/LootBadges";
import { EyeIcon, EyeOffIcon, GiftIcon, SlidersIcon } from "../../components/ui/icons/icons";
import { itemQualityProps } from "../../lib/wow/itemQuality";
import { wowheadItemUrl } from "../../lib/wow/wowheadItems";
import { tParts, useT } from "../../i18n";
import { availableTone, itemName, recipientName, tabLine, type ItemGroup } from "./bankView";

/** How many recipients the popover of a "Vorgemerkt" number lists before "+N weitere". */
const MAX_RECIPIENTS = 6;

type SettableStatus = Exclude<GuildBankStatus, "new">;

function Head({ label, tip }: { label: string; tip?: string }) {
    return <span role="columnheader" className="gb-num" data-tip={tip ? label : undefined} data-tip-sub={tip}>{label}</span>;
}

function ItemCell({ item, tabs, wowheadPath }: { item: GuildBankItem; tabs: GuildBankTab[]; wowheadPath: string }) {
    const t = useT();
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
                <span className="hl-item-sub">
                    {tabLine(item, tabs)}
                    {item.waiting > 0 && (
                        <Badge size="sm" tone="accent" className="gb-waiting" tip={t("guildbank.list.waitingTip", { amount: item.waitingAmount })}>
                            {tParts("guildbank.list.waiting", { count: item.waiting })}
                        </Badge>
                    )}
                </span>
            </div>
        </div>
    );
}

/**
 * The "Vorgemerkt" number. With set-aside requests behind it, it is a button:
 * a click (Enter, Space) opens a small panel with who it is set aside for
 * ("1× an Zibbi-Thunderstrike (Zibbo)"), at most MAX_RECIPIENTS, then
 * "+N weitere" and the link to the "Anfragen" tab filtered by the item. The
 * requests come from the one answer the page loaded (GuildBankPage.tsx), so
 * no row asks the server. The focus moves into the panel (it sits at the end
 * of <body>, out of the tab order otherwise) and back to the number on close.
 */
function ReservedCell({ item, requests, onShowRequests }: { item: GuildBankItem; requests: GuildBankRequest[]; onShowRequests: (item: GuildBankItem) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (open) box.current?.focus({ preventScroll: true });
    }, [open]);
    const close = () => {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
    };
    if (!item.reserved || !requests.length) return <span className="lc-num gb-num muted" role="cell">{item.reserved}</span>;
    const shown = requests.slice(0, MAX_RECIPIENTS);
    const more = requests.length - shown.length;
    return (
        <span className="gb-reserved-cell" role="cell">
            <button
                ref={trigger}
                type="button"
                className="lc-num gb-num gb-reserved-btn"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t("guildbank.list.reservedFor", { count: item.reserved, name: itemName(item) })}
                onClick={() => setOpen((o) => !o)}
            >
                {item.reserved}
            </button>
            {open && (
                <Popover
                    anchor={trigger}
                    boxRef={box}
                    place={panelPlacement(320, 360)}
                    onClose={close}
                    className="gb-reserved-pop"
                    role="dialog"
                    aria-label={t("guildbank.list.reservedPopTitle", { name: itemName(item) })}
                    tabIndex={-1}
                >
                    <div className="gb-reserved-head">{t("guildbank.list.reservedPopTitle", { name: itemName(item) })}</div>
                    <ul className="gb-reserved-list">
                        {shown.map((r) => (
                            <li key={r.id}>
                                <b>{t("guildbank.list.reservedFor1", { amount: r.amount, name: recipientName(r) || r.userName || "–" })}</b>
                                {r.userName && r.userName !== r.characterName && <span className="muted"> ({r.userName})</span>}
                            </li>
                        ))}
                    </ul>
                    {more > 0 && <div className="gb-reserved-more">{t("guildbank.list.reservedMore", { count: more })}</div>}
                    <button type="button" className="gb-reserved-all" onClick={() => { setOpen(false); onShowRequests(item); }}>
                        {t("guildbank.list.reservedAll")}
                    </button>
                </Popover>
            )}
        </span>
    );
}

function Row({ item, tabs, wowheadPath, canWrite, busy, reservedFor, onStatus, onSettings, onShowRequests }: {
    item: GuildBankItem;
    tabs: GuildBankTab[];
    wowheadPath: string;
    canWrite: boolean;
    busy: boolean;
    reservedFor: GuildBankRequest[];
    onStatus: (item: GuildBankItem, status: SettableStatus) => void;
    onSettings: (item: GuildBankItem) => void;
    onShowRequests: (item: GuildBankItem) => void;
}) {
    const t = useT();
    const give = item.status === "give";
    const dash = <span className="lc-num gb-num muted">–</span>;
    return (
        <div className="gb-row" role="row">
            <ItemCell item={item} tabs={tabs} wowheadPath={wowheadPath} />
            <span className="lc-num gb-num" role="cell">{item.count}</span>
            {give ? <ReservedCell item={item} requests={reservedFor} onShowRequests={onShowRequests} /> : dash}
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

export default function BankList({ groups, tabs, wowheadPath, canWrite, busyId, reservedBy, onStatus, onSettings, onShowRequests }: {
    groups: ItemGroup[];
    tabs: GuildBankTab[];
    wowheadPath: string;
    canWrite: boolean;
    /** The item a change is being saved for: its switch waits. */
    busyId: number;
    /** The set-aside requests per item id: who the "Vorgemerkt" number is for. */
    reservedBy: Map<number, GuildBankRequest[]>;
    onStatus: (item: GuildBankItem, status: SettableStatus) => void;
    onSettings: (item: GuildBankItem) => void;
    /** "Alle im Tab Anfragen": the page switches to that tab, filtered by the item. */
    onShowRequests: (item: GuildBankItem) => void;
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
                                reservedFor={reservedBy.get(it.itemId) || []}
                                onStatus={onStatus}
                                onSettings={onSettings}
                                onShowRequests={onShowRequests}
                            />
                        ))}
                    </Fragment>
                ))}
                {!groups.length && <div className="gb-empty-row empty" role="row"><span role="cell">{t("guildbank.list.empty")}</span></div>}
            </div>
        </div>
    );
}
