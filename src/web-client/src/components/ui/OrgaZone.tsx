// The marks for what only the orga sees (design canvas Oct 2026: E for whole pages, B for parts):
//
//   OrgaChip  the teal chip in the top bar (after the breadcrumbs) on a page none of whose areas
//             the base access opens — "Orga-Bereich", the "Raider sehen diese Seite nicht /
//             sichtbar für …" in its tooltip and accessible name, and for a full admin the way
//             to look at it as a raider (the base access only)
//   OrgaZone  the tinted, dashed frame around the orga's part of a page everybody sees
//             (the dashboard's orga block, the absence overview of all raiders)
//
// Who is named comes from the server (user.audience, lib/app/orgaArea.ts); without it
// nothing is marked rather than guessed.
import { useState, type ReactNode } from "react";
import { setViewAs, type ApiError, type SessionUser } from "../../api";
import { audienceText, orgaOnly, type OrgaAudience } from "../../lib/app/orgaArea";
import { useT } from "../../i18n";
import { useToast } from "../shell/Jobs";
import "../../styles/orga-mark.css";

function ShieldIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z" />
        </svg>
    );
}

function EyeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

/** The chip in the top bar for an orga page (`audience`: lib/app/orgaArea.ts pageAudience); nothing for a page every raider may open (null). */
export function OrgaChip({ user, audience }: { user: SessionUser; audience: OrgaAudience | null }) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    if (!audience) return null;
    // a full admin, not already looking as a role: the base access is what a raider without any role gets
    const preview = !!user.canViewAs && !user.viewAs;
    const asRaider = async () => {
        setBusy(true);
        try {
            await setViewAs({ roleIds: [] });
            window.location.assign("/");
        } catch (e) {
            toast(t("shell.viewAs.failed", { message: (e as ApiError).message }), "err");
            setBusy(false);
        }
    };
    const visibleFor = t("shell.orga.visibleFor", { who: audienceText(audience) });
    return (
        <div className="orga-chip" role="note" aria-label={[t("shell.orga.label"), t("shell.orga.pageHidden"), visibleFor].join(" · ")}>
            <span className="orga-chip-lbl" data-tip={t("shell.orga.pageHidden")} data-tip-sub={visibleFor}>
                <ShieldIcon /><span className="orga-chip-txt">{t("shell.orga.label")}</span>
            </span>
            {preview && (
                <button type="button" className="orga-chip-btn" disabled={busy} onClick={() => void asRaider()}
                    aria-label={t("shell.orga.asRaider")} data-tip={t("shell.orga.asRaider")} data-tip-sub={t("shell.orga.asRaiderTip")}>
                    <EyeIcon /><span className="orga-chip-btn-txt">{t("shell.orga.asRaider")}</span>
                </button>
            )}
        </div>
    );
}

/** The orga's part of a page everybody sees — shown to the orga only, so it names the orga: admins and the orga roles. */
export function OrgaZone({ user, children }: { user: SessionUser; children: ReactNode }) {
    const t = useT();
    const audience = orgaOnly(user);
    return (
        <section className="orga-zone" aria-label={t("shell.orga.label")}>
            <span className="orga-zone-lbl"><ShieldIcon />{t("shell.orga.label")}</span>
            <span className="orga-zone-sub">
                {t("shell.orga.zoneHidden")} · {t("shell.orga.visibleFor", { who: audienceText(audience) })}
            </span>
            <div className="orga-zone-body">{children}</div>
        </section>
    );
}

/**
 * The menu's small mark beside an orga page. Silent for screen readers: it would change the
 * link's name ("Roster Orga-Bereich"), and the page's chip says it in words.
 */
export function OrgaDot() {
    const t = useT();
    return <span className="orga-dot" aria-hidden="true" data-tip={t("shell.orga.label")} />;
}
