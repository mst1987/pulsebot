import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { getServerRoles, type DiscordSide, type ServerRole, type ServerRoles } from "../../api";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, PageHead, Segment, Switch } from "../../components/ui";
import { SortTh } from "../../components/ui/SortTh";
import DiscordTabs from "../../components/channels/DiscordTabs";
import RaidLoader from "../../components/ui/RaidLoader";
import { useTableSort, type TableSort } from "../../lib/ui/tableSort";
import { permissionLabel } from "../../lib/discord/permissions";
import { assignView, dividerAt, ranks, roleUseLines } from "../../lib/discord/serverRoles";
import ServerRoleDrawer from "./ServerRoleDrawer";
import "../../styles/server-roles.css";
import { useT } from "../../i18n";

// System › Discord › Rollen (docs/channels.md): every role of the event or the
// talk server as Discord orders it — the colour and name, how many have it, what
// it means for the bot, its sensitive permissions and whether the bot can hand it
// out. A line marks the bot's own role: everything below it the bot can give.
// A click on a row opens the role in a drawer on the right. Display only —
// creating and moving roles stays in Discord.

type SortKey = "pos" | "role" | "members" | "assign";
const SORT_DEFAULTS: Record<SortKey, "asc" | "desc"> = { pos: "asc", role: "asc", members: "desc", assign: "asc" };
/** At most this many sensitive permissions by name in a cell; the rest as "+N weitere" with a tooltip. */
const SENSITIVE_SHOWN = 2;

export default function ServerRolesPage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const [side, setSide] = useState<DiscordSide>("event");
    const [onlyHints, setOnlyHints] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const state = useApi(() => getServerRoles(side), [side]);
    const sort = useTableSort<SortKey>("server-roles-sort", SORT_DEFAULTS, "pos");
    const data = state.data && state.data.side === side ? state.data : null;

    const pickSide = (next: DiscordSide) => { setSide(next); setOpenId(null); };
    const sideSegment = (
        <Segment<DiscordSide>
            ariaLabel={t("discord.roles.page.server")}
            value={side}
            onChange={pickSide}
            options={[
                { value: "event", label: t("discord.roles.side.event") },
                { value: "talk", label: t("discord.roles.side.talk") },
            ]}
        />
    );

    return (
        <div className="drl-page">
            <PageHead
                icon="achievement_guildperk_everybodysfriend" tone="channels"
                kicker={data && data.guildName ? `${t("discord.roles.page.kicker")} · ${data.guildName}` : t("discord.roles.page.kicker")}
                title={t("discord.roles.page.title")}
                meta={data ? <HeadBadges data={data} /> : undefined}
            />
            <DiscordTabs user={user} side={side} guildKey={data ? data.guildId : ""} />

            {state.error && !data && <p className="empty">{t("discord.roles.page.loadError", { message: state.error.message })}</p>}
            {!data && !state.error && <><div className="drl-controls">{sideSegment}</div><RaidLoader text={t("discord.roles.page.loading")} /></>}
            {data && (
                <RolesView
                    data={data} sideSegment={sideSegment} onlyHints={onlyHints} setOnlyHints={setOnlyHints}
                    sort={sort} openId={openId} onOpen={setOpenId}
                />
            )}
            {data && openId && (
                <ServerRoleDrawer side={side} roleId={openId} guildName={data.guildName} total={data.total} onClose={() => setOpenId(null)} />
            )}
        </div>
    );
}

/** What the head says about the server: how many roles, and what keeps the page from being complete. */
function HeadBadges({ data }: { data: ServerRoles }) {
    const t = useT();
    if (!data.guildId) return null;
    if (!data.online) return <Badge tone="bad" tip={t("discord.roles.page.offline")} tipSub={t("discord.roles.page.offlineSub")}>{t("discord.roles.page.offline")}</Badge>;
    const counted = data.roles.filter((r) => !r.everyone).length;
    return (
        <>
            <Badge>{t("discord.roles.page.count", { count: counted })}</Badge>
            {data.manageRoles === false && <Badge tone="bad" tip={t("discord.roles.page.noManageRoles")} tipSub={t("discord.roles.page.noManageRolesSub")}>{t("discord.roles.page.noManageRoles")}</Badge>}
            {data.membersError && <Badge tone="mid" tip={t("discord.roles.page.membersError")} tipSub={t("discord.roles.page.membersErrorSub")}>{t("discord.roles.page.membersError")}</Badge>}
        </>
    );
}

