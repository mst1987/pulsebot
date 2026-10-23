import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { JobsProvider } from "./components/shell/Jobs";
import { ConfirmProvider } from "./components/ui/Modal";
import { canAccessAny, getAddonName, getSession, type AddonName, type ApiError, type Session, type SessionUser } from "./api";
import { getLang, langReady, setLang, useT } from "./i18n";
import { entryHref, firstAllowedTab } from "./lib/app/menu";
import RaidLoader from "./components/ui/RaidLoader";
import WowIcon from "./components/ui/WowIcon";
import { BrandIcon, DiscordIcon, LockIcon } from "./components/ui/icons";
import LangToggle from "./components/shell/LangToggle";
import ChunkErrorBoundary from "./components/shell/ChunkErrorBoundary";
import { lazyWithReload } from "./lib/app/chunkReload";
import { addonNameOf } from "./lib/addons/addonName";

// Every page, the shell around them and the public plan view are their own
// chunk (#436): the first load carries only this router, the session and the
// loader, and a page's code arrives when it is opened. /p/<token> therefore
// never downloads the menu, and the menu never downloads the pages nobody
// opens. The shell shows the loader in its body while a page chunk is on its
// way (components/shell/Shell.tsx), so the menu stays standing.
const Shell = lazyWithReload(() => import("./components/shell/Shell"));
const PlanPublicPage = lazyWithReload(() => import("./pages/raidplan/PlanPublicPage"));
const DashboardPage = lazyWithReload(() => import("./pages/dashboard/DashboardPage"));
const ChannelsPage = lazyWithReload(() => import("./pages/ChannelsPage"));
const RoleMessagesPage = lazyWithReload(() => import("./pages/channels/RoleMessagesPage"));
const ServerRolesPage = lazyWithReload(() => import("./pages/channels/ServerRolesPage"));
const DiscordOverviewPage = lazyWithReload(() => import("./pages/channels/DiscordOverviewPage"));
const SettingsPage = lazyWithReload(() => import("./pages/settings/SettingsPage"));
const RaidsPage = lazyWithReload(() => import("./pages/raids/RaidsPage"));
const RaidCreatePage = lazyWithReload(() => import("./pages/RaidCreatePage"));
const RaidDetailPage = lazyWithReload(() => import("./pages/raid-detail/RaidDetailPage"));
const NotifyTemplatesPage = lazyWithReload(() => import("./pages/NotifyTemplatesPage"));
const RaidTemplatesPage = lazyWithReload(() => import("./pages/RaidTemplatesPage"));
const RaidplanTemplatesPage = lazyWithReload(() => import("./pages/raidplan/RaidplanTemplatesPage"));
const RaidplanCatalogPage = lazyWithReload(() => import("./pages/raidplan/RaidplanCatalogPage"));
const EventSeriesPage = lazyWithReload(() => import("./pages/EventSeriesPage"));
const RecruitmentPage = lazyWithReload(() => import("./pages/recruitment/RecruitmentPage"));
const HistoryPage = lazyWithReload(() => import("./pages/history/HistoryPage"));
const HistoryEventPage = lazyWithReload(() => import("./pages/history/HistoryEventPage"));
const HistoryInboxPage = lazyWithReload(() => import("./pages/history/HistoryInboxPage"));
const HistoryCharPage = lazyWithReload(() => import("./pages/history/HistoryCharPage"));
const RostersPage = lazyWithReload(() => import("./pages/roster/RostersPage"));
const RosterDetailPage = lazyWithReload(() => import("./pages/roster/RosterDetailPage"));
const RosterCharsPage = lazyWithReload(() => import("./pages/roster/RosterCharsPage"));
const DungeonsPage = lazyWithReload(() => import("./pages/dungeons/DungeonsPage"));
const AbsencesPage = lazyWithReload(() => import("./pages/absences/AbsencesPage"));
const ProfilePage = lazyWithReload(() => import("./pages/profile/ProfilePage"));
const SignupsPage = lazyWithReload(() => import("./pages/SignupsPage"));
const ClaPage = lazyWithReload(() => import("./pages/cla/ClaPage"));
const LootCouncilPage = lazyWithReload(() => import("./pages/lootcouncil/LootCouncilPage"));
const DropCheckPage = lazyWithReload(() => import("./pages/lootcouncil/DropCheckPage"));
const GuildBankPage = lazyWithReload(() => import("./pages/guildbank/GuildBankPage"));
const KaderPage = lazyWithReload(() => import("./pages/kader/KaderPage"));
const AddonPage = lazyWithReload(() => import("./pages/addon/AddonPage"));
const AddonDetailPage = lazyWithReload(() => import("./pages/addon/AddonDetailPage"));
const SystemPage = lazyWithReload(() => import("./pages/system/SystemPage"));

