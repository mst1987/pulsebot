// The "BiS-Listen" tab of a version without BiS data of its own (#760, today
// WoW Forever): the orga keeps the lists by hand, per spec and slot. One spec at
// a time - picked by its icon - and its slots as rows; per slot the BiS piece
// first, further pieces count as equally good. Items come from Wowhead of the
// version; where that cannot answer (no path, or Wowhead does not know Forever
// yet) an item id is enough, and the row says so instead of inventing a name.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
    getManualBis, saveManualBisSlot, searchManualBisItems,
    type ApiError, type ItemSearchResult, type ManualBisData, type ManualBisItem,
} from "../../../api";
import { Badge, Button, IconButton, WowIcon } from "../../../components/ui";
import { ChevronUpIcon, PlusIcon, XIcon } from "../../../components/ui/icons/icons";
import ItemSearchPicker from "../../../components/loot/ItemSearchPicker";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import { useToast } from "../../../components/shell/Jobs";
import { useT } from "../../../i18n";
import { slotLabel } from "../../../lib/wow/wowNames";
import { formatDate } from "../../../lib/format";
import { refreshWowheadLinks } from "../../../lib/wow/wowheadTooltips";
import { ItemLink } from "../ItemBits";
import { Part } from "../Part";
import { ROLE_ICON } from "../model/council";

const ROLE_ORDER = ["caster", "healer", "tank", "melee", "ranged"];

