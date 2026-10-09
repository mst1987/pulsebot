// The Kaderplaner (docs/kaderplaner.md): raid rosters for WoW Forever, one Kader
// at a time. Every player of a Kader has a state that stays until somebody
// changes it — Pool → Vorauswahl (interviews) → Vorläufig (the leads discuss) →
// Roster / Bench / Tentative. The pages of a Kader live at /kader/<id>/<page>:
// pool, vorauswahl (Gespräche), uebersicht, roster, fragen, setups; /kader
// opens the Kader used last.
//
// One view model from GET /api/kader?kader=<id>. A change inside the Kader
// answers the Kader as stored (swapped in here), a change on the server's side
// the whole view. Area "kader": only full admins and the accounts or roles an
// admin hands it to (docs/permissions.md). Read-only sees everything, changes
// nothing.
//
// Live (docs/kaderplaner.md): while the page is visible it polls the Kader's
// revision (useKaderLive). When somebody else changed something, it fetches the
// Kader again — only the Kader (GET /api/kader/kader) when the change stayed
// inside it, the whole view when the server's side changed or players came in —
// and says in a toast who did what. What a part holds unsaved (an interview
// draft, a dialog, a half-typed comment) stays: the parts keep their own state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { canAccess, getKader, getKaderOnly, type ApiError, type KaderChange, type KaderLive, type KaderView } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/persistedState";
import { byId } from "../../lib/kader/model";
import { liveToast } from "../../lib/kader/live";
import { useToast } from "../../components/shell/Jobs";
import RaidLoader from "../../components/ui/RaidLoader";
import type { ShellContext } from "../../components/shell/Shell";
import { useT } from "../../i18n";
import {
    KaderContext, SUBS, type KaderCtx, type KaderFocus, type KaderFocusSource, type KaderModal, type KaderRunOptions, type KaderSub,
} from "./kaderContext";
import { useKaderLive } from "./useKaderLive";
import ActivityModal from "./ActivityLog";
import KaderHeader, { StageNav } from "./KaderHeader";
import KaderStart from "./KaderStart";
import PoolView from "./PoolView";
import InterviewsView from "./InterviewsView";
import OverviewView from "./OverviewView";
import DecisionView from "./DecisionView";
import QuestionsView from "./QuestionsView";
import SetupsView from "./SetupsView";
import AccountModal from "./AccountModal";
import AddAccountModal from "./AddAccountModal";
import ImportModal from "./ImportModal";
import KaderSettingsModal from "./KaderSettingsModal";
import "../../styles/kader.css";

/** Swaps an answer into the loaded view: the whole view, or `{ kader, kaders }` of a change inside one Kader. */
function merge(prev: KaderView | null, result: unknown): KaderView | null {
    if (!prev || !result || typeof result !== "object") return prev;
    const r = result as Partial<KaderView> & Partial<KaderChange>;
    if (Array.isArray(r.players)) {
        // a whole view that lost the open Kader (an answer without `kaderId`) must not blank the page
        if (!r.kader && prev.kader && Array.isArray(r.kaders) && r.kaders.some((k) => k.id === prev.kader?.id)) {
            return { ...(r as KaderView), kader: prev.kader };
        }
        return r as KaderView;
    }
    if (!Array.isArray(r.kaders)) return prev;
    const kaders = r.kaders;
    let kader = prev.kader;
    if (r.kader && kader && r.kader.id === kader.id) kader = r.kader;
    else if (kader && !kaders.some((k) => k.id === kader?.id)) kader = null;
    return { ...prev, kaders, kader, sharedRev: typeof r.sharedRev === "number" ? r.sharedRev : prev.sharedRev };
}

/** Whether what the live poll learnt needs the whole view again (players came in, characters or the server's side changed). */
function needsWholeView(live: KaderLive, view: KaderView): boolean {
    return !!live.gone || live.more || live.sharedRev > (view.sharedRev || 0) || live.changes.some((c) => c.type === "added" || c.type === "character");
}

/** A whole view without the Kader the address names, though that Kader exists: refetch it. */
function needsReload(result: unknown, kaderId: string): boolean {
    if (!kaderId || !result || typeof result !== "object") return false;
    const r = result as Partial<KaderView>;
    return Array.isArray(r.players) && !r.kader && Array.isArray(r.kaders) && r.kaders.some((k) => k.id === kaderId);
}