/**
 * Hides a page the user's rights don't cover. `areas` is an OR — one of them at
 * the given level is enough, which is how "Historie & Loot" opens either for
 * "history" or for the narrower "loot". Purely cosmetic: the API refuses the
 * underlying calls either way (src/web/apiAccess.js).
 */
function Guard({ user, areas, level = "read", children }: {
    user: SessionUser;
    areas: string[];
    level?: "read" | "write";
    children: ReactNode;
}) {
    const t = useT();
    if (canAccessAny(user, areas, level)) return <>{children}</>;
    return (
        <div className="empty">
            {level === "write" ? t("shell.app.noWrite") : t("shell.app.noRead")}
        </div>
    );
}

/**
 * Hides a page that belongs to no area: full admins only, whatever a role is
 * granted (the system status). Cosmetic like Guard — the API route is adminOnly.
 */
function AdminGuard({ user, children }: { user: SessionUser; children: ReactNode }) {
    const t = useT();
    if (user.isAdmin) return <>{children}</>;
    return <div className="empty">{t("shell.app.adminOnly")}</div>;
}

/** An old address of a page: the same view at its new path, the query kept. */
function MovedTo({ path }: { path: string }) {
    const { search } = useLocation();
    return <Navigate to={`${path}${search}`} replace />;
}

/** Start page for an account no area is open to — it still gets the shell. */
function NoAreaNotice() {
    const t = useT();
    return (
        <div className="empty app-notice">
            <p>{t("shell.app.noAccess")}</p>
            <p className="hint">{t("shell.app.noAccessHint")}</p>
        </div>
    );
}

/**
 * A path no route claims. The server hands every unknown GET to the client
 * (staticClient.js), so without this the page would simply stay blank.
 */
function NotFound() {
    const t = useT();
    return (
        <div className="empty app-notice">
            <p>{t("shell.app.notFound")}</p>
            <Link className="mlink" to="/">{t("shell.app.backHome")}</Link>
        </div>
    );
}

type LoadState =
    | { status: "loading" }
    | { status: "ready"; session: Session }
    | { status: "error"; error: ApiError };

function useSession(): LoadState {
    const [state, setState] = useState<LoadState>({ status: "loading" });

    useEffect(() => {
        getSession()
            .then((session) => {
                // The account's saved language wins over this browser's: it is
                // what makes the choice follow the user to another device.
                const saved = session.user && session.user.lang;
                if (saved && saved !== getLang()) setLang(saved);
                // A language other than German arrives as its own chunk: the
                // menu waits for it rather than flash German first.
                return langReady().then(() => setState({ status: "ready", session }));
            })
            .catch((error: ApiError) => setState({ status: "error", error }));
    }, []);

    return state;
}

/**
 * The public read view of a raid plan, /p/<token>, needs no login and no menu:
 * it is answered before the session is even asked for (the token in the address
 * is its authentication, see PlanPublicPage). Everything else is the menu.
 */
