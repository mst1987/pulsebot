// "Ansicht als Rolle" (src/web/viewAs.js): a full admin looks at the menu with
// the rights of one or more Discord roles, like Discord's "View server as role".
//
//   * ViewAsButton — in the top bar, only for a real full admin, opens the
//     role picker;
//   * ViewAsBanner — above every page while a view runs: which roles, "Ändern"
//     and "Beenden".
//
// Starting or stopping reloads the menu from "/": the session, the sidebar and
// every page's data have to come from the other rights, and the first page the
// viewed role may open is where App.tsx lands anyway.
import { useEffect, useMemo, useState } from "react";
import { getViewAsRoles, setViewAs, type ApiError, type SessionUser, type ViewAsRole } from "../api";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import { useToast } from "./Jobs";
import { useT } from "../i18n";
import "../styles/view-as.css";

/** Back to the start of the menu, so the new rights are loaded everywhere. */
function reloadMenu() {
    window.location.assign("/");
}

function ViewAsDialog({ open, onClose, current }: {
    open: boolean;
    onClose: () => void;
    current: string[];
}) {
    const t = useT();
    const [roles, setRoles] = useState<ViewAsRole[] | null>(null);
    const [picked, setPicked] = useState<string[]>(current);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (!open) return;
        setPicked(current);
        setQuery("");
        getViewAsRoles().then((r) => setRoles(r.roles)).catch((e: ApiError) => toast(e.message, "err"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (roles || []).filter((r) => !q || r.name.toLowerCase().includes(q));
    }, [roles, query]);

    const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

    const start = async () => {
        setBusy(true);
        try {
            await setViewAs({ roleIds: picked });
            reloadMenu();
        } catch (e) {
            toast(t("shell.viewAs.failed", { message: (e as ApiError).message }), "err");
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_spyglass_03"
            kicker={t("shell.viewAs.kicker")} title={t("shell.viewAs.title")} width={560}
            hint={picked.length ? t("shell.viewAs.selected", { count: picked.length }) : t("shell.viewAs.baseOnly")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("shell.viewAs.cancel")}</Button>
                    <Button onClick={start} running={busy} disabled={!roles}>
                        {picked.length ? t("shell.viewAs.start") : t("shell.viewAs.startBase")}
                    </Button>
                </>
            )}
        >
            <p className="va-intro">{t("shell.viewAs.intro")}</p>
            <input
                type="search" className="va-search" value={query} placeholder={t("shell.viewAs.search")}
                aria-label={t("shell.viewAs.search")} onChange={(e) => setQuery(e.target.value)}
            />
            {!roles
                ? <div className="note">{t("shell.viewAs.loading")}</div>
                : !shown.length
                    ? <div className="note">{t("shell.viewAs.empty")}</div>
                    : (
                        <ul className="va-roles">
                            {shown.map((r) => (
                                <li key={r.id}>
                                    <label className={`va-role${picked.includes(r.id) ? " is-on" : ""}`}>
                                        <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                                        <span className="va-dot" style={r.color ? { background: r.color } : undefined} aria-hidden="true" />
                                        <span className="va-name">{r.name}</span>
                                        {r.admin
                                            ? <Badge tone="accent" tip={t("shell.viewAs.admin")} tipSub={t("shell.viewAs.adminSub")}>{t("shell.viewAs.admin")}</Badge>
                                            : r.configured
                                                ? <Badge tone="ok" tip={t("shell.viewAs.configured")} tipSub={t("shell.viewAs.configuredSub")}>{t("shell.viewAs.configured")}</Badge>
                                                : <Badge tip={t("shell.viewAs.none")} tipSub={t("shell.viewAs.noneSub")}>{t("shell.viewAs.none")}</Badge>}
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
        </Modal>
    );
}

/** The top-bar button — only for a real full admin, and not while a view runs (the banner has "Ändern" then). */
export function ViewAsButton({ user }: { user: SessionUser }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    if (!user.canViewAs || user.viewAs) return null;
    return (
        <>
            <button type="button" className="ibtn va-btn" aria-label={t("shell.viewAs.button")} data-tip={t("shell.viewAs.button")} data-tip-sub={t("shell.viewAs.buttonSub")} onClick={() => setOpen(true)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                </svg>
            </button>
            <ViewAsDialog open={open} onClose={() => setOpen(false)} current={[]} />
        </>
    );
}

/** The bar above every page while the menu shows another role's rights. */
export function ViewAsBanner({ user }: { user: SessionUser }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    if (!user.viewAs) return null;
    const names = user.viewAs.roleNames.map((n) => `@${n}`).join(", ");
    const stop = async () => {
        setBusy(true);
        try {
            await setViewAs({ stop: true });
            reloadMenu();
        } catch (e) {
            toast(t("shell.viewAs.failed", { message: (e as ApiError).message }), "err");
            setBusy(false);
        }
    };
    return (
        <div className="va-banner" role="status">
            <span className="va-banner-t" data-tip={t("shell.viewAs.title")} data-tip-sub={t("shell.viewAs.bannerSub")}>
                {names ? t("shell.viewAs.banner", { roles: names }) : t("shell.viewAs.bannerBase")}
            </span>
            <span className="va-banner-act">
                {user.canViewAs && <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{t("shell.viewAs.change")}</Button>}
                <Button size="sm" onClick={stop} running={busy}>{t("shell.viewAs.stop")}</Button>
            </span>
            {user.canViewAs && <ViewAsDialog open={open} onClose={() => setOpen(false)} current={user.viewAs.roleIds} />}
        </div>
    );
}
