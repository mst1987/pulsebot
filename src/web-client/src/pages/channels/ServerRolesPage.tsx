import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { getServerRoles, type ServerRole, type ServerRoles } from "../../api";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, PageHead, Switch } from "../../components/ui";
import { SortTh } from "../../components/ui/table/SortTh";
import DiscordTabs from "../../components/channels/DiscordTabs";
import ServerPicker from "../../components/channels/ServerPicker";
import { pickSearch, useServerPick } from "../../hooks/useServerPick";
import RaidLoader from "../../components/ui/layout/RaidLoader";
import { useTableSort, type TableSort } from "../../lib/ui/tableSort";
import { permissionLabel } from "../../lib/discord/permissions";
import { assignView, commonSensitiveItems, dividerAt, ranks, roleUseLines } from "../../lib/discord/serverRoles";
import { roleColorVars } from "../../lib/discord/roleColor";
import ServerRoleDrawer from "./ServerRoleDrawer";
import "../../styles/server-roles.css";
import { useT } from "../../i18n";

// System › Discord › Rollen (docs/channels.md): every role of one server of the
// server list (picker in the controls, #895) as Discord orders it — the colour and name, how many have it, what
// it means for the bot, its sensitive permissions and whether the bot can hand it
// out. A line marks the bot's own role: everything below it the bot can give.
// Sensitive permissions that are normal on the server (@everyone or most roles
// have them) stay grey and are named once above the table; orange is kept for
// the outliers. On a phone the meaning and the outliers move under the name.
// A click on a row opens the role in a drawer. Display only — creating and
// moving roles stays in Discord.

type SortKey = "pos" | "role" | "members" | "assign";
const SORT_DEFAULTS: Record<SortKey, "asc" | "desc"> = { pos: "asc", role: "asc", members: "desc", assign: "asc" };
/** At most this many sensitive permissions by name in a cell; the rest as "+N weitere" with a tooltip. */
const SENSITIVE_SHOWN = 2;

