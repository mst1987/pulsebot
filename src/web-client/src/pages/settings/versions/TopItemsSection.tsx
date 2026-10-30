import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useOutletContext } from "react-router-dom";
import { canAccess, getTopItems, putTopItem, searchSettingsItems, type ApiError, type ItemSearchResult, type TopItem, type TopItemsPage } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import type { ShellContext } from "../../../components/shell/Shell";
import { useToast } from "../../../components/shell/Jobs";
import Segment from "../../../components/ui/form/Segment";
import Switch from "../../../components/ui/form/Switch";
import ItemSearchPicker from "../../../components/loot/ItemSearchPicker";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import { itemQualityColor, itemQualityProps } from "../../../lib/wow/itemQuality";
import { wowheadItemUrl } from "../../../lib/wow/wowheadItems";
import { refreshWowheadLinks } from "../../../lib/wow/wowheadTooltips";
import { UNASSIGNED, bossKey, bossOfItem, firstView, pickedCounts, unassignedItems } from "../../../lib/settings/topItems";
import { usePersistedState } from "../../../lib/ui/persistedState";
import { useT } from "../../../i18n";

/**
 * Einstellungen → Server → Top-Items (#952, canvas variant B "Boss-Schalter"):
 * per game version the raids and bosses of the version's loot table on the
 * left, the whole loot of one boss on the right, each item with a switch that
 * saves at once. The search adds items no boss drops — they gather under
 * "Ohne Zuordnung". Classic Era and Forever have no loot table yet (#760/#765),
 * so they show the search and "Ohne Zuordnung" only. Saves only ever go to the
 * loaded server; a tab left open after a server switch elsewhere gets 409.
 */
