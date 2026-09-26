// One character (design issue #218): who is it and how does it stand — in one
// hero —, then one of three parts behind a section switch: its equipment with
// every finding of the last evaluation sitting on the slot it is about, its
// loot history, and its attendance night by night. A click on a slot opens the
// item's details in a modal.
//
// Two answers feed it: /api/history/char (loot, live Battle.net gear, the gear
// findings) and /api/roster/char (role, categories, attendance, the drop source
// and BiS specs of the worn items). The second is best-effort — without it the
// page loses those parts, never the rest.
import { useEffect, useMemo, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryChar, getRosterChar, deleteLootItems, canAccess, type ApiError, type LootItem } from "../../api";
import { useApi } from "../../hooks/useApi";
import AsyncView from "../../components/ui/AsyncView";
import { usePersistedSearchParam } from "../../lib/persistedState";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { LootTable } from "../../components/loot/LootTable";
import type { ShellContext } from "../../components/Shell";
import { useToast } from "../../components/Jobs";
import { combineAttendance } from "../../lib/rosterView";
import { PartHead, WowIcon } from "../../components/ui";
import "../../styles/roster-charakter.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { CharHero } from "./CharHero";
import { GearSection } from "./GearSection";
import { AttendanceSection } from "./AttendanceSection";
import { ItemDetailModal } from "./ItemDetailModal";
import { tParts, useT } from "../../i18n";

type CharTab = "gear" | "loot" | "attendance";

const CHAR_TABS: CharTab[] = ["gear", "loot", "attendance"];

export default function HistoryCharPage() {
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
    // Also reachable read-only via "Loot-Ansichten" (src/config/permissions.js).
    const canEdit = canAccess(user, "history", "write");
    const [tab, switchTab] = usePersistedSearchParam<CharTab>("history-char-tab", "tab", "gear", CHAR_TABS);
    const [searchParams, setSearchParams] = useSearchParams();
    const name = searchParams.get("name") || "";
    // The open item-details modal is in the url (?item=<slot>), so a link can
    // point straight at a piece and the back button closes it.
    const itemSlot = searchParams.get("item") || "";
    const setItemSlot = (slot: string) => {
        const params = new URLSearchParams(searchParams);
        if (slot) params.set("item", slot); else params.delete("item");
        setSearchParams(params);
    };

    const character = useApi(() => getHistoryChar(name), [name]);
    const toast = useToast();
    // The second answer follows the first (it needs the worn items) and is
    // best-effort: the page stands without role, attendance and BiS facts.
    const itemIds = useMemo(() => (character.data?.gear || []).map((g) => g.itemId).filter((id): id is number => !!id), [character.data]);
    const rosterData = useApi(() => getRosterChar(name, itemIds), [name, itemIds], { enabled: !!character.data });
    const roster = rosterData.error ? null : rosterData.data;

    // A wrongly assigned award usually shows up here — on the raider who did not
    // get it. Drop the row locally instead of refetching the whole character.
    const removeItem = async (it: LootItem) => {
        try {
            await deleteLootItems([it.id]);
            character.setData((d) => (d ? { ...d, items: d.items.filter((row) => row.id !== it.id) } : d));
            toast(t("history.shared.deleted", { item: it.itemName || t("history.shared.itemFallback", { id: it.itemId }) }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // Attach Wowhead tooltips to the freshly rendered item links (loot table).
    useEffect(() => { refreshWowheadLinks(); }, [character.data, tab]);

    return (
        <AsyncView state={character} loading={<RaidLoader text={t("history.char.loading")} />} error={(err) => <div className="empty">{tParts("history.shared.loadError", { message: err.message })}</div>}>
            {(data) => {
                const issueCount = data.gearIssues?.issueCount || 0;
                const issueTone = data.gearIssues?.issues.some((i) => i.severity === "high") ? "bad" : "mid";
                const att = roster ? combineAttendance(Object.values(roster.attendance)) : null;

                const sections: { id: CharTab; label: string; icon: string; count: ReactNode; tone?: string }[] = [
                    { id: "gear", label: t("history.char.gear"), icon: "inv_helmet_98", count: issueCount || null, tone: issueCount ? issueTone : "" },
                    { id: "loot", label: t("history.shared.lootHistory"), icon: "inv_misc_bag_10", count: data.items.length || null },
                    { id: "attendance", label: t("history.char.attendance"), icon: "ability_warrior_rallyingcry", count: att?.total ? `${att.attended}/${att.total}` : null },
                ];

                return (
                    <>
                        <CharHero data={data} roster={roster} loading={character.loading} onReload={character.reload} />

                        <div className="ros-secs" role="tablist" aria-label={t("history.page.areaAria")}>
                            {sections.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === s.id}
                                    className={`ros-sec${tab === s.id ? " is-active" : ""}`}
                                    onClick={() => switchTab(s.id)}
                                >
                                    <WowIcon name={s.icon} size={20} />
                                    {s.label}
                                    {s.count !== null && <span className={`ros-sec-n${s.tone ? ` ${s.tone}` : ""}`}>{s.count}</span>}
                                </button>
                            ))}
                        </div>

                        {tab === "gear" && <GearSection data={data} onOpen={setItemSlot} />}
                        {tab === "loot" && (
                            <div className="dash-card ros-part">
                                <PartHead
                                    icon="inv_misc_bag_10"
                                    tone="roster"
                                    title={t("history.shared.lootHistory")}
                                    crumb={t("history.char.lootCrumb", { count: data.items.length })}
                                />
                                {data.items.length
                                    ? <LootTable items={data.items} showEvent onDelete={canEdit ? removeItem : undefined} />
                                    : <p className="sub ros-empty">{t("history.char.lootEmpty")}</p>}
                            </div>
                        )}
                        {tab === "attendance" && <AttendanceSection roster={roster} />}

                        {!!itemSlot && <ItemDetailModal slot={itemSlot} data={data} roster={roster} onClose={() => setItemSlot("")} />}
                    </>
                );
            }}
        </AsyncView>
    );
}
