// The marks for what only the orga sees (design canvas Oct 2026: E for whole pages, B for parts):
//
//   OrgaBar   the teal bar over a page none of whose areas the base access opens —
//             "Orga-Bereich · Raider sehen diese Seite nicht · sichtbar für …", and for a
//             full admin the way to look at it as a raider (the base access only)
//   OrgaZone  the tinted, dashed frame around the orga's part of a page everybody sees
//             (the dashboard's orga block, the absence overview of all raiders)
//
// Who is named comes from the server (user.audience, lib/app/orgaArea.ts); without it
// nothing is marked rather than guessed.
import { useState, type ReactNode } from "react";
import { setViewAs, type ApiError, type SessionUser } from "../../api";
import { audienceText, orgaAudience, type OrgaAudience } from "../../lib/app/orgaArea";
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

/** The bar over an orga page (`audience`: lib/app/orgaArea.ts pageAudience); nothing for a page every raider may open (null). */
export function OrgaBar({ user, audience }: { user: SessionUser; audience: OrgaAudience | null }) {
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
    return (
        <div className="orga-bar" role="note">
            <b className="orga-bar-lbl"><ShieldIcon />{t("shell.orga.label")}</b>
            <span className="orga-bar-text">{t("shell.orga.pageHidden")} · {t("shell.orga.visibleFor", { who: audienceText(audience) })}</span>
            {preview && (
                <button type="button" className="orga-bar-btn" disabled={busy} onClick={() => void asRaider()} data-tip={t("shell.orga.asRaiderTip")}>
                    {t("shell.orga.asRaider")}
                </button>
            )}
        </div>
    );
}

/**
 * The orga's part of a page everybody sees. `areas`/`level` name who sees it — the
 * dashboard's block goes by the right to change raids, so it asks for the writers.
 */
export function OrgaZone({ user, areas, level = "read", children }: { user: SessionUser; areas: string[]; level?: "read" | "write"; children: ReactNode }) {
    const t = useT();
    const audience = orgaAudience(user, areas, level);
    return (
        <section className="orga-zone" aria-label={t("shell.orga.label")}>
            <span className="orga-zone-lbl"><ShieldIcon />{t("shell.orga.label")}</span>
            <span className="orga-zone-sub">
                {t("shell.orga.zoneHidden")}{audience ? ` · ${t("shell.orga.visibleFor", { who: audienceText(audience) })}` : ""}
            </span>
            <div className="orga-zone-body">{children}</div>
        </section>
    );
}

/**
 * The menu's small mark beside an orga page. Silent for screen readers: it would change the
 * link's name ("Roster Orga-Bereich"), and the page's own bar says it in words.
 */
export function OrgaDot() {
    const t = useT();
    return <span className="orga-dot" aria-hidden="true" data-tip={t("shell.orga.label")} />;
}