export default function TopItemsSection({ guildId }: { guildId: string }) {
    const t = useT();
    const toast = useToast();
    const ctx = useOutletContext<ShellContext | undefined>();
    const canWrite = !ctx?.user || canAccess(ctx.user, "settings", "write");
    const [version, setVersion] = useState("");
    const page = useApi(() => getTopItems(version), [version]);
    const data = page.data;
    // the open boss outlives a tab switch in the shell; a key the loaded
    // version does not know falls back to its start view below
    const [view, setView] = usePersistedState("settings-topitems-view", "");
    const [busy, setBusy] = useState<Set<number>>(() => new Set());
    const [switchedOff, setSwitchedOff] = useState<TopItem[]>([]);
    const [switched, setSwitched] = useState(false);

    const raids = useMemo(() => data?.raids || [], [data]);
    const picked = useMemo(() => data?.items || [], [data]);
    const pickedIds = useMemo(() => new Set(picked.map((it) => it.id)), [picked]);
    const counts = useMemo(() => pickedCounts(raids, picked), [raids, picked]);

    // a fresh version starts on its first boss with a pick, else its first boss
    const startView = useMemo(() => {
        for (const raid of raids) for (const boss of raid.bosses) if (counts.has(bossKey(raid.id, boss.name))) return bossKey(raid.id, boss.name);
        return firstView(raids);
    }, [raids, counts]);
    const known = view === UNASSIGNED || raids.some((r) => r.bosses.some((b) => bossKey(r.id, b.name) === view));
    const current = known ? view : startView;

    useEffect(() => { refreshWowheadLinks(); }, [data, current]);

    if (!guildId) return null;
    if (!data) {
        return page.error
            ? <div className="set-card set-form"><p className="field-error" role="alert">{page.error.message}</p></div>
            : <RaidLoader text={t("settings.topItems.loading")} />;
    }

    const changeVersion = (next: string) => {
        if (next === data.versionId) return;
        setVersion(next);
        setView("");
        setSwitchedOff([]);
    };

    const save = async (item: TopItem, on: boolean) => {
        setBusy((b) => new Set(b).add(item.id));
        try {
            const res = await putTopItem({ versionId: data.versionId, item, on, serverSettingsGuildId: guildId });
            page.setData((cur: TopItemsPage | null) => (cur && cur.versionId === res.versionId ? {
                ...cur,
                items: res.items,
                versions: cur.versions.map((v) => (v.id === res.versionId ? { ...v, count: res.items.length } : v)),
            } : cur));
            setSwitchedOff((list) => (on ? list.filter((it) => it.id !== item.id) : [...list.filter((it) => it.id !== item.id), item]));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "server_switched") setSwitched(true);
            else toast(e.code === "too_many" ? t("settings.topItems.tooMany", { max: data.max }) : e.message, "err");
        } finally {
            setBusy((b) => { const n = new Set(b); n.delete(item.id); return n; });
        }
    };

    const pickSearched = (it: ItemSearchResult) => {
        const item: TopItem = { id: it.id, name: it.name, iconUrl: it.iconUrl || "", quality: it.quality ?? null };
        setView(bossOfItem(raids, it.id) || UNASSIGNED);
        if (!pickedIds.has(it.id)) void save(item, true);
    };

    const loose = unassignedItems(raids, picked, switchedOff);
    const raid = raids.find((r) => r.bosses.some((b) => bossKey(r.id, b.name) === current));
    const boss = raid?.bosses.find((b) => bossKey(raid.id, b.name) === current);
    const rows = boss ? boss.items : loose;
    const title = boss ? boss.name : t("settings.topItems.unassigned");
    const countText = (n: number) => t("settings.topItems.picked", { count: n });

    const row = (item: TopItem) => {
        const on = pickedIds.has(item.id);
        const url = wowheadItemUrl(item.id, [], data.wowheadPath);
        const color = itemQualityColor(item.quality);
        const name = item.name || t("settings.topItems.itemId", { id: item.id });
        return (
            <li key={item.id} className={`tis-row${on ? " is-on" : ""}`}>
                <Switch
                    checked={on}
                    disabled={!canWrite || switched || busy.has(item.id)}
                    tipHead={canWrite ? undefined : t("settings.topItems.readOnly")}
                    onChange={(next) => { void save(item, next); }}
                    label={(
                        <>
                            {item.iconUrl
                                ? <img className="tis-ico" src={item.iconUrl} alt="" loading="lazy" style={color ? { "--iqb": color } as CSSProperties : undefined} />
                                : <span className="tis-ico" aria-hidden="true" />}
                            {url
                                ? <a href={url} target="_blank" rel="noopener noreferrer" {...itemQualityProps(item.quality, "tis-name")}>{name}</a>
                                : <span {...itemQualityProps(item.quality, "tis-name")}>{name}</span>}
                        </>
                    )}
                />
            </li>
        );
    };

    return (
        <div className="set-card tis" id="top-items">
            <div className="tis-head">
                <Segment
                    ariaLabel={t("settings.topItems.version")}
                    size="sm"
                    value={data.versionId}
                    onChange={changeVersion}
                    options={data.versions.map((v) => ({
                        value: v.id,
                        label: v.count ? `${v.short || v.label} · ${countText(v.count)}` : (v.short || v.label),
                        tip: v.label,
                        tipSub: v.id === data.mainVersion ? t("settings.topItems.mainVersion") : undefined,
                    }))}
                />
                {canWrite && !switched && (
                    <div className="tis-search">
                        <ItemSearchPicker
                            search={(q) => searchSettingsItems(q, data.versionId)}
                            onPick={pickSearched}
                            placeholder={t("settings.topItems.search")}
                        />
                    </div>
                )}
            </div>
            {switched && <p className="field-error tis-note" role="alert">{t("settings.serverSwitched")}</p>}

            <div className="tis-body">
                <nav className="tis-nav" aria-label={t("settings.topItems.bosses")}>
                    {raids.map((r) => (
                        <div key={r.id} className="tis-raid">
                            <div className="tis-raid-name" data-tip={r.label} data-tip-sub={r.tierLabel || undefined}>{r.label}</div>
                            {r.bosses.map((b) => {
                                const key = bossKey(r.id, b.name);
                                const n = counts.get(key) || 0;
                                return (
                                    <button key={key} type="button" className={`tis-boss${key === current ? " tis-current" : ""}`} aria-current={key === current || undefined} onClick={() => setView(key)}>
                                        <span className="tis-boss-name">{b.name}</span>
                                        {n > 0 && <span className="tis-count">{countText(n)}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    <div className="tis-raid">
                        {raids.length > 0 && <div className="tis-raid-name">{t("settings.topItems.other")}</div>}
                        <button type="button" className={`tis-boss${current === UNASSIGNED ? " tis-current" : ""}`} aria-current={current === UNASSIGNED || undefined} onClick={() => setView(UNASSIGNED)}>
                            <span className="tis-boss-name">{t("settings.topItems.unassigned")}</span>
                            {(counts.get(UNASSIGNED) || 0) > 0 && <span className="tis-count">{countText(counts.get(UNASSIGNED) || 0)}</span>}
                        </button>
                    </div>
                </nav>

                {/* a phone: the same choice as one select above the list */}
                <select className="tis-pick" aria-label={t("settings.topItems.bosses")} value={current} onChange={(e) => setView(e.target.value)}>
                    {raids.map((r) => (
                        <optgroup key={r.id} label={r.label}>
                            {r.bosses.map((b) => {
                                const key = bossKey(r.id, b.name);
                                const n = counts.get(key) || 0;
                                return <option key={key} value={key}>{n ? `${b.name} · ${countText(n)}` : b.name}</option>;
                            })}
                        </optgroup>
                    ))}
                    <option value={UNASSIGNED}>{t("settings.topItems.unassigned")}</option>
                </select>

                <section className="tis-list" aria-label={title}>
                    <div className="tis-list-head">
                        <h3>{title}</h3>
                        {raid && <span className="tis-sub">{raid.label}</span>}
                    </div>
                    {!boss && (
                        <p className="tis-hint">
                            {raids.length ? t("settings.topItems.unassignedHint") : t("settings.topItems.noTable", { version: data.versions.find((v) => v.id === data.versionId)?.label || data.versionId })}
                        </p>
                    )}
                    {rows.length > 0
                        ? <ul className="tis-rows">{rows.map(row)}</ul>
                        : !boss && <p className="tis-empty">{t("settings.topItems.noneUnassigned")}</p>}
                </section>
            </div>
        </div>
    );
}
