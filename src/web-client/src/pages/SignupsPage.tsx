import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../components/Shell";
import {
    getSignups,
    type ApiError, type BulkSignupResult, type OwnSignup, type OwnSignupRow, type SignupCounts, type SignupEventRow, type SignupsData,
} from "../api";
import { Badge, Bar, Button, IconButton, PageHead, RaidLoader, WowIcon } from "../components/ui";
import RaidIcon from "../components/RaidIcon";
import SignupDialog from "../components/SignupDialog";
import BulkSignupDialog from "../components/BulkSignupDialog";
import { ExternalIcon, XIcon } from "../components/icons";
import { SIGNUP_STATUS, fillTone, roleCountText, rowSubline, statusBadgeLabel } from "../lib/signups";
import { specLabel } from "../lib/wowNames";
import { weekBands } from "../lib/raidTime";
import { useT } from "../i18n";
import "../styles/anmeldung.css";

// "Anmeldungen" (#256): the member's coming raids, one calm row each — the raid
// icon, the title large, date and deadline small, how full it is as a bar, and
// on the right either the own status (click = change it) or the one action.
// A Raid-Helper event is signed up for in Discord, so its row links there.
// Role counts, comments and the rest live in the dialog and in tooltips.
// The rows are grouped by raid ID (Wednesday to Tuesday) and share one column
// grid, so bar, status and action line up from row to row.