function RolesView({ data, sideSegment, onlyHints, setOnlyHints, sort, openId, onOpen }: {
    data: ServerRoles;
    sideSegment: ReactNode;
    onlyHints: boolean;
    setOnlyHints: (on: boolean) => void;
    sort: TableSort<SortKey>;
    openId: string | null;
    onOpen: (id: string) => void;
}) {
    const t = useT();
    const rankOf = useMemo(() => ranks(data.roles), [data.roles]);
    const botName = data.botRole ? data.botRole.name : "";
    const hintCount = data.roles.filter((r) => r.hints.length > 0).length;

    const controls = (
        <div className="drl-controls">
            {sideSegment}
            {data.guildId && data.online && (
                <Switch
                    checked={onlyHints} onChange={setOnlyHints}
                    label={<>{t("discord.roles.page.onlyHints")} <span className="drl-n">{hintCount}</span></>}
                    tipHead={t("discord.roles.page.hintCount", { count: hintCount })} tip={t("discord.roles.page.onlyHintsSub")}
                />
            )}
            <span className="drl-note">{t("discord.roles.col.posSub")}</span>
        </div>
    );

    if (!data.guildId) return <>{controls}<p className="empty">{t("discord.roles.page.talkMissing")}</p></>;
    if (!data.online) return <>{controls}<p className="empty">{t("discord.roles.page.offlineSub")}</p></>;

    const shown = onlyHints ? data.roles.filter((r) => r.hints.length > 0) : data.roles;
    const rows = sort.apply(shown, (r, key) => {
        if (key === "role") return r.name.toLowerCase();
        if (key === "members") return r.memberCount === null ? -1 : r.memberCount;
        if (key === "assign") { const a = assignView(r, botName); return a.tone === "ok" ? 0 : a.tone === "fix" ? 1 : 2; }
        const rank = rankOf.get(r.id);
        return rank === null || rank === undefined ? Number.MAX_SAFE_INTEGER : rank;
    });
    const divider = sort.sort === "pos" && sort.dir === "asc" ? dividerAt(rows, data.botRole && data.botRole.id) : -1;

    return (
        <>
            {controls}
            {rows.length === 0 ? (
                <p className="empty">{onlyHints ? t("discord.roles.page.emptyHints") : t("discord.roles.page.empty")}</p>
            ) : (
                <div className="drl-wrap">
                    <table className="idx drl-table">
                        <thead>
                            <tr>
                                <SortTh sortKey="pos" label={t("discord.roles.col.pos")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("discord.roles.col.posTip")} tipSub={t("discord.roles.col.posSub")} className="drl-c-pos" />
                                <SortTh sortKey="role" label={t("discord.roles.col.role")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                                <SortTh sortKey="members" label={t("discord.roles.col.members")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                                <th className="drl-c-uses">{t("discord.roles.col.uses")}</th>
                                <th className="drl-c-sens"><span data-tip={t("discord.roles.col.sensitive")} data-tip-sub={t("discord.roles.col.sensitiveSub")}>{t("discord.roles.col.sensitive")}</span></th>
                                <SortTh sortKey="assign" label={t("discord.roles.col.assign")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <Fragment key={r.id}>
                                    {i === divider && (
                                        <tr className="drl-divider"><td colSpan={6}>{t("discord.roles.divider", { name: botName })}</td></tr>
                                    )}
                                    <RoleRow role={r} rank={rankOf.get(r.id) ?? null} botName={botName} open={r.id === openId} onOpen={onOpen} />
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="drl-foot">{t("discord.roles.page.footnote")}</p>
        </>
    );
}

function RoleRow({ role, rank, botName, open, onOpen }: {
    role: ServerRole;
    rank: number | null;
    botName: string;
    open: boolean;
    onOpen: (id: string) => void;
}) {
    const t = useT();
    const assign = assignView(role, botName);
    const uses = roleUseLines(role);
    const sensitive = role.sensitive.map(permissionLabel);
    const colour = role.color ? ({ "--drl-color": role.color } as CSSProperties) : undefined;
    return (
        <tr className={`drl-row${open ? " drl-open" : ""}`} onClick={() => onOpen(role.id)}>
            <td className="drl-c-pos drl-pos">{rank === null ? "–" : rank}</td>
            <td className="drl-c-role">
                <button type="button" className={`drl-name${role.color ? " drl-coloured" : ""}`} style={colour} onClick={(e) => { e.stopPropagation(); onOpen(role.id); }} aria-expanded={open}>
                    <span className="drl-dot" aria-hidden="true" />
                    {role.everyone ? "@everyone" : role.name}
                </button>
            </td>
            <td className={`drl-members${role.memberCount === 0 || role.memberCount === null ? " drl-muted" : ""}`}>
                {role.memberCount === null ? t("discord.roles.cell.membersUnknown") : t("discord.roles.cell.members", { count: role.memberCount })}
            </td>
            <td className={`drl-c-uses${role.uses.length || role.isBotRole ? "" : " drl-muted"}`}>{uses.join(" · ")}</td>
            <td className="drl-c-sens">
                {sensitive.length === 0 ? <span className="drl-muted">{t("discord.roles.cell.none")}</span> : (
                    <span className="drl-sens">
                        {sensitive.slice(0, SENSITIVE_SHOWN).join(", ")}
                        {sensitive.length > SENSITIVE_SHOWN && (
                            <span className="drl-more" data-tip={t("discord.roles.col.sensitive")} data-tip-sub={sensitive.join(", ")}>
                                {" "}{t("discord.roles.cell.more", { count: sensitive.length - SENSITIVE_SHOWN })}
                            </span>
                        )}
                    </span>
                )}
            </td>
            <td className={`drl-assign drl-assign-${assign.tone}`}>
                {assign.sub ? <span data-tip={assign.text} data-tip-sub={assign.sub}>{assign.text}</span> : assign.text}
            </td>
        </tr>
    );
}