export default function ServerRolesPage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    // the open role lives in the URL (`?role=<id>`, `&guild=<id>` beyond the first server): opening
    // adds a history step the browser's back button undoes (push), closing and switching the server
    // replace it — as on the members page
    const [params, setParams] = useSearchParams();
    const pick = useServerPick();
    const guildId = pick.guildId;
    const [onlyHints, setOnlyHints] = useState(false);
    const openId = params.get("role");
    const query = (id: string | null) => ({ ...(id ? { role: id } : {}), ...pick.param(guildId) });
    const open = (id: string) => setParams(query(id));
    const close = () => setParams(query(null), { replace: true });
    const state = useApi(() => getServerRoles(guildId), [guildId], { enabled: pick.ready });
    const sort = useTableSort<SortKey>("server-roles-sort", SORT_DEFAULTS, "pos");
    const data = state.data && (!guildId || state.data.guildId === guildId) ? state.data : null;
    // the rank the table shows (1 = highest), shared with the drawer so both say the same
    const rankOf = useMemo(() => ranks(data ? data.roles : []), [data]);
    const counted = data ? data.roles.filter((r) => !r.everyone).length : 0;

    const sideSegment = <ServerPicker pick={pick} drop={["role"]} />;

    return (
        <div className="drl-page">
            <PageHead
                icon="roles" tone="channels"
                kicker={data && data.guildName ? `${t("discord.roles.page.kicker")} · ${data.guildName}` : t("discord.roles.page.kicker")}
                title={t("discord.roles.page.title")}
                meta={data ? <HeadBadges data={data} /> : undefined}
            />
            <DiscordTabs user={user} guildId={guildId} search={pickSearch(pick)} />

            {state.error && !data && <p className="empty">{t("discord.roles.page.loadError", { message: state.error.message })}</p>}
            {!data && !state.error && <><div className="drl-controls">{sideSegment}</div><RaidLoader text={t("discord.roles.page.loading")} /></>}
            {data && (
                <RolesView
                    data={data} rankOf={rankOf} counted={counted} sideSegment={sideSegment} onlyHints={onlyHints} setOnlyHints={setOnlyHints}
                    sort={sort} openId={openId} onOpen={open}
                />
            )}
            {data && data.guildId && openId && (
                <ServerRoleDrawer
                    guildId={data.guildId} guildParams={pick.param(data.guildId)} roleId={openId} guildName={data.guildName}
                    rank={rankOf.get(openId) ?? null} counted={counted} onClose={close}
                />
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

function RolesView({ data, rankOf, counted, sideSegment, onlyHints, setOnlyHints, sort, openId, onOpen }: {
    data: ServerRoles;
    rankOf: Map<string, number | null>;
    /** the roles without @everyone */
    counted: number;
    sideSegment: ReactNode;
    onlyHints: boolean;
    setOnlyHints: (on: boolean) => void;
    sort: TableSort<SortKey>;
    openId: string | null;
    onOpen: (id: string) => void;
}) {
    const t = useT();
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

    if (!data.guildId) return <>{controls}<p className="empty">{t("discord.server.none")}</p></>;
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
    const common = commonSensitiveItems(data.commonSensitive || [], counted, permissionLabel);

    return (
        <>
            {controls}
            {common.length > 0 && (
                <p className="drl-common">
                    <span data-tip={t("discord.roles.page.commonTip")} data-tip-sub={t("discord.roles.page.commonTipSub")}>{t("discord.roles.page.commonLead")}</span>
                    {" "}{common.join(" · ")}
                </p>
            )}
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
                                <SortTh
                                    sortKey="assign"
                                    label={<><span className="drl-long">{t("discord.roles.col.assign")}</span><span className="drl-short">{t("discord.roles.col.assignShort")}</span></>}
                                    sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("discord.roles.col.assign")}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <Fragment key={r.id}>
                                    {i === divider && (
                                        <tr className="drl-divider">
                                            <td colSpan={6}>
                                                <span className="drl-divider-text">
                                                    <span className="drl-long">{t("discord.roles.divider", { name: botName })}</span>
                                                    <span className="drl-short">{t("discord.roles.dividerShort", { name: botName })}</span>
                                                </span>
                                            </td>
                                        </tr>
                                    )}
                                    <RoleRow
                                        role={r} rank={rankOf.get(r.id) ?? null} botName={botName} open={r.id === openId} onOpen={onOpen}
                                        botMarker={divider === -1 && r.isBotRole}
                                    />
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

function RoleRow({ role, rank, botName, open, onOpen, botMarker }: {
    role: ServerRole;
    rank: number | null;
    botName: string;
    open: boolean;
    onOpen: (id: string) => void;
    /** "Bot-Rolle" next to the name, when no divider line shows where the bot stands */
    botMarker: boolean;
}) {
    const t = useT();
    const assign = assignView(role, botName);
    const uses = roleUseLines(role).join(" · ");
    // the outliers first and in orange; the permissions normal on the server after them, grey
    const outliers = new Set(role.unusual || []);
    const sensitive = [
        ...role.sensitive.filter((k) => outliers.has(k)),
        ...role.sensitive.filter((k) => !outliers.has(k)),
    ].map((k) => ({ key: k, label: permissionLabel(k), outlier: outliers.has(k) }));
    const outlierLabels = sensitive.filter((s) => s.outlier).map((s) => s.label);
    const colour = roleColorVars("drl", role.color) as CSSProperties | undefined;
    return (
        <tr className={`drl-row${open ? " drl-open" : ""}`} onClick={() => onOpen(role.id)}>
            <td className="drl-c-pos drl-pos">{rank === null ? "–" : rank}</td>
            <td className="drl-c-role">
                <button type="button" className={`drl-name${colour ? " drl-coloured" : ""}`} style={colour} onClick={(e) => { e.stopPropagation(); onOpen(role.id); }} aria-expanded={open}>
                    <span className="drl-dot" aria-hidden="true" />
                    {role.everyone ? "@everyone" : role.name}
                </button>
                {botMarker && <span className="drl-botmark">{t("discord.roles.cell.botMarker")}</span>}
                {/* phone and tablet: what the hidden columns say, as a small second line */}
                <span className="drl-meta">
                    <span className={`drl-meta-uses${role.uses.length || role.isBotRole ? "" : " drl-muted"}`}>{uses}</span>
                    {outlierLabels.length > 0 && (
                        <span className="drl-meta-sens">
                            {outlierLabels.slice(0, SENSITIVE_SHOWN).join(", ")}
                            {outlierLabels.length > SENSITIVE_SHOWN && ` ${t("discord.roles.cell.more", { count: outlierLabels.length - SENSITIVE_SHOWN })}`}
                        </span>
                    )}
                </span>
            </td>
            <td className={`drl-members${role.memberCount === 0 || role.memberCount === null ? " drl-muted" : ""}`}>
                {role.memberCount === null ? t("discord.roles.cell.membersUnknown") : (
                    <>
                        <span className="drl-long">{t("discord.roles.cell.members", { count: role.memberCount })}</span>
                        <span className="drl-short" data-tip={t("discord.roles.cell.members", { count: role.memberCount })}>{role.memberCount}</span>
                    </>
                )}
            </td>
            <td className={`drl-c-uses${role.uses.length || role.isBotRole ? "" : " drl-muted"}`}>{uses}</td>
            <td className="drl-c-sens">
                {sensitive.length === 0 ? <span className="drl-muted">{t("discord.roles.cell.none")}</span> : (
                    <span>
                        {sensitive.slice(0, SENSITIVE_SHOWN).map((s, i) => (
                            <Fragment key={s.key}>
                                {i > 0 && ", "}
                                <span className={s.outlier ? "drl-sens" : "drl-muted"}>{s.label}</span>
                            </Fragment>
                        ))}
                        {sensitive.length > SENSITIVE_SHOWN && (
                            <span className="drl-more" data-tip={t("discord.roles.col.sensitive")} data-tip-sub={sensitive.map((s) => s.label).join(", ")}>
                                {" "}{t("discord.roles.cell.more", { count: sensitive.length - SENSITIVE_SHOWN })}
                            </span>
                        )}
                    </span>
                )}
            </td>
            <td className={`drl-assign drl-assign-${assign.tone}`}>
                <span className="drl-long">{assign.sub ? <span data-tip={assign.text} data-tip-sub={assign.sub}>{assign.text}</span> : assign.text}</span>
                <span className="drl-short" data-tip={assign.text} data-tip-sub={assign.sub}>{assign.short}</span>
            </td>
        </tr>
    );
}
