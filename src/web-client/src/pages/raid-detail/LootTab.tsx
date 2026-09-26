// Tab "Loot": what this raid handed out, grouped under whoever got it (or under
// the boss it dropped from), with one "Loot hinzufügen" in the part head. Import
// and nachtragen live in the dialog; deleting asks in the confirm dialog.
import { useMemo, useState } from "react";
import type { LootItem } from "../../api";
import { clearHistoryEvent, deleteLootItems, type ApiError } from "../../api";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { usePersistedState } from "../../lib/persistedState";
import { PartHead } from "../../components/ui/PartHead";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import Expand from "../../components/ui/Expand";
import Segment from "../../components/ui/Segment";
import { useConfirm } from "../../components/ui/Modal";
import { SearchIcon, TrashIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import { reasonToneClass } from "../../components/LootBadges";
import { LOOT_TOOL_LABELS, type RaidCtx } from "./meta";
import SpecTile from "./SpecTile";
import { locale, t, useT } from "../../i18n";

type GroupBy = "character" | "boss";

// Reasons that did nothing for the raider's set sit in their own group, like the
// loot council treats them (countsAsLoot in src/utils/lootReasons.js).
const ASIDE_REASONS = new Set(["disenchant", "bank"]);
const COUNTING_REASONS = new Set(["bis", "mainspec", "upgrade", "minor", "other"]);

const itemLabel = (it: LootItem) => it.itemName || t("raidDetail.loot.itemFallback", { id: it.itemId });
const reasonText = (it: LootItem) => it.response || it.reasonLabel || (it.offspec ? "Offspec" : "Mainspec");

type Group = { key: string; title: string; aside?: boolean; items: LootItem[]; head?: LootItem };

function buildGroups(items: LootItem[], by: GroupBy): Group[] {
    const map = new Map<string, Group>();
    const aside: Group = { key: "__aside", title: t("raidDetail.loot.aside"), aside: true, items: [] };
    for (const it of items) {
        if (by === "character" && ASIDE_REASONS.has(it.reason)) { aside.items.push(it); continue; }
        const key = by === "character" ? it.character.toLowerCase() : (it.boss || "");
        const title = by === "character" ? it.character : (it.boss || t("raidDetail.loot.noBoss"));
        if (!map.has(key)) map.set(key, { key, title, items: [], head: it });
        map.get(key)!.items.push(it);
    }
    const groups = [...map.values()].sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title, locale()));
    return aside.items.length ? [...groups, aside] : groups;
}

function ReasonBadge({ it }: { it: LootItem }) {
    const t = useT();
    const label = reasonText(it);
    const counts = COUNTING_REASONS.has(it.reason);
    return (
        <span
            className={reasonToneClass(it.reasonTone)}
            data-tip={it.reasonLabel && it.reasonLabel !== label ? `${label} · ${it.reasonLabel}` : label}
            data-tip-sub={counts ? t("raidDetail.loot.counts") : t("raidDetail.loot.notCounts")}
        >
            {label}
        </span>
    );
}