export default function KaderPage() {
    const { user } = useOutletContext<ShellContext>();
    const { kaderId = "", sub: rawSub = "" } = useParams();
    const sub: KaderSub = (SUBS as string[]).includes(rawSub) ? rawSub as KaderSub : "pool";
    const navigate = useNavigate();
    const t = useT();
    const toast = useToast();
    const [last, setLast] = usePersistedState<string>("kader-last", "");
    const state = useApi(() => getKader(kaderId), [kaderId]);
    const { setData, reload } = state;
    const [modal, setModal] = useState<KaderModal>(null);
    const canWrite = canAccess(user, "kader", "write");
    const canRead = canAccess(user, "kader", "read");
    const view = state.data;
    const kader = view ? view.kader : null;
    const viewRef = useRef(view);
    viewRef.current = view;

    useEffect(() => {
        if (kader && kader.id !== last) setLast(kader.id);
    }, [kader, last, setLast]);

    const run = useCallback(async <T,>(call: Promise<T>, options: KaderRunOptions = {}): Promise<T | null> => {
        try {
            const result = await call;
            setData((prev) => merge(prev, result));
            if (needsReload(result, kaderId)) void reload();
            return result;
        } catch (e) {
            if (options.onError && options.onError(e as ApiError)) return null;
            toast((e as ApiError).message || t("kader.error"), "err");
            return null;
        }
    }, [setData, reload, kaderId, toast, t]);

    // ------------------------------------------------------------ live
    // what the parts have open (the account dialog wins over the view under it)
    const [focuses, setFocuses] = useState<Record<KaderFocusSource, KaderFocus | null>>({ view: null, dialog: null });
    const reportFocus = useCallback((source: KaderFocusSource, focus: KaderFocus | null) => {
        setFocuses((prev) => (prev[source] === focus ? prev : { ...prev, [source]: focus }));
    }, []);
    const focused = focuses.dialog || focuses.view;
    const refreshing = useRef(false);
    const toastedRev = useRef(0);
    const recent = useRef(new Map<string, number>());

    /** Fetches the open Kader again: only the Kader, or the whole view. Resolves to the view it put on screen. */
    const refetch = useCallback(async (whole: boolean): Promise<KaderView | null> => {
        if (refreshing.current || !kaderId) return null;
        refreshing.current = true;
        try {
            const answer: KaderView | KaderChange = whole ? await getKader(kaderId) : await getKaderOnly(kaderId);
            // an own save that landed while this was on its way is newer: keep it
            const older = (prev: KaderView | null) => !!prev && !!prev.kader && !!answer.kader && (answer.kader.rev || 0) < (prev.kader.rev || 0);
            const next = older(viewRef.current) ? viewRef.current : merge(viewRef.current, answer);
            setData((prev) => (older(prev) ? prev : merge(prev, answer)));
            return next;
        } catch {
            // the next poll tries again
            return null;
        } finally {
            refreshing.current = false;
        }
    }, [kaderId, setData]);

    const onMoved = useCallback(async (live: KaderLive) => {
        const current = viewRef.current;
        if (!current) return;
        // every change is said once, also when two polls answer before the refetch lands
        const fresh = live.changes.filter((c) => c.rev > toastedRev.current);
        if (fresh.length) toastedRev.current = Math.max(...fresh.map((c) => c.rev));
        const next = await refetch(needsWholeView(live, current));
        // with the names of the fresh view (a player just taken in has one only there)
        const shown = next || current;
        if (!fresh.length || !shown.kader) return;
        const text = liveToast(shown, shown.kader, fresh, user.id, recent.current);
        if (text) toast(text);
    }, [refetch, toast, user.id]);

    const presence = useKaderLive({
        kaderId: kader ? kader.id : "",
        rev: kader && kader.rev ? kader.rev : 0,
        sharedRev: view && view.sharedRev ? view.sharedRev : 0,
        where: { sub, playerId: focused ? focused.playerId : "", what: focused ? focused.what : "", edit: !!focused && focused.edit && canWrite },
        enabled: canRead && !!kader,
        onMoved: (live) => void onMoved(live),
    });
    const refresh = useCallback(async (whole = false) => { await refetch(whole); }, [refetch]);

    const players = useMemo(() => byId(view ? view.players : []), [view]);

    if (state.error) return <div className="empty">{state.error.message}</div>;
    if (!view) return <RaidLoader text={t("kader.loading")} />;

    // no Kader in the address, or one that is gone: the one used last, else the first
    if (!kader) {
        const fallback = view.kaders.find((k) => k.id === last) || view.kaders[0];
        // the address names a Kader that exists but the view lacks it: fetch again, never navigate to where we are
        if (kaderId && view.kaders.some((k) => k.id === kaderId)) return <RaidLoader text={t("kader.loading")} />;
        if (fallback) return <Navigate to={`/kader/${fallback.id}/pool`} replace />;
        return (
            <>
                <KaderStart canWrite={canWrite} onCreate={() => setModal({ type: "create" })} />
                {modal && modal.type === "create" && (
                    <KaderSettingsModal mode="create" view={view} onClose={() => setModal(null)} run={run} onCreated={(id) => { setModal(null); navigate(`/kader/${id}/pool`); }} />
                )}
            </>
        );
    }

    const ctx: KaderCtx = {
        view,
        kader,
        players,
        canWrite,
        me: user.id,
        isLead: kader.leads.includes(user.id),
        run,
        open: setModal,
        go: (to, search = "") => navigate(`/kader/${kader.id}/${to}${search}`),
        presence,
        focus: reportFocus,
        refresh,
    };
    const close = () => setModal(null);

    return (
        <KaderContext.Provider value={ctx}>
            <div className="kp-page" data-kader-view={sub}>
                <KaderHeader />
                {view.warnings.length > 0 && <div className="kp-warn" role="status">{view.warnings.join(" · ")}</div>}
                {sub !== "fragen" && sub !== "setups" && <StageNav sub={sub} />}
                {sub === "pool" && <PoolView />}
                {sub === "vorauswahl" && <InterviewsView />}
                {sub === "uebersicht" && <OverviewView />}
                {sub === "roster" && <DecisionView />}
                {sub === "fragen" && <QuestionsView />}
                {sub === "setups" && <SetupsView />}
            </div>
            {modal && modal.type === "account" && <AccountModal key={modal.userId} userId={modal.userId} onClose={close} />}
            {modal && modal.type === "import" && <ImportModal onClose={close} onById={() => setModal({ type: "addById" })} />}
            {modal && modal.type === "addById" && <AddAccountModal startWay="id" onClose={close} />}
            {modal && modal.type === "settings" && <KaderSettingsModal mode="edit" view={view} me={user.id} onClose={close} run={run} onDeleted={() => { close(); navigate("/kader"); }} />}
            {modal && modal.type === "activity" && <ActivityModal onClose={close} />}
            {modal && modal.type === "create" && (
                <KaderSettingsModal mode="create" view={view} onClose={close} run={run} onCreated={(id) => { close(); navigate(`/kader/${id}/pool`); }} />
            )}
        </KaderContext.Provider>
    );
}