export default function SignupsPage() {
    const t = useT();
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<SignupsData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [params, setParams] = useSearchParams();
    // Several raids at once (#293): the picked own raids, and the raids the open bulk
    // dialog works on — kept apart, so clearing the selection after saving does not
    // close the dialog before it has shown the results.
    const [selected, setSelected] = useState<string[]>([]);
    const [bulkRows, setBulkRows] = useState<OwnSignupRow[]>([]);

    useEffect(() => {
        getSignups().then(setData).catch(setError);
    }, []);

    if (error) return <div className="empty">{t("signups.page.loadError", { message: error.message })}</div>;
    if (!data) return <RaidLoader text={t("signups.page.loading")} />;

    // The open dialog is in the url, so the Discord button can link straight to it.
    const openId = params.get("event") || "";
    const openRow = data.events.find((e): e is OwnSignupRow => e.id === openId && e.source === "eventhelper") || null;
    const open = (id: string) => {
        const next = new URLSearchParams(params);
        if (id) next.set("event", id);
        else next.delete("event");
        setParams(next, { replace: true });
    };

    const onSaved = (eventId: string, signup: OwnSignup, counts: SignupCounts) => {
        setData((d) => d && ({
            ...d,
            events: d.events.map((e) => (e.id === eventId && e.source === "eventhelper" ? { ...e, mine: signup, counts, attending: counts.attending } : e)),
        }));
        open("");
    };

    const onBulkDone = (results: BulkSignupResult[]) => {
        const byId = new Map(results.filter((r) => r.ok && r.signup && r.counts).map((r) => [r.eventId, r]));
        setData((d) => d && ({
            ...d,
            events: d.events.map((e) => {
                const r = byId.get(e.id);
                return r && e.source === "eventhelper" && r.signup && r.counts ? { ...e, mine: r.signup, counts: r.counts, attending: r.counts.attending } : e;
            }),
        }));
        setSelected([]);
    };

    const count = data.events.length;
    const noCharacter = !data.profile.characters.length;
    // Only an own raid that still takes a signup can be picked.
    const selectable = data.events.filter((e): e is OwnSignupRow => e.source === "eventhelper" && e.allowedStatuses.length > 0 && !noCharacter);
    const selectedRows = selectable.filter((e) => selected.includes(e.id));
    const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

    return (
        <div className="an-page">
            <PageHead
                icon="inv_misc_book_09"
                tone="signups"
                kicker={`${user.name} · ${t("signups.page.upcoming", { count })}`}
                title={t("signups.page.title")}
                meta={noCharacter && (
                    <Link className="badge mid" to="/profile" data-tip={t("signups.page.noCharTip")} data-tip-sub={t("signups.page.noCharTipSub")}>
                        {t("signups.page.noCharLink")}
                    </Link>
                )}
            />

            {data.error && <div className="flash flash-err">{t("signups.page.raidHelperError", { error: data.error })}</div>}

            {count === 0
                ? <p className="an-empty">{t("signups.page.empty")}</p>
                : (
                    <div className="an-list">
                        {weekBands(data.events).map((band) => (
                            <div key={band.key} className="an-group" role="group" aria-label={`${band.label} ${band.range}`}>
                                <div className="an-band">
                                    <b>{band.label}</b>
                                    <span>{band.range}</span>
                                    <Badge count>{band.rows.length}</Badge>
                                </div>
                                {band.rows.map((row) => (
                                    <SignupRow
                                        key={row.id} row={row} onOpen={() => open(row.id)}
                                        selectable={selectable.some((e) => e.id === row.id)}
                                        selected={selected.includes(row.id)}
                                        onToggle={() => toggle(row.id)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                )}

            {selectedRows.length > 0 && (
                <div className="an-bulk" role="toolbar" aria-label={t("signups.page.bulkAria")}>
                    <span className="an-bulk-count">{t("signups.selectedCount", { count: selectedRows.length })}</span>
                    {selectedRows.length < selectable.length && (
                        <Button size="sm" variant="ghost" onClick={() => setSelected(selectable.map((e) => e.id))}>{t("signups.page.selectAll")}</Button>
                    )}
                    <Button size="sm" onClick={() => setBulkRows(selectedRows)}>{t("signups.bulkTitle")}</Button>
                    <IconButton size="sm" icon={<XIcon />} tip={t("signups.page.clearSelection")} onClick={() => setSelected([])} />
                </div>
            )}

            <BulkSignupDialog
                rows={bulkRows}
                profile={data.profile}
                classes={data.classes}
                csrfToken={csrfToken}
                onClose={() => setBulkRows([])}
                onDone={onBulkDone}
            />

            <SignupDialog
                row={openRow}
                profile={data.profile}
                classes={data.classes}
                csrfToken={csrfToken}
                onClose={() => open("")}
                onSaved={onSaved}
            />
        </div>
    );
}

function SignupRow({ row, onOpen, selectable, selected, onToggle }: {
    row: SignupEventRow;
    onOpen: () => void;
    selectable: boolean;
    selected: boolean;
    onToggle: () => void;
}) {
    const t = useT();
    const own = row.source === "eventhelper";
    const mine = row.mine;
    const size = row.size || 0;
    const barTip = own ? roleCountText(row.counts) : t("signups.attending", { count: row.attending });
    const barSub = own
        ? [
            row.counts.tentative ? t("signups.row.tentative", { count: row.counts.tentative }) : "",
            row.counts.bench ? t("signups.row.bench", { count: row.counts.bench }) : "",
            row.counts.absence ? t("signups.row.absence", { count: row.counts.absence }) : "",
        ].filter(Boolean).join(" · ") || undefined
        : t("signups.row.raidHelperState");

    return (
        <div className={`an-row${mine && mine.status !== "absence" ? " is-mine" : ""}${selected ? " an-row-selected" : ""}`}>
            <span className="an-check">
                {selectable && (
                    <input
                        type="checkbox" checked={selected} onChange={onToggle}
                        aria-label={t("signups.row.selectAria", { title: row.title })}
                        data-tip={t("signups.row.selectTip")} data-tip-sub={t("signups.row.selectTipSub")}
                    />
                )}
            </span>
            <span className="an-ic">
                {row.instanceIcon ? <WowIcon name={row.instanceIcon} size={44} /> : <RaidIcon contentIds={row.contentIds} sources={row.contentSources} />}
            </span>
            <div className="an-text">
                <div className="an-title">{row.title}</div>
                <div className="an-sub">{rowSubline(row)}</div>
            </div>
            <span className="an-bar" data-tip={barTip} data-tip-sub={barSub}>
                <Bar value={row.attending} max={size || Math.max(row.attending, 1)} tone={fillTone(row.attending, size)} label={size ? `${row.attending}/${size}` : String(row.attending)} />
            </span>
            {/* status and action are two columns, so each stays under its kind in every row */}
            <div className="an-state">
                {own ? <OwnStatus row={row} onOpen={onOpen} /> : mine && <Badge tone={SIGNUP_STATUS[mine.status].tone}>{statusBadgeLabel(mine.status)}</Badge>}
            </div>
            <div className="an-act">
                {own ? <OwnAction row={row} onOpen={onOpen} /> : row.discordUrl && (
                    <a className="btn btn-ghost btn-sm has-icon" href={row.discordUrl} target="_blank" rel="noreferrer"
                        data-tip={t("signups.row.discordTip")} data-tip-sub={t("signups.row.discordTipSub")}>
                        <ExternalIcon /> {t("signups.row.inDiscord")}
                    </a>
                )}
            </div>
        </div>
    );
}

/** The own status as a badge — a click changes it. Empty while not signed up. */
function OwnStatus({ row, onOpen }: { row: OwnSignupRow; onOpen: () => void }) {
    const t = useT();
    const mine = row.mine;
    if (mine) {
        const meta = SIGNUP_STATUS[mine.status];
        const alternates = (mine.characters || []).length - 1;
        const mineSpec = mine.specLabel ? specLabel(mine.spec, mine.specLabel) : "";
        const label = mine.status === "absence"
            ? statusBadgeLabel(mine.status)
            : `${meta.label}${mineSpec ? ` · ${mineSpec}` : ""}${alternates > 0 ? ` +${alternates}` : ""}`;
        // every named character, the first as the choice, the rest "kann auch mit" (#293);
        // a character whose own status differs from the signup's says so: "Zibbowar (Schutz, Dabei)"
        const who = (mine.characters || []).length
            ? mine.characters.map((c, i) => {
                const own = c.status && c.status !== mine.status ? SIGNUP_STATUS[c.status].label : "";
                const detail = [c.specLabel ? specLabel(c.spec, c.specLabel) : "", own].filter(Boolean).join(", ");
                return `${i ? "+" : ""}${c.character}${detail ? ` (${detail})` : ""}`;
            }).join(", ")
            : mine.character;
        const sub = [who, mine.comment ? t("signups.quoted", { text: mine.comment }) : "", row.started ? "" : t("signups.row.clickToChange")].filter(Boolean).join(" · ");
        return (
            <button type="button" className={`badge an-status-badge${meta.tone ? ` ${meta.tone}` : ""}`} disabled={row.started} onClick={onOpen} data-tip={label} data-tip-sub={sub || undefined}>
                <i className="an-dot" style={{ background: meta.color }} />
                {label}
            </button>
        );
    }
    return null;
}

/** The one action of a raid not signed up for yet: sign up, or only sign off / late after the deadline. */
function OwnAction({ row, onOpen }: { row: OwnSignupRow; onOpen: () => void }) {
    const t = useT();
    if (row.mine) return null;
    if (row.started) return <Badge>{t("signups.row.started")}</Badge>;
    if (row.deadlinePassed) {
        return <Button variant="ghost" size="sm" onClick={onOpen} data-tip={t("signups.deadlinePassed")} data-tip-sub={t("signups.row.latePossible")}>{t("signups.row.offOrLate")}</Button>;
    }
    return <Button size="sm" onClick={onOpen}>{t("signups.signUp")}</Button>;
}