export default function LootTab({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const { data, onChanged, openModal } = ctx;
    const ask = useConfirm();
    const [groupBy, setGroupBy] = usePersistedState<GroupBy>("raid-detail-loot-group", "character");
    const [query, setQuery] = useState("");
    const [openKeys, setOpenKeys] = useState<string[] | null>(null);
    const [busyId, setBusyId] = useState("");
    const [clearing, setClearing] = useState(false);

    const items = data.lootItems;
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((it) => itemLabel(it).toLowerCase().includes(q) || it.character.toLowerCase().includes(q) || (it.boss || "").toLowerCase().includes(q));
    }, [items, query]);
    const groups = useMemo(() => buildGroups(filtered, groupBy), [filtered, groupBy]);
    // Until somebody folds a group by hand, the first one is open (and every
    // group while searching — a hit hidden in a closed group is no hit).
    const isOpen = (key: string) => (query.trim() ? true : openKeys ? openKeys.includes(key) : groups[0]?.key === key);
    const toggle = (key: string) => {
        const current = openKeys ?? (groups[0] ? [groups[0].key] : []);
        setOpenKeys(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
    };

    const reasonCounts = useMemo(() => {
        const m = new Map<string, { label: string; tone: string; n: number }>();
        for (const it of items) {
            const k = it.reason || "other";
            const entry = m.get(k) || { label: it.reasonLabel || reasonText(it), tone: it.reasonTone, n: 0 };
            entry.n += 1;
            m.set(k, entry);
        }
        return [...m.values()].sort((a, b) => b.n - a.n);
    }, [items]);

    const raiders = new Set(items.map((it) => it.character.toLowerCase())).size;
    const lastImport = items.reduce((max, it) => Math.max(max, it.awardedAt || 0), 0);

    const removeItem = async (it: LootItem) => {
        if (!(await ask({ title: t("raidDetail.loot.deleteTitle"), text: t("raidDetail.loot.deleteText", { item: itemLabel(it), character: it.character }), action: t("raidDetail.loot.deleteAction") }))) return;
        setBusyId(it.id);
        try {
            await deleteLootItems([it.id]);
            onChanged(t("raidDetail.loot.deleted", { item: itemLabel(it) }));
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setBusyId("");
        }
    };

    const clearAll = async () => {
        if (!(await ask({ title: t("raidDetail.loot.clearTitle"), text: t("raidDetail.loot.clearText", { count: items.length }), action: t("raidDetail.loot.clearAction") }))) return;
        setClearing(true);
        try {
            const r = await clearHistoryEvent(ctx.eventId);
            onChanged(t("raidDetail.loot.cleared", { count: r.removed }));
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setClearing(false);
        }
    };

    const crumb = items.length
        ? (lastImport
            ? t("raidDetail.loot.crumbLast", { items: items.length, raiders, date: fmtMs(lastImport) })
            : t("raidDetail.loot.crumb", { items: items.length, raiders }))
        : t("raidDetail.loot.crumbEmpty");

    return (
        <section className="panel rd-panel">
            <PartHead
                icon="inv_misc_bag_10"
                tone="history"
                title={t("raidDetail.loot.title")}
                crumb={crumb}
                action={<Button size="sm" icon="inv_misc_bag_10" onClick={() => openModal("loot")}>{t("raidDetail.loot.add")}</Button>}
            />

            {!items.length ? (
                <p className="rd-empty">{t("raidDetail.loot.empty")}</p>
            ) : (
                <>
                    <div className="rd-toolbar">
                        <Segment<GroupBy>
                            ariaLabel={t("raidDetail.loot.groupAria")}
                            size="sm"
                            value={groupBy}
                            onChange={(v) => { setGroupBy(v); setOpenKeys(null); }}
                            options={[
                                { value: "character", label: t("raidDetail.loot.byRaider"), icon: "achievement_guildperk_everybodysfriend" },
                                { value: "boss", label: t("raidDetail.loot.byBoss"), icon: "achievement_boss_illidan" },
                            ]}
                        />
                        <label className="rd-search">
                            <SearchIcon />
                            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("raidDetail.loot.searchPlaceholder")} aria-label={t("raidDetail.loot.searchAria")} />
                        </label>
                        <span className="rd-reasons">
                            {reasonCounts.map((r) => (
                                <span key={r.label} className={reasonToneClass(r.tone)}>{r.label}<span className="rbadge-count">{r.n}</span></span>
                            ))}
                        </span>
                    </div>

                    <div className="rd-glist rd-loot">
                        <div className="rd-loot-row rd-loot-th" aria-hidden="true">
                            <span>{t("raidDetail.loot.colItem")}</span><span>{groupBy === "character" ? t("raidDetail.loot.colBoss") : t("raidDetail.loot.colRaider")}</span><span>{t("raidDetail.loot.colReason")}</span><span>{t("raidDetail.loot.colTime")}</span><span>{t("raidDetail.loot.colSource")}</span><span />
                        </div>
                        {groups.map((g) => {
                            const open = isOpen(g.key);
                            const reasons = [...new Map(g.items.map((it) => [it.reason, it])).values()];
                            return (
                                <div key={g.key} className="rd-loot-grp">
                                    <div className={`rd-grp${open ? " open" : ""}`} style={g.head?.classColor && groupBy === "character" ? { "--cc": g.head.classColor } as React.CSSProperties : undefined}>
                                        {g.aside
                                            ? <IconTile icon="inv_misc_gem_variety_02" tone="none" />
                                            : groupBy === "character"
                                                ? g.head?.specIconUrl
                                                    ? <SpecTile iconUrl={g.head.specIconUrl} classColor={g.head.classColor} />
                                                    : <IconTile icon="achievement_guildperk_everybodysfriend" tone="none" />
                                                : <IconTile icon="inv_misc_bag_10" tone="none" />}
                                        <b {...(groupBy === "character" && !g.aside ? classColorProps(g.head?.classColor) : {})}>{g.title}</b>
                                        {groupBy === "character" && !g.aside && g.head?.className && (
                                            <span className="rd-grp-sub">{g.head.spec ? `${g.head.spec} ${g.head.className}` : g.head.className}</span>
                                        )}
                                        <Badge count>{g.items.length}</Badge>
                                        {!g.aside && reasons.slice(0, 3).map((it) => <ReasonBadge key={it.reason} it={it} />)}
                                        <Expand open={open} onToggle={() => toggle(g.key)} showLabel={!open} />
                                    </div>
                                    {open && g.items.map((it) => (
                                        <div key={it.id} className="rd-loot-row">
                                            <span className="rd-item">
                                                {it.itemIconUrl ? <img src={it.itemIconUrl} alt="" loading="lazy" /> : <span className="rd-item-ph" />}
                                                {it.itemLink
                                                    ? <a {...itemQualityProps(it.itemQuality, "rd-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{itemLabel(it)}</a>
                                                    : <span {...itemQualityProps(it.itemQuality, "rd-item-name")}>{itemLabel(it)}</span>}
                                            </span>
                                            <span className="rd-muted">
                                                {groupBy === "character" ? (it.boss || "—") : <span {...classColorProps(it.classColor)}>{it.character}</span>}
                                            </span>
                                            <span><ReasonBadge it={it} /></span>
                                            <span className="rd-mono" data-tip={fmtMs(it.awardedAt)}>{it.awardedAt ? new Date(it.awardedAt).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : "—"}</span>
                                            <span><Badge>{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</Badge></span>
                                            <IconButton
                                                size="sm" tone="danger" icon={<TrashIcon />}
                                                tip={t("raidDetail.loot.deleteEntry")} tipSub={t("raidDetail.loot.entrySub", { item: itemLabel(it), character: it.character })}
                                                disabled={busyId === it.id} onClick={() => removeItem(it)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                        {!groups.length && <p className="rd-empty" style={{ padding: 14 }}>{t("raidDetail.loot.noHit", { query })}</p>}
                    </div>

                    <div className="rd-foot">
                        <span className="rd-muted">{groupBy === "character" ? t("raidDetail.loot.footGroups", { count: groups.length }) : t("raidDetail.loot.footBosses", { count: groups.length })}</span>
                        <Button variant="danger" size="sm" icon={<TrashIcon />} running={clearing} onClick={clearAll}>{t("raidDetail.loot.clearButton")}</Button>
                    </div>
                </>
            )}
        </section>
    );
}
