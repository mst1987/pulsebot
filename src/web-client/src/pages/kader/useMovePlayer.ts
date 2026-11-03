// One move of one player between the Kader's states, the same from the drawer,
// from a drop on a section and from a drop on the status bar: an unreachable
// state answers with a toast, a move that takes away the Discord role of a
// taken-over Kader asks first (and only that one), the rest just happens.
import { setKaderState, type KaderEntry, type KaderState, type KaderTakeover, type KaderWish } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { useConfirm } from "../../components/ui/overlay/Modal";
import { useT } from "../../i18n";
import { canMove, playerName, wishLabel } from "../../lib/kader/model";
import { TAKEOVER_STATES } from "../../lib/kader/takeover";
import { useKader } from "./kaderContext";

/** The states that give up the place in the Discord roster (TAKEOVER_STATES are the ones holding it). */
const LOSES_ROLE: KaderState[] = ["selected", "pool"];

/** Whether this move costs the player the role: a taken-over Kader, from a roster state to before it. */
export function losesRole(takeover: KaderTakeover | null | undefined, entry: Pick<KaderEntry, "state">, to: KaderState): boolean {
    return !!takeover && TAKEOVER_STATES.includes(entry.state) && LOSES_ROLE.includes(to);
}

/** Moves one player; true when the move went through (a refused or cancelled one is false). */
export function useMovePlayer() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, run } = useKader();

    return async (userId: string, to: KaderState, decision?: KaderWish): Promise<boolean> => {
        const entry = kader.players[userId];
        if (!entry) return false;
        // the same state with a decision is "Entscheidung ändern"; without one nothing changes
        if (entry.state === to && !decision) return false;
        if (entry.state !== to && !canMove(entry.state, to)) {
            toast(t("kader.decide.cantMove"), "err");
            return false;
        }
        const name = playerName(view, userId, entry);
        const state = t(`kader.state.${to}`);
        if (losesRole(kader.takeover, entry, to)) {
            const sure = await ask({
                title: t("kader.decide.roleLoss.title", { name, state }),
                text: t("kader.decide.roleLoss.text", { name, role: kader.takeover ? kader.takeover.roleName : "" }),
                action: t("kader.decide.roleLoss.action"),
                tone: "danger",
            });
            if (!sure) return false;
        }
        if (!(await run(setKaderState(kader.id, [userId], to, decision)))) return false;
        toast(to === "roster" && decision ? t("kader.decide.toRosterDone", { name, pick: wishLabel(view.classes, decision) }) : t("kader.decide.moved", { name, state }));
        return true;
    };
}
