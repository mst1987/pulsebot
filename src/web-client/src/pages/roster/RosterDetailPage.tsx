// One raid roster (#654, editing #655-#657, epic "Roster je Kategorie"): its
// head (version and raids, main role, places, attendance, "Einstellungen" and
// "Mitglied hinzufügen" for whoever may manage it) and its tabs, each its own
// address (/roster/r/<id>/<tab>): Mitglieder (MembersTab), Komposition,
// Abgleich mit Discord (with "n offen") and Verlauf. A member opens in the
// drawer at the right edge. Names, characters, roles and attendance come from
// the server (GET /api/rosters/roster); every change reloads the roster.
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { getRosterDetail, getRosterSync, setRosterRole, type RosterDetail, type RosterMember } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePageCrumb } from "../../hooks/usePageCrumb";
import { tParts, useT } from "../../i18n";
import { BackButton, Badge, Button, IconTile, WowIcon } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { PlusIcon, SettingsIcon } from "../../components/ui/icons";
import type { ShellContext } from "../../components/shell/Shell";
import { changedRoleLines, syncOpenCount } from "../../lib/roster/rosterEdit";
import AddMemberDialog, { type AddPrefill } from "./AddMemberDialog";
import CompositionTab from "./CompositionTab";
import HistoryTab from "./HistoryTab";
import MemberDrawer from "./MemberDrawer";
import MembersTab from "./MembersTab";
import RosterFormDialog from "./RosterFormDialog";
import SyncTab from "./SyncTab";
import { RoleChip, VersionLine } from "./RosterParts";
import { useRosterAction } from "./useRosterAction";
import "../../styles/roster-character.css";
import "../../styles/rosters.css";

type TabId = "members" | "composition" | "sync" | "history";
const TABS: { id: TabId; icon: string; label: string }[] = [
    { id: "members", icon: "achievement_guildperk_everybodysfriend", label: "roster.detail.tabMembers" },
    { id: "composition", icon: "inv_misc_groupneedmore", label: "roster.detail.tabComposition" },
    { id: "sync", icon: "spell_nature_astralrecal", label: "roster.detail.tabSync" },
    { id: "history", icon: "inv_misc_book_09", label: "roster.detail.tabHistory" },
];

function tabOf(raw: string | undefined): TabId {
    return TABS.some((tb) => tb.id === raw) ? (raw as TabId) : "members";
}

function RosterHeadBlock({ data, tab, open, onSettings, onAdd }: { data: RosterDetail; tab: TabId; open: number | null; onSettings: () => void; onAdd: () => void }) {
    const t = useT();
    const r = data.roster;
    const line = [
        r.slots.total > 0 ? t("roster.detail.places", { places: r.places, total: r.slots.total }) : t("roster.detail.placesNoTarget", { count: r.places }),
    ];
    if (r.attendance !== null) line.push(t("roster.detail.attendance", { pct: r.attendance }));
    const href = (id: TabId) => `/roster/r/${encodeURIComponent(r.id)}${id === "members" ? "" : `/${id}`}`;
    return (
        <>
            <div className="rn-head">
                <IconTile icon={r.icon} tone="roster" size="lg" />
                <div className="rn-head-text">
                    <VersionLine versionId={r.versionId} parts={[r.versionLabel, ...(r.categoryId ? r.contents : [t("roster.overview.noCategory")])]} />
                    <h1 className="rn-h1">{r.name}</h1>
                    <div className="rn-head-meta">
                        <RoleChip role={r.mainRole} />
                        <span className="rn-sub">{line.join(" · ")}</span>
                    </div>
                </div>
                {data.canManage && (
                    <div className="rn-head-actions">
                        <Button variant="ghost" icon={<SettingsIcon />} onClick={onSettings}>{t("roster.detail.settings")}</Button>
                        {tab === "members" && <Button icon={<PlusIcon />} onClick={onAdd}>{t("roster.detail.add")}</Button>}
                    </div>
                )}
            </div>
            <nav className="rn-tabs" aria-label={t("roster.detail.tabsAria")}>
                {TABS.map((tb) => (
                    <Link key={tb.id} className={`rn-tab${tb.id === tab ? " is-on" : ""}`} to={href(tb.id)} aria-current={tb.id === tab ? "page" : undefined}>
                        <WowIcon name={tb.icon} size={20} />
                        {t(tb.label)}
                        {tb.id === "members" && <Badge count>{r.members}</Badge>}
                        {tb.id === "sync" && open !== null && open > 0 && <Badge tone="mid">{t("roster.detail.open", { count: open })}</Badge>}
                    </Link>
                ))}
            </nav>
        </>
    );
}

