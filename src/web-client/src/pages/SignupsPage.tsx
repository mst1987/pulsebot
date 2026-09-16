import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../components/Shell";
import {
    getSignups,
    type ApiError, type OwnSignup, type OwnSignupRow, type SignupCounts, type SignupEventRow, type SignupsData,
} from "../api";
import { Badge, Bar, Button, PageHead, RaidLoader, WowIcon } from "../components/ui";
import RaidIcon from "../components/RaidIcon";
import SignupDialog from "../components/SignupDialog";
import { ExternalIcon } from "../components/icons";
import { SIGNUP_STATUS, fillTone, roleCountText, rowSubline, statusBadgeLabel } from "../lib/signups";
import "../styles/anmeldung.css";

// "Anmeldungen" (#256): the member's coming raids, one calm row each — the raid
// icon, the title large, date and deadline small, how full it is as a bar, and
// on the right either the own status (click = change it) or the one action.
// A Raid-Helper event is signed up for in Discord, so its row links there.
// Role counts, comments and the rest live in the dialog and in tooltips.

export default function SignupsPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<SignupsData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [params, setParams] = useSearchParams();

    useEffect(() => {
        getSignups().then(setData).catch(setError);
    }, []);

    if (error) return <div className="empty">Anmeldungen konnten nicht geladen werden: {error.message}</div>;
    if (!data) return <RaidLoader text="Kommende Raids werden geladen" />;

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

    const count = data.events.length;
    const noCharacter = !data.profile.characters.length;

    return (
        <div className="an-page">
            <PageHead
                icon="inv_misc_book_09"
                tone="signups"
                kicker={`${user.name} · ${count === 1 ? "1 kommender Raid" : `${count} kommende Raids`}`}
                title="Anmeldungen"
                meta={noCharacter && (
                    <Link className="badge mid" to="/profile" data-tip="Noch kein Charakter" data-tip-sub="Zum Anmelden brauchst du einen Charakter mit Spec in deinem Profil. Klick öffnet Mein Profil.">
                        Charakter im Profil anlegen
                    </Link>
                )}
            />

            {data.error && <div className="flash flash-err">Raid-Helper nicht erreichbar – es fehlen vielleicht Events: {data.error}</div>}

            {count === 0
                ? <p className="an-empty">Gerade stehen keine Raids an, die du sehen darfst.</p>
                : (
                    <div className="an-list">
                        {data.events.map((row) => <SignupRow key={row.id} row={row} onOpen={() => open(row.id)} />)}
                    </div>
                )}

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

function SignupRow({ row, onOpen }: { row: SignupEventRow; onOpen: () => void }) {
    const own = row.source === "eventhelper";
    const mine = row.mine;
    const size = row.size || 0;
    const barTip = own ? roleCountText(row.counts) : `${row.attending} angemeldet`;
    const barSub = own
        ? [row.counts.tentative ? `${row.counts.tentative} vielleicht` : "", row.counts.bench ? `${row.counts.bench} Bank` : "", row.counts.absence ? `${row.counts.absence} abgemeldet` : ""].filter(Boolean).join(" · ") || undefined
        : "Stand aus Raid-Helper.";

    return (
        <div className={`an-row${mine && mine.status !== "absence" ? " is-mine" : ""}`}>
            <span className="an-ic">
                {row.instanceIcon ? <WowIcon name={row.instanceIcon} size={44} /> : <RaidIcon contentIds={row.contentIds} sources={row.contentSources} />}
            </span>
            <div className="an-text">
                <div className="an-title">{row.title}</div>
                <div className="an-sub">{rowSubline(row)}</div>
            </div>
            <span data-tip={barTip} data-tip-sub={barSub}>
                <Bar value={row.attending} max={size || Math.max(row.attending, 1)} tone={fillTone(row.attending, size)} label={size ? `${row.attending}/${size}` : String(row.attending)} />
            </span>
            <div className="an-act">
                {own ? <OwnAction row={row} onOpen={onOpen} /> : (
                    <>
                        {mine && <Badge tone={SIGNUP_STATUS[mine.status].tone}>{statusBadgeLabel(mine.status)}</Badge>}
                        {row.discordUrl && (
                            <a className="btn btn-ghost btn-sm has-icon" href={row.discordUrl} target="_blank" rel="noreferrer"
                                data-tip="In Discord anmelden" data-tip-sub="Dieses Event läuft über Raid-Helper – die Anmeldung ist das Widget unter dem Event-Post.">
                                <ExternalIcon /> In Discord
                            </a>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function OwnAction({ row, onOpen }: { row: OwnSignupRow; onOpen: () => void }) {
    const mine = row.mine;
    if (mine) {
        const meta = SIGNUP_STATUS[mine.status];
        const label = mine.status === "absence" ? statusBadgeLabel(mine.status) : `${meta.label}${mine.specLabel ? ` · ${mine.specLabel}` : ""}`;
        const sub = [mine.character, mine.comment ? `„${mine.comment}“` : "", row.started ? "" : "Klick zum Ändern"].filter(Boolean).join(" · ");
        return (
            <button type="button" className={`badge an-status-badge${meta.tone ? ` ${meta.tone}` : ""}`} disabled={row.started} onClick={onOpen} data-tip={label} data-tip-sub={sub || undefined}>
                <i className="an-dot" style={{ background: meta.color }} />
                {label}
            </button>
        );
    }
    if (row.started) return <Badge>begonnen</Badge>;
    if (row.deadlinePassed) {
        return <Button variant="ghost" size="sm" onClick={onOpen} data-tip="Anmeldeschluss vorbei" data-tip-sub="Du kannst dich noch abmelden oder „Spät“ angeben.">Abmelden / Spät</Button>;
    }
    return <Button size="sm" onClick={onOpen}>Anmelden</Button>;
}
