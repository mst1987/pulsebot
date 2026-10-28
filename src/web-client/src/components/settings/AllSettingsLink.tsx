import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { ShellContext } from "../shell/Shell";
import { useT } from "../../i18n";

// A deep link into Alle Server › Einstellungen (/settings/all, #957). Only full
// admins may open that page (AdminGuard), so everybody else gets the hint that a
// full admin sets it up instead of a link that ends on "no access": as a short
// muted line in place of a button, or - inside a sentence - the plain words with
// the hint as tooltip.

/** Whether the signed-in user may open /settings/all (false while viewing as a role). */
export function useIsFullAdmin(): boolean {
    const ctx = useOutletContext<ShellContext | undefined>();
    return !!ctx?.user?.isAdmin;
}

export default function AllSettingsLink({ section, className, inline = false, hide = false, children }: {
    /** A section of the page "Alle Server" (settingsSections, group "global"). */
    section: string;
    className?: string;
    /** Inside running text: non-admins keep the words, with the hint as tooltip. */
    inline?: boolean;
    /** A head button: non-admins see nothing instead of the hint. */
    hide?: boolean;
    children: ReactNode;
}) {
    const t = useT();
    const fullAdmin = useIsFullAdmin();
    if (fullAdmin) {
        return <Link className={className} to={`/settings/all?section=${encodeURIComponent(section)}`}>{children}</Link>;
    }
    if (hide) return null;
    if (inline) return <span data-tip={t("settings.fullAdminSetup")}>{children}</span>;
    return <span className="sub is-inline">{t("settings.fullAdminSetup")}</span>;
}
