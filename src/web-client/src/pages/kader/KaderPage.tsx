// The Kaderplaner (docs/kaderplaner.md): raid rosters for WoW Forever. One page
// with three views — the board (/kader), the player search (/kader/spieler) and
// the group setup of a roster (/kader/setup/:rosterId) — over one view model
// from GET /api/kader. Every write answers with the fresh view model, which is
// swapped in as it is; the page never merges anything itself.
//
// Area "kader": only full admins and the accounts or roles an admin hands it to
// (docs/permissions.md). Without write access everything is shown, nothing moves.
import { useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { canAccess, getKader, placeKaderPlayer, type ApiError, type KaderPlace, type KaderRole, type KaderView } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/persistedState";
import { byId, pickRoster } from "../../lib/kader/model";
import { useToast } from "../../components/Jobs";
import RaidLoader from "../../components/ui/RaidLoader";
import type { ShellContext } from "../../components/Shell";
import { useT } from "../../i18n";
import { KaderContext, type KaderCtx, type KaderModal } from "./kaderContext";
import BoardView from "./BoardView";
import PlayersView from "./PlayersView";
import SetupView from "./SetupView";
import AccountModal from "./AccountModal";
import AddAccountModal from "./AddAccountModal";
import RosterModal from "./RosterModal";
import PickerModal from "./PickerModal";
import "../../styles/kader.css";

export type KaderSubView = "board" | "players" | "setup";

export default function KaderPage({ sub }: { sub: KaderSubView }) {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const toast = useToast();
    const state = useApi(() => getKader(), []);
    const { setData } = state;
    const [rosterId, setRosterId] = usePersistedState<string>("kader-roster", "");
    const [modal, setModal] = useState<KaderModal>(null);
    const canWrite = canAccess(user, "kader", "write");

    const run = useCallback(async (call: Promise<KaderView>) => {
        try {
            const next = await call;
            setData(next);
            return next;
        } catch (e) {
            toast((e as ApiError).message || t("kader.error"), "err");
            return null;
        }
    }, [setData, toast, t]);

    const view = state.data;
    const roster = view ? pickRoster(view, rosterId) : null;
    const players = useMemo(() => byId(view ? view.players : []), [view]);

    const place = useCallback(async (userId: string, to: KaderPlace, role?: KaderRole) => {
        if (!roster) return;
        await run(placeKaderPlayer(roster.id, userId, to, role));
    }, [roster, run]);

    if (state.error && !view) return <div className="empty">{state.error.message}</div>;
    if (!view) return <RaidLoader text={t("kader.loading")} />;

    const ctx: KaderCtx = {
        view,
        roster,
        players,
        canWrite,
        selectRoster: setRosterId,
        run,
        place,
        open: setModal,
    };
    const close = () => setModal(null);

    return (
        <KaderContext.Provider value={ctx}>
            <div className="kp-page" data-kader-view={sub}>
                {sub === "board" && <BoardView />}
                {sub === "players" && <PlayersView />}
                {sub === "setup" && <SetupView />}
            </div>
            {modal?.type === "account" && <AccountModal key={modal.userId} userId={modal.userId} onClose={close} />}
            {modal?.type === "add" && <AddAccountModal onClose={close} onAdded={(userId) => setModal({ type: "account", userId })} />}
            {modal?.type === "roster" && <RosterModal mode={modal.mode} onClose={close} />}
            {modal?.type === "picker" && <PickerModal role={modal.role} onClose={close} />}
        </KaderContext.Provider>
    );
}