export default function RosterDetailPage() {
    const t = useT();
    const { rosterId = "", tab: rawTab } = useParams();
    const outlet = useOutletContext<ShellContext | undefined>();
    const user = outlet?.user ?? null;
    const tab = tabOf(rawTab);
    const state = useApi(() => getRosterDetail(rosterId), [rosterId]);
    const sync = useApi(() => getRosterSync(rosterId), [rosterId]);
    const [drawer, setDrawer] = useState("");
    const [adding, setAdding] = useState<{ prefill: AddPrefill | null } | null>(null);
    const [settings, setSettings] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const { run, busy } = useRosterAction();
    usePageCrumb(state.data?.roster.name ?? null);
    const back = <BackButton to="/roster" label={t("roster.detail.back")} size="sm" className="rn-back" />;

    const reloadAll = async () => {
        await Promise.all([state.reload(), sync.reload()]);
        setReloadKey((k) => k + 1);
    };

    const giveRole = async (member: RosterMember) => {
        const result = await run(`role-${member.userId}`, () => setRosterRole(rosterId, member.userId, true),
            (r) => changedRoleLines([r.result])[0] ? t("roster.sync.gaveTo", { role: `@${r.result.roleName || r.result.roleId}`, name: member.displayName }) : t("roster.drawer.roleUnchanged"));
        if (result) await reloadAll();
    };

    if (state.error && !state.data) {
        return (
            <div className="rn-page">
                {back}
                <p className="rn-empty">
                    {state.error.code === "not_found" ? t("roster.detail.notFound") : tParts("roster.detail.loadError", { message: state.error.message })}
                </p>
            </div>
        );
    }
    if (!state.data) return <RaidLoader text={t("roster.detail.loading")} />;
    const data = state.data;
    return (
        <div className="rn-page">
            {back}
            <RosterHeadBlock data={data} tab={tab} open={sync.data ? syncOpenCount(sync.data) : null} onSettings={() => setSettings(true)} onAdd={() => setAdding({ prefill: null })} />
            {tab === "members" && <MembersTab data={data} busy={busy} onOpen={setDrawer} onGiveRole={giveRole} />}
            {tab === "composition" && <CompositionTab data={data} user={user} reloadKey={reloadKey} />}
            {tab === "sync" && (
                sync.data
                    ? <SyncTab data={data} sync={sync.data} onChanged={reloadAll} onAdd={(prefill) => setAdding({ prefill })} onOpen={setDrawer} />
                    : sync.error ? <p className="rn-empty">{tParts("roster.detail.loadError", { message: sync.error.message })}</p> : <RaidLoader compact text={t("roster.sync.loading")} />
            )}
            {tab === "history" && <HistoryTab rosterId={data.roster.id} reloadKey={reloadKey} />}
            {drawer && <MemberDrawer key={drawer} data={data} userId={drawer} onClose={() => setDrawer("")} onChanged={reloadAll} />}
            {adding && <AddMemberDialog data={data} prefill={adding.prefill} onClose={() => setAdding(null)} onDone={reloadAll} />}
            {settings && <RosterFormDialog mode="settings" data={data} onClose={() => setSettings(false)} onSaved={() => { void reloadAll(); }} />}
        </div>
    );
}