export default function App() {
    const { pathname } = useLocation();
    const publicPlan = pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
    if (publicPlan) return <Suspense fallback={<RaidLoader />}><PlanPublicPage token={publicPlan[1]} /></Suspense>;
    return <MenuApp />;
}

/**
 * The way in for a visitor: the Discord login, which comes back to the page
 * they opened (`?returnTo=`, checked on the server: only a path of this site,
 * src/web/http/pageRoutes.js safeReturnPath) instead of the start page. On an
 * addon's detail page (a Discord "Patchnotes" link) it also says where it leads,
 * with the addon's name and icon from GET /api/addons/name (no login needed).
 */
function LoginNotice() {
    const t = useT();
    const { pathname, search, hash } = useLocation();
    const here = `${pathname}${search}${hash}`;
    const href = here === "/" ? "/auth/login" : `/auth/login?returnTo=${encodeURIComponent(here)}`;
    // an addon's detail page, or an old Discord link to its card (/addon#addon-<id>, sent on to the detail page)
    const addonPart = (/^\/addon\/([^/]+)\/?$/.exec(pathname) || [])[1]
        || (pathname.replace(/\/$/, "") === "/addon" ? (/^#addon-(.+)$/.exec(hash) || [])[1] : "")
        || "";
    // the real name and icon from the one addon route without a login; until then (or on a 404) the id made readable
    const [named, setNamed] = useState<AddonName | null>(null);
    useEffect(() => {
        setNamed(null);
        if (!addonPart) return undefined;
        let live = true;
        let id = addonPart;
        try {
            id = decodeURIComponent(addonPart);
        } catch {
            // a broken escape asks for the part as it is
        }
        getAddonName(id).then((a) => { if (live) setNamed(a); }).catch(() => undefined);
        return () => { live = false; };
    }, [addonPart]);
    // A card like any login form: the brand on top, one big button (Discord is
    // the only way in, so there are no fields), what the login reads below it.
    return (
        <main className="login-page">
            <section className="login-card" aria-labelledby="login-title">
                <div className="login-brand">
                    <div className="crest"><BrandIcon /></div>
                    <div>
                        <div className="brand-name">EventHelper</div>
                        <div className="brand-sub">{t("shell.brandSub")}</div>
                    </div>
                </div>
                <h1 id="login-title" className="login-title">{t("shell.app.loginTitle")}</h1>
                <p className="login-prompt">{t("shell.app.loginPrompt")}</p>
                {addonPart && (
                    <span className="login-next">
                        <span className="kicker">{t("shell.app.loginNext")}</span>
                        {named && named.icon && <WowIcon name={named.icon} size={18} />}
                        <span className="login-next-text">{t("shell.app.loginNextAddon", { name: named ? named.name : addonNameOf(addonPart) })}</span>
                    </span>
                )}
                <a className="btn login-btn" href={href}><DiscordIcon />{t("shell.app.loginButton")}</a>
                <p className="login-hint"><LockIcon />{t("shell.app.loginHint")}</p>
            </section>
            {/* The one switch a visitor gets before logging in — kept in the browser only. */}
            <LangToggle />
        </main>
    );
}

function MenuApp() {
    const state = useSession();
    const t = useT();

    if (state.status === "loading") return <RaidLoader text={t("shell.app.loadingMenu")} />;
    if (state.status === "error") {
        return <div className="empty">{t("shell.app.sessionError", { message: state.error.message })}</div>;
    }

    const { user, guilds, activeGuildId } = state.session;
    // Not logged in is the one case without a shell: there is no user to put in
    // its footer and nothing to navigate to, only the way in.
    if (!user) return <LoginNotice />;

    // Anyone logged in gets the shell, even with nothing granted: the sidebar
    // says what is (not) open to them and, above all, the logout is in it. What
    // they may actually open is decided per tab and per route below.
    const start = firstAllowedTab(user);
    // The start page is every raider's ("Für dich" comes with their own signup
    // area) and the orga's; anyone with neither would land on an empty page —
    // send them to the first section they may actually open instead.
    const homeAreas = ["dashboard", "signup"];
    const home = canAccessAny(user, homeAreas) ? null : start;

    // JobsProvider wraps the router, not a page: that is what lets a running
    // CLA/RPB evaluation survive navigating to another section.
    // ConfirmProvider sits there too: a job can still ask ("Raid nicht beendet")
    // after its page is gone.
    // The outer Suspense only waits for the shell's own chunk on the very first
    // view; from then on the shell's Suspense catches the page chunks.
    // A chunk that is gone after a deploy reloads the page (lib/app/chunkReload.ts);
    // should it fail again, ChunkErrorBoundary offers the reload as a button (#530).
    return (
        <ChunkErrorBoundary>
            <Suspense fallback={<RaidLoader text={t("shell.app.loadingMenu")} />}>
                <JobsProvider>
                    <ConfirmProvider>
                        <Routes>
                            <Route element={<Shell user={user} guilds={guilds} activeGuildId={activeGuildId} content={state.session.content} />}>
                                <Route index element={
                                    canAccessAny(user, homeAreas)
                                        ? <DashboardPage />
                                        : home
                                            ? <Navigate to={entryHref(user, home)} replace />
                                            : <NoAreaNotice />
                                } />
                                <Route path="channels" element={<Guard user={user} areas={["channels"]}><ChannelsPage /></Guard>} />
                                {/* Rollen-Nachrichten: a page of the Kanaele family (docs/role-messages.md) */}
                                <Route path="channels/roles" element={<Guard user={user} areas={["channels"]}><RoleMessagesPage /></Guard>} />
                                {/* Rollen: every server role read-only (docs/channels.md) */}
                                <Route path="channels/server-roles" element={<Guard user={user} areas={["channels"]}><ServerRolesPage /></Guard>} />
                                <Route path="channels/overview" element={<Guard user={user} areas={["channels"]}><DiscordOverviewPage /></Guard>} />
                                <Route path="settings" element={<Guard user={user} areas={["settings"]}><SettingsPage /></Guard>} />
                                <Route path="raids" element={<Guard user={user} areas={["raids"]}><RaidsPage /></Guard>} />
                                {/* the list with the create dialog over it: the dialog opens by the server's `canCreate` (#729 - the orga of a category creates without `raids` write) */}
                                <Route path="raids/new" element={<Guard user={user} areas={["raids"]}><RaidCreatePage /></Guard>} />
                                <Route path="raids/detail" element={<Guard user={user} areas={["raids"]}><RaidDetailPage /></Guard>} />
                                <Route path="raids/templates" element={<Guard user={user} areas={["raids"]}><NotifyTemplatesPage /></Guard>} />
                                <Route path="raids/raid-templates" element={<Guard user={user} areas={["raids"]}><RaidTemplatesPage /></Guard>} />
                                {/* The raid plan is its own area (docs/permissions.md), even though its pages sit under /raids. */}
                                <Route path="raids/plan-templates" element={<Guard user={user} areas={["raidplan"]}><RaidplanTemplatesPage /></Guard>} />
                                <Route path="raids/plan-catalog" element={<Guard user={user} areas={["raidplan"]}><RaidplanCatalogPage /></Guard>} />
                                <Route path="raids/series" element={<Guard user={user} areas={["raids"]}><EventSeriesPage /></Guard>} />
                                <Route path="recruitment" element={<Guard user={user} areas={["recruitment"]}><RecruitmentPage /></Guard>} />
                                {/* "loot" opens the same three pages, cut down to the loot views. */}
                                <Route path="history" element={<Guard user={user} areas={["history", "loot"]}><HistoryPage /></Guard>} />
                                {/* The addon inbox is not open to the read-only "loot" area. */}
                                <Route path="history/inbox" element={<Guard user={user} areas={["history"]}><HistoryInboxPage /></Guard>} />
                                <Route path="history/event" element={<Guard user={user} areas={["history", "loot"]}><HistoryEventPage /></Guard>} />
                                <Route path="history/char" element={<Guard user={user} areas={["history", "loot"]}><HistoryCharPage /></Guard>} />
                                {/* The member self-service page: always the own account (area "signup"). */}
                                <Route path="profile" element={<Guard user={user} areas={["signup"]}><ProfilePage /></Guard>} />
                                {/* The member's coming raids and their own signup (area "signup", #256). */}
                                <Route path="signups" element={<Guard user={user} areas={["signup"]}><SignupsPage /></Guard>} />
                                {/* Abwesenheiten: a raider's own attendance ("signup"), the orga's overview with "roster" on top. */}
                                <Route path="absences" element={<Guard user={user} areas={["signup", "roster"]}><AbsencesPage /></Guard>} />
                                {/* its first address, under the roster (PR #646) */}
                                <Route path="roster/absences" element={<MovedTo path="/absences" />} />
                                {/* The raid rosters (#654): the overview, one roster with its tabs, and the old character list. */}
                                <Route path="roster" element={<Guard user={user} areas={["roster"]}><RostersPage /></Guard>} />
                                <Route path="roster/r/:rosterId/:tab?" element={<Guard user={user} areas={["roster"]}><RosterDetailPage /></Guard>} />
                                <Route path="roster/chars" element={<Guard user={user} areas={["roster"]}><RosterCharsPage /></Guard>} />
                                {/* Dungeon-Bestzeiten: a page of the Roster family, readable by every member (base access "signup") */}
                                <Route path="roster/dungeons" element={<Guard user={user} areas={["roster", "signup"]}><DungeonsPage /></Guard>} />
                                {/* Same character page, reached from the roster — the page keeps
                                    its back-link pointing at wherever it was opened from. */}
                                <Route path="roster/char" element={<Guard user={user} areas={["roster"]}><HistoryCharPage /></Guard>} />
                                <Route path="cla" element={<Guard user={user} areas={["cla"]}><ClaPage /></Guard>} />
                                <Route path="lootcouncil" element={<Guard user={user} areas={["lootcouncil"]}><LootCouncilPage /></Guard>} />
                                <Route path="lootcouncil/drop/:itemId?" element={<Guard user={user} areas={["lootcouncil"]}><DropCheckPage /></Guard>} />
                                {/* The guild bank stock (#632): read with "raids", the orga decides with write. */}
                                <Route path="guildbank" element={<Guard user={user} areas={["raids"]}><GuildBankPage /></Guard>} />
                                {/* The Kaderplaner (area "kader"): one Kader at a time, /kader opens the one used last. */}
                                <Route path="kader/:kaderId?/:sub?" element={<Guard user={user} areas={["kader"]}><KaderPage /></Guard>} />
                                {/* Addons (#818): the download page of the own addons, for every member ("signup") and the loot importers ("history"). */}
                                <Route path="addon" element={<Guard user={user} areas={["signup", "history"]}><AddonPage /></Guard>} />
                                {/* One addon with its patch notes, whatever version the menu shows (the Discord centre links here). */}
                                <Route path="addon/:addonId" element={<Guard user={user} areas={["signup", "history"]}><AddonDetailPage /></Guard>} />
                                {/* Systemstatus: full admins only, no area opens it (docs/system-status.md). */}
                                <Route path="system" element={<AdminGuard user={user}><SystemPage /></AdminGuard>} />
                                {/* Inside the shell on purpose: a mistyped path should still
                                    leave the menu (and the way back) standing. */}
                                <Route path="*" element={<NotFound />} />
                            </Route>
                        </Routes>
                    </ConfirmProvider>
                </JobsProvider>
            </Suspense>
        </ChunkErrorBoundary>
    );
}