/** The add row of one slot: Wowhead of the version, and an item id as the quiet fallback. */
function SlotAdder({ versionId, search, busy, taken, onAdd }: {
    versionId: string;
    search: boolean;
    busy: boolean;
    /** The ids already in the slot: the search leaves them out (Wowhead's suggestions carry no slot to filter by). */
    taken: number[];
    onAdd: (id: number) => void;
}) {
    const t = useT();
    const [idText, setIdText] = useState("");
    const takenKey = taken.join(",");
    const lookup = useCallback(async (q: string) => {
        const answer = await searchManualBisItems(versionId, q);
        const skip = new Set(takenKey.split(",").map(Number));
        const seen = new Set<number>();
        return { ...answer, items: answer.items.filter((it) => !skip.has(it.id) && !seen.has(it.id) && seen.add(it.id)) };
    }, [versionId, takenKey]);
    const id = Number(idText.trim());
    const validId = Number.isInteger(id) && id > 0;
    const addId = () => { if (validId) { onAdd(id); setIdText(""); } };
    return (
        <div className="lc-mb-add">
            {search ? (
                <div className="lc-mb-search">
                    <ItemSearchPicker search={lookup} onPick={(it: ItemSearchResult) => onAdd(it.id)} placeholder={t("lootcouncil.manualBis.searchPlaceholder")} />
                </div>
            ) : null}
            <div className="lc-mb-idrow">
                <input
                    type="text"
                    inputMode="numeric"
                    className="inp-sm lc-mb-id"
                    value={idText}
                    placeholder={t("lootcouncil.manualBis.idPlaceholder")}
                    aria-label={t("lootcouncil.manualBis.idPlaceholder")}
                    onChange={(e) => setIdText(e.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter") addId(); }}
                />
                <Button variant="go" icon={<PlusIcon />} disabled={!validId} running={busy} onClick={addId}>
                    {t("lootcouncil.manualBis.addById")}
                </Button>
            </div>
        </div>
    );
}

/** One item of a slot: the item, its place (BiS or alternative), and - for a writer - move up and remove. */
function SlotItem({ item, index, canWrite, busy, onFirst, onRemove }: {
    item: ManualBisItem;
    index: number;
    canWrite: boolean;
    busy: boolean;
    onFirst: () => void;
    onRemove: () => void;
}) {
    const t = useT();
    const name = item.name || t("lootcouncil.manualBis.itemId", { id: item.id });
    return (
        <li className={`lc-mb-item${index === 0 ? " is-bis" : ""}`}>
            <ItemLink id={item.id} name={name} iconUrl={item.iconUrl} quality={item.quality} />
            {index === 0
                ? <Badge tone="ok" tip={t("lootcouncil.manualBis.bisTip")}>{t("lootcouncil.manualBis.bis")}</Badge>
                : <Badge tip={t("lootcouncil.manualBis.altTip")}>{t("lootcouncil.manualBis.alt")}</Badge>}
            {!item.name ? <Badge tone="mid" tip={t("lootcouncil.manualBis.unknownTip")} tipSub={t("lootcouncil.manualBis.unknownTipSub")}>?</Badge> : null}
            {canWrite ? (
                <span className="lc-mb-acts">
                    {index > 0 ? <IconButton size="sm" tone="ghost" icon={<ChevronUpIcon />} tip={t("lootcouncil.manualBis.makeBis")} disabled={busy} onClick={onFirst} /> : null}
                    <IconButton size="sm" tone="danger" icon={<XIcon />} tip={t("lootcouncil.manualBis.remove", { name })} disabled={busy} onClick={onRemove} />
                </span>
            ) : null}
        </li>
    );
}

export function ManualBisTab({ versionId, canWrite, onSaved }: {
    versionId: string;
    canWrite: boolean;
    /** The council's numbers follow the lists - the page reloads them after a change. */
    onSaved: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [data, setData] = useState<ManualBisData | null>(null);
    const [failed, setFailed] = useState("");
    const [spec, setSpec] = useState("");
    const [adding, setAdding] = useState<number | null>(null);
    const [busySlot, setBusySlot] = useState<number | null>(null);

    useEffect(() => {
        let alive = true;
        getManualBis(versionId)
            .then((d) => {
                if (!alive) return;
                setData(d);
                setFailed("");
                // Open the first spec with a list, else the first spec at all.
                setSpec((cur) => cur || (d.specs.find((s) => s.filled) || d.specs[0] || { key: "" }).key);
            })
            .catch((e: ApiError) => { if (alive) setFailed(e.message || t("lootcouncil.manualBis.loadFailed")); });
        return () => { alive = false; };
    }, [versionId, t]);

    useEffect(() => { refreshWowheadLinks(); }, [data, spec]);

    const groups = useMemo(() => {
        const specs = data ? data.specs : [];
        return ROLE_ORDER.map((role) => ({ role, specs: specs.filter((s) => s.role === role) })).filter((g) => g.specs.length);
    }, [data]);

    if (failed) return <div className="lc-panel empty">{failed}</div>;
    if (!data) return <RaidLoader text={t("lootcouncil.manualBis.loading")} compact />;
    if (!data.available) {
        return <div className="lc-panel empty" role="note">{t(data.off ? "lootcouncil.noContent.off" : "lootcouncil.manualBis.notHere")}</div>;
    }

    const current = data.specs.find((s) => s.key === spec) || null;
    const list = (current && data.lists[current.key]) || { slots: {}, at: 0, by: "" };
    const filledSlots = Object.keys(list.slots).length;

    const save = async (slot: number, ids: number[]) => {
        if (!current) return;
        setBusySlot(slot);
        try {
            const next = await saveManualBisSlot(data.versionId, current.key, slot, ids);
            setData(next);
            // only the ids this save added that Wowhead does not know (the server filters) - a hint, not a success
            if (next.unresolved.length) toast(t("lootcouncil.manualBis.unresolved", { ids: next.unresolved.join(", ") }), "warn");
            onSaved();
        } catch (err) {
            toast((err as ApiError).message || t("lootcouncil.page.actionFailed"), "err");
        } finally {
            setBusySlot(null);
        }
    };

    return (
        <>
            <Part
                icon="wishlist"
                crumb={t("lootcouncil.manualBis.crumb", { version: data.versionLabel })}
                title={t("lootcouncil.manualBis.specTitle")}
                hint={t("lootcouncil.manualBis.specHint")}
            >
                <div className="lc-mb-groups">
                    {groups.map((g) => (
                        <div key={g.role} className="lc-mb-group">
                            <span className="lc-mb-role" data-tip={t(`lootcouncil.role.${g.role}`)}>
                                <WowIcon name={ROLE_ICON[g.role]} size={18} />
                                <span>{t(`lootcouncil.role.${g.role}`)}</span>
                            </span>
                            <span className="lc-mb-specs">
                                {g.specs.map((s) => (
                                    <button
                                        key={s.key}
                                        type="button"
                                        className={`lc-mb-spec${s.key === spec ? " on" : ""}${s.filled ? " filled" : ""}`}
                                        style={{ "--cc": s.classColor || "var(--line)" } as CSSProperties}
                                        aria-pressed={s.key === spec}
                                        aria-label={s.label}
                                        data-tip={s.label}
                                        data-tip-sub={t("lootcouncil.manualBis.filled", { count: s.filled, total: data.slots.length })}
                                        onClick={() => { setSpec(s.key); setAdding(null); }}
                                    >
                                        {s.iconUrl ? <img src={s.iconUrl} alt="" loading="lazy" /> : <WowIcon name="inv_misc_questionmark" size={30} />}
                                        {/* a list exists: a mark, the count with its word is in the tooltip */}
                                        {s.filled ? <span className="lc-mb-dot" aria-hidden="true" /> : null}
                                    </button>
                                ))}
                            </span>
                        </div>
                    ))}
                </div>
                {!data.search ? <p className="lc-mb-note" role="note">{t("lootcouncil.manualBis.noSearch", { version: data.versionLabel })}</p> : null}
            </Part>

            {current ? (
                <Part
                    tone="accent"
                    icon="wishlist"
                    crumb={current.label}
                    title={t("lootcouncil.manualBis.slotsTitle", { count: filledSlots, total: data.slots.length })}
                    hint={t("lootcouncil.manualBis.slotsHint", { max: data.maxPerSlot })}
                >
                    <ul className="lc-mb-slots">
                        {data.slots.map(({ slot, slotName }) => {
                            const items = list.slots[String(slot)] || [];
                            const ids = items.map((i) => i.id);
                            const busy = busySlot === slot;
                            const open = adding === slot;
                            return (
                                <li key={slot} className={`lc-mb-slot${items.length ? "" : " lc-mb-noitem"}`}>
                                    <span className="lc-mb-slotname">{slotLabel(slot, slotName)}</span>
                                    <div className="lc-mb-slotbody">
                                        {items.length ? (
                                            <ul className="lc-mb-items">
                                                {items.map((item, i) => (
                                                    <SlotItem
                                                        key={item.id}
                                                        item={item}
                                                        index={i}
                                                        canWrite={canWrite}
                                                        busy={busy}
                                                        onFirst={() => void save(slot, [item.id, ...ids.filter((x) => x !== item.id)])}
                                                        onRemove={() => void save(slot, ids.filter((x) => x !== item.id))}
                                                    />
                                                ))}
                                            </ul>
                                        ) : <span className="lc-muted">{t("lootcouncil.manualBis.emptySlot")}</span>}
                                        {open ? (
                                            <SlotAdder
                                                versionId={data.versionId}
                                                search={data.search}
                                                busy={busy}
                                                taken={ids}
                                                onAdd={(id) => {
                                                    if (ids.includes(id)) return;
                                                    void save(slot, [...ids, id]).then(() => setAdding(null));
                                                }}
                                            />
                                        ) : null}
                                    </div>
                                    {canWrite && items.length < data.maxPerSlot ? (
                                        <IconButton
                                            size="sm"
                                            tone={open ? "ghost" : "yes"}
                                            icon={open ? <XIcon /> : <PlusIcon />}
                                            tip={open ? t("lootcouncil.manualBis.closeAdd") : t("lootcouncil.manualBis.add", { slot: slotLabel(slot, slotName) })}
                                            pressed={open}
                                            onClick={() => setAdding(open ? null : slot)}
                                        />
                                    ) : <span />}
                                </li>
                            );
                        })}
                    </ul>
                    {list.at ? <p className="lc-mb-stamp">{t("lootcouncil.manualBis.stamp", { by: list.by || "—", date: formatDate(list.at) })}</p> : null}
                </Part>
            ) : null}
        </>
    );
}
