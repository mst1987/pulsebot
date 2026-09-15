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
} from "../api";
import { itemQualityProps } from "../lib/itemQuality";
import { Modal, useConfirm } from "./ui/Modal";
import { Button, IconButton, buttonClass } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import WowIcon from "./ui/WowIcon";
import { ExternalIcon, TrashIcon } from "./icons";
import { classColorProps } from "./ClassSpec";
import { ItemIcon, ReasonBadge, StackBar, contentIcon, tallyReasons } from "./LootBadges";
import { useToast } from "./Jobs";

// Newest awards shown right away; the rest behind the expand control, so a
// token handed out forty times does not push the foot off the screen.
const FIRST_ROWS = 5;

const DISPLAY_TZ = "Europe/Berlin";

/** "11.09. 22:48" — the year is in the event name already. */
export function shortWhen(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleString("de-DE", { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "Do 11.09." */
export function shortDay(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("de-DE", { timeZone: DISPLAY_TZ, weekday: "short", day: "2-digit", month: "2-digit" }).replace(",", "");
}

export function ItemAwardsDialog({ item, contents, tiers, reasons, canEdit, csrfToken, onClose, onChanged }: {
    /** null keeps the dialog closed. */
    item: LootCatalogItem | null;
    contents: LootContent[];
    tiers: LootTier[];
    reasons: LootReason[];
    canEdit: boolean;
    csrfToken: string | null;
    onClose: () => void;
    /** After a delete: toast + reload the overview. */
    onChanged: (msg: string) => void;
}) {
    const ask = useConfirm();
    const toast = useToast();
    const [showAll, setShowAll] = useState(false);
    const [busyId, setBusyId] = useState("");

    const content = item ? contents.find((c) => c.id === item.contentId) : undefined;
    const tier = item ? tiers.find((t) => t.id === (item.tokenTier || item.tier)) : undefined;
    const name = item ? (item.itemName || `Item ${item.itemId}`) : "";
    const parts = item ? tallyReasons(item.awards, reasons) : [];
    const rows = item ? (showAll ? item.awards : item.awards.slice(0, FIRST_ROWS)) : [];
    const hidden = item ? item.awards.length - FIRST_ROWS : 0;

    const close = () => { setShowAll(false); onClose(); };

    const remove = async (awardId: string, character: string) => {
        if (!(await ask({ title: "Vergabe löschen?", text: `„${name}" von ${character} wird aus dem Loot gelöscht. Ein erneuter Import desselben Exports bringt sie zurück.`, action: "Löschen" }))) return;
        setBusyId(awardId);
        try {
            await deleteLootItems(csrfToken, [awardId]);
            onChanged(`„${name}" von ${character} gelöscht.`);
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
            kicker={item ? [item.boss, content?.label].filter(Boolean).join(" · ") || "Item" : ""}
            title={name}
            hint="Klick auf einen Namen öffnet seine Loot-Historie"
            footer={item && (
                <>
                    {item.itemLink && (
                        <a className={buttonClass("ghost", "md", true)} href={item.itemLink} target="_blank" rel="noopener noreferrer">
                            <ExternalIcon />Auf Wowhead
                        </a>
                    )}
                    <Button onClick={close}>Schließen</Button>
                </>
            )}
        >
            {item && (
                <div className="hl-item-dlg" data-quality={item.itemQuality ?? ""}>
                    <div className="hl-dlg-badges">
                        {item.boss && <Badge icon={contentIcon(item.contentId)}>{item.boss}</Badge>}
                        {content
                            ? <Badge>{content.label}</Badge>
                            : <Badge tip="Raid unbekannt" tipSub="Das Item steht nicht in der Content-Tabelle (scripts/fetch-tbc-loot.js).">unbekannter Raid</Badge>}
                        {(tier || item.tokenTier) && (
                            <Badge tone="accent">{[tier?.label, item.tokenTier ? "Token" : ""].filter(Boolean).join(" · ")}</Badge>
                        )}
                    </div>

                    <div className="hl-kpi">
                        <div className="hl-kpi-num">
                            <span className="kicker">Vergaben</span>
                            <b>{item.count}</b>
                        </div>
                        <div className="hl-kpi-reasons">
                            <StackBar parts={parts} size="wide" />
                            <div>
                                {parts.map((p) => (
                                    <ReasonBadge
                                        key={p.id} label={p.label} tone={p.tone} count={p.count}
                                        title={p.label !== p.reasonLabel ? `„${p.label}"` : undefined}
                                        tipSub={p.label !== p.reasonLabel ? `Wortlaut des Addons · Grund ${p.reasonLabel}` : undefined}
                                    />
                                ))}
                                {!!item.lastAwardedAt && <span className="last">zuletzt {shortDay(item.lastAwardedAt)}</span>}
                            </div>
                        </div>
                    </div>

                    <div className="hl-list">
                        <div className="hl-grid awards hl-th">
                            <span />
                            <span>Raider</span>
                            <span className="hl-col-opt tipped" data-tip="Grund" data-tip-sub="Farbe = Grund-Kategorie; der Tooltip am Badge nennt den Wortlaut des Addons.">Grund</span>
                            <span className="hl-col-opt">Raid</span>
                            <span className="hl-col-opt">Wann</span>
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
                                            title={a.response ? `„${a.response}" · ${a.reasonLabel}` : a.reasonLabel}
                                            tipSub={a.response ? "Wortlaut des Loot-Addons, eingeordnet unter dem Grund dahinter." : undefined}
                                        />
                                    </span>
                                    <span className="hl-col-opt">
                                        <Badge className="hl-ev" icon={contentIcon(item.contentId)} tip={a.eventLabel || a.eventId || "Unbekannter Raid"}>
                                            {a.eventLabel || a.eventId || "Unbekannter Raid"}
                                        </Badge>
                                    </span>
                                    <span className="hl-when hl-col-opt">{shortWhen(a.awardedAt)}</span>
                                    {canEdit && a.id
                                        ? (
                                            <IconButton
                                                icon={<TrashIcon />} tone="danger" size="sm"
                                                tip="Vergabe löschen" tipSub="Nur dieser eine Eintrag — mit Rückfrage."
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
                                    label={showAll ? "Ältere ausblenden" : `${hidden} ältere Vergabe${hidden === 1 ? "" : "n"}`}
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
            kicker={[specLabel, bucket ? `Grund ${bucket.reasonLabel}` : ""].filter(Boolean).join(" · ")}
            title={raider && bucket ? `${raider.character} · ${bucket.label}` : ""}
            footer={raider && (
                <>
                    <Link className={buttonClass("ghost")} to={`/history/char?name=${encodeURIComponent(raider.character)}`}>Loot-Historie</Link>
                    <Button onClick={onClose}>Schließen</Button>
                </>
            )}
        >
            {raider && bucket && (
                <>
                    <div className="hl-dlg-badges">
                        <ReasonBadge label={bucket.label} tone={bucket.tone} count={bucket.count} />
                        <Badge count>{raider.count} Items gesamt</Badge>
                    </div>
                    <div className="hl-list">
                        <div className="hl-grid raider-items hl-th">
                            <span>Item</span>
                            <span className="hl-col-opt">Raid</span>
                            <span className="hl-col-opt">Wann</span>
                        </div>
                        {bucket.items.map((it, i) => (
                            <div className="hl-grid raider-items" key={`${it.itemId}-${it.awardedAt}-${i}`}>
                                <span className="hl-item">
                                    <ItemIcon url={it.itemIconUrl} quality={it.itemQuality} />
                                    <span className="hl-item-text">
                                        {it.itemLink
                                            ? <a {...itemQualityProps(it.itemQuality, "hl-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                            : <span {...itemQualityProps(it.itemQuality, "hl-item-name")}>{it.itemName || `Item ${it.itemId}`}</span>}
                                        <span className="hl-item-sub">
                                            {it.response && it.response !== bucket.label ? `„${it.response}" · ` : ""}{contentLabel(it.contentId) || "Raid unbekannt"}
                                        </span>
                                    </span>
                                </span>
                                <span className="hl-col-opt">
                                    <Badge className="hl-ev" icon={contentIcon(it.contentId)} tip={it.eventLabel || "Unbekannter Raid"}>{it.eventLabel || "Unbekannter Raid"}</Badge>
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
