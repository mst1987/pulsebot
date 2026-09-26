// Who got an item, when and why — in one place.
//
// The Items table used to answer that with one hover panel per recipient, so no
// view ever showed all awards of an item together. This dialog is that view:
// head with the item, a figure with the reason split, then one row per award,
// newest first, the older ones behind "Details". A raid lead with write access
// can delete a single wrong award here (behind the confirm dialog).
//
// RaiderReasonDialog is the same dialog turned around for "Gründe": one raider,
// one reason, the items behind it.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
    deleteLootItems,
    type ApiError, type CharReasonBucket, type CharReasonRow, type LootCatalogItem, type LootContent, type LootReason, type LootTier,
} from "../../api";
import { itemQualityProps } from "../../lib/itemQuality";
import { contentName } from "../../lib/wowNames";
import { formatWith } from "../../lib/format";
import { Modal, useConfirm } from "../../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import WowIcon from "../../components/ui/WowIcon";
import { ExternalIcon, TrashIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import { ItemIcon, ReasonBadge, StackBar, contentIcon, tallyReasons } from "../../components/loot/LootBadges";
import { useToast } from "../../components/Jobs";
import { tParts, useT } from "../../i18n";

// Newest awards shown right away; the rest behind the expand control, so a
// token handed out forty times does not push the foot off the screen.
const FIRST_ROWS = 5;

/** "11.09. 22:48" — the year is in the event name already. */
function shortWhen(ms: number): string {
    if (!ms) return "";
    return formatWith(ms, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "Do 11.09." */
export function shortDay(ms: number): string {
    if (!ms) return "";
    return formatWith(ms, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(",", "");
}

export function ItemAwardsDialog({ item, contents, tiers, reasons, canEdit, onClose, onChanged }: {
    /** null keeps the dialog closed. */
    item: LootCatalogItem | null;
    contents: LootContent[];
    tiers: LootTier[];
    reasons: LootReason[];
    canEdit: boolean;
    onClose: () => void;
    /** After a delete: toast + reload the overview. */
    onChanged: (msg: string) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const [showAll, setShowAll] = useState(false);
    const [busyId, setBusyId] = useState("");

    const content = item ? contents.find((c) => c.id === item.contentId) : undefined;
    const tier = item ? tiers.find((x) => x.id === (item.tokenTier || item.tier)) : undefined;
    const name = item ? (item.itemName || t("history.shared.itemFallback", { id: item.itemId })) : "";
    const parts = item ? tallyReasons(item.awards, reasons) : [];
    const rows = item ? (showAll ? item.awards : item.awards.slice(0, FIRST_ROWS)) : [];
    const hidden = item ? item.awards.length - FIRST_ROWS : 0;

    const close = () => { setShowAll(false); onClose(); };

    const remove = async (awardId: string, character: string) => {
        if (!(await ask({ title: t("history.awards.deleteTitle"), text: t("history.awards.deleteText", { item: name, character }), action: t("common.delete") }))) return;
        setBusyId(awardId);
        try {
            await deleteLootItems([awardId]);
            onChanged(t("history.awards.deleted", { item: name, character }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };

    return (
        <Modal
            open={!!item}
            onClose={close}
            width={820}
            icon={item ? <ItemIcon url={item.itemIconUrl} quality={item.itemQuality} size="lg" /> : undefined}
            kicker={item ? [item.boss, content && contentName(content.id, content.label)].filter(Boolean).join(" · ") || t("history.awards.kickerFallback") : ""}
            title={name}
            hint={t("history.awards.hint")}
            footer={item && (
                <>
                    {item.itemLink && (
                        <a className={buttonClass("ghost", "md", true)} href={item.itemLink} target="_blank" rel="noopener noreferrer">
                            <ExternalIcon />{t("history.shared.wowhead")}
                        </a>
                    )}
                    <Button onClick={close}>{t("common.close")}</Button>
                </>
            )}
        >
            {item && (
                <div className="hl-item-dlg" data-quality={item.itemQuality ?? ""}>
                    <div className="hl-dlg-badges">
                        {item.boss && <Badge icon={contentIcon(item.contentId)}>{item.boss}</Badge>}
                        {content
                            ? <Badge>{contentName(content.id, content.label)}</Badge>
                            : <Badge tip={t("history.shared.raidUnknown")} tipSub={t("history.awards.unknownSub")}>{t("history.awards.unknownRaid")}</Badge>}
                        {(tier || item.tokenTier) && (
                            <Badge tone="accent">{[tier?.label, item.tokenTier ? "Token" : ""].filter(Boolean).join(" · ")}</Badge>
                        )}
                    </div>

                    <div className="hl-kpi">
                        <div className="hl-kpi-num">
                            <span className="kicker">{t("history.awards.awards")}</span>
                            <b>{item.count}</b>
                        </div>
                        <div className="hl-kpi-reasons">
                            <StackBar parts={parts} size="wide" />
                            <div>
                                {parts.map((p) => (
                                    <ReasonBadge
                                        key={p.id} label={p.label} tone={p.tone} count={p.count}
                                        title={p.label !== p.reasonLabel ? t("history.shared.quoted", { text: p.label }) : undefined}
                                        tipSub={p.label !== p.reasonLabel ? t("history.awards.wordingSub", { reason: p.reasonLabel }) : undefined}
                                    />
                                ))}
                                {!!item.lastAwardedAt && <span className="last">{tParts("history.shared.last", { date: shortDay(item.lastAwardedAt) })}</span>}
                            </div>
                        </div>
                    </div>

                    <div className="hl-list">
                        <div className="hl-grid awards hl-th">
                            <span />
                            <span>{t("history.shared.colRaider")}</span>
                            <span className="hl-col-opt tipped" data-tip={t("history.shared.reason")} data-tip-sub={t("history.awards.reasonSub")}>{t("history.shared.reason")}</span>
                            <span className="hl-col-opt">{t("history.shared.colRaid")}</span>
                            <span className="hl-col-opt">{t("history.shared.colWhen")}</span>
                            <span />
                        </div>
                        {rows.map((a, i) => {
                            const colored = classColorProps(a.classColor);
                            const spec = a.spec ? `${a.spec}` : a.className;
                            return (
                                <div className="hl-grid awards" key={a.id || `${a.characterKey}-${a.awardedAt}-${i}`}>
                                    <span className="itile t-none" aria-hidden="true">
                                        {a.iconUrl ? <img className="hl-tile-img" src={a.iconUrl} alt="" loading="lazy" /> : <WowIcon name="inv_misc_questionmark" size={22} />}
                                    </span>
                                    <span className="hl-raider">
                                        <Link
                                            to={`/history/char?name=${encodeURIComponent(a.character)}`}
                                            className={colored.className || undefined}
                                            style={{ ...colored.style, fontWeight: 700, textDecoration: "none" }}
                                        >
                                            {a.character}
                                        </Link>
                                        {spec && <span className="spec">{spec}</span>}
                                    </span>
                                    <span className="hl-col-opt">
                                        <ReasonBadge
                                            label={a.response || a.reasonLabel}
                                            tone={a.reasonTone}
                                            title={a.response ? t("history.awards.responseTitle", { response: a.response, reason: a.reasonLabel }) : a.reasonLabel}
                                            tipSub={a.response ? t("history.awards.responseSub") : undefined}
                                        />
                                    </span>
                                    <span className="hl-col-opt">
                                        <Badge className="hl-ev" icon={contentIcon(item.contentId)} tip={a.eventLabel || a.eventId || t("history.shared.unknownRaid")}>
                                            {a.eventLabel || a.eventId || t("history.shared.unknownRaid")}
                                        </Badge>
                                    </span>
                                    <span className="hl-when hl-col-opt">{shortWhen(a.awardedAt)}</span>
                                    {canEdit && a.id
                                        ? (
                                            <IconButton
                                                icon={<TrashIcon />} tone="danger" size="sm"
                                                tip={t("history.awards.deleteTip")} tipSub={t("history.awards.deleteSub")}
                                                disabled={busyId === a.id}
                                                onClick={() => remove(a.id, a.character)}
                                            />
                                        )
                                        : <span />}
                                </div>
                            );
                        })}
                        {hidden > 0 && (
                            <div className="hl-list-more">
                                <Expand
                                    open={showAll}
                                    onToggle={() => setShowAll((v) => !v)}
                                    label={showAll ? t("history.awards.hideOlder") : t("history.awards.older", { count: hidden })}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}

/** One raider's items for one reason — what a reason badge in "Gründe" opens. */
export function RaiderReasonDialog({ raider, bucket, contents, onClose }: {
    raider: CharReasonRow | null;
    bucket: CharReasonBucket | null;
    contents: LootContent[];
    onClose: () => void;
}) {
    const t = useT();
    const open = !!(raider && bucket);
    const specLabel = raider?.className ? (raider.spec ? `${raider.spec} ${raider.className}` : raider.className) : "";
    const contentLabel = (id: string) => contents.find((c) => c.id === id)?.label || "";
    return (
        <Modal
            open={open}
            onClose={onClose}
            width={720}
            icon={raider?.iconUrl ? <img className="hl-tile-img" src={raider.iconUrl} alt="" /> : "inv_misc_bag_10"}
            tone="history"
            kicker={[specLabel, bucket ? t("history.awards.reasonKicker", { reason: bucket.reasonLabel }) : ""].filter(Boolean).join(" · ")}
            title={raider && bucket ? `${raider.character} · ${bucket.label}` : ""}
            footer={raider && (
                <>
                    <Link className={buttonClass("ghost")} to={`/history/char?name=${encodeURIComponent(raider.character)}`}>{t("history.shared.lootHistory")}</Link>
                    <Button onClick={onClose}>{t("common.close")}</Button>
                </>
            )}
        >
            {raider && bucket && (
                <>
                    <div className="hl-dlg-badges">
                        <ReasonBadge label={bucket.label} tone={bucket.tone} count={bucket.count} />
                        <Badge count>{tParts("history.awards.itemsTotal", { count: raider.count })}</Badge>
                    </div>
                    <div className="hl-list">
                        <div className="hl-grid raider-items hl-th">
                            <span>{t("history.shared.colItem")}</span>
                            <span className="hl-col-opt">{t("history.shared.colRaid")}</span>
                            <span className="hl-col-opt">{t("history.shared.colWhen")}</span>
                        </div>
                        {bucket.items.map((it, i) => (
                            <div className="hl-grid raider-items" key={`${it.itemId}-${it.awardedAt}-${i}`}>
                                <span className="hl-item">
                                    <ItemIcon url={it.itemIconUrl} quality={it.itemQuality} />
                                    <span className="hl-item-text">
                                        {it.itemLink
                                            ? <a {...itemQualityProps(it.itemQuality, "hl-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || t("history.shared.itemFallback", { id: it.itemId })}</a>
                                            : <span {...itemQualityProps(it.itemQuality, "hl-item-name")}>{it.itemName || t("history.shared.itemFallback", { id: it.itemId })}</span>}
                                        <span className="hl-item-sub">
                                            {it.response && it.response !== bucket.label ? t("history.awards.responsePrefix", { response: it.response }) : ""}{contentLabel(it.contentId) || t("history.shared.raidUnknown")}
                                        </span>
                                    </span>
                                </span>
                                <span className="hl-col-opt">
                                    <Badge className="hl-ev" icon={contentIcon(it.contentId)} tip={it.eventLabel || t("history.shared.unknownRaid")}>{it.eventLabel || t("history.shared.unknownRaid")}</Badge>
                                </span>
                                <span className="hl-when hl-col-opt">{shortWhen(it.awardedAt)}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
}
