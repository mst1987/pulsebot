// The keyboard/click twin of dragging onto an empty role slot: pick a player for
// that role. Players whose main spec fits the role stand at the top.
import { useState } from "react";
import type { KaderPlayer, KaderRole } from "../../api";
import { Button, Modal } from "../../components/ui";
import { useT } from "../../i18n";
import { roleLabel, rolePluralLabel } from "../../lib/wowNames";
import { activeOf, attSortValue, colorOf, searchText, statusOf } from "../../lib/kader/model";
import { useKader } from "./kaderContext";
import { CharName, ClassBar } from "./parts";
import { attText, specLine } from "../../lib/kader/model";

export default function PickerModal({ role, onClose }: { role: KaderRole; onClose: () => void }) {
    const t = useT();
    const { view, roster, place } = useKader();
    const [q, setQ] = useState("");
    const needle = q.trim().toLowerCase();
    const fits = (p: KaderPlayer) => Number(activeOf(p)?.role === role);
    const list = view.players
        .filter((p) => statusOf(roster, p.userId) !== "kader")
        .filter((p) => !needle || searchText(p, view.classes).includes(needle))
        .sort((a, b) => fits(b) - fits(a) || attSortValue(b) - attSortValue(a))
        .slice(0, 60);

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={t("kader.picker.title", { role: rolePluralLabel(role) })}
            width={560}
            initialFocus="input"
            hint={t("kader.picker.hint")}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}
        >
            <label className="field">
                <span className="field-label">{t("kader.pool.search")}</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="kp-results">
                {list.length === 0 && <span className="kp-hint">{t("kader.picker.nobody")}</span>}
                {list.map((p) => {
                    const a = activeOf(p);
                    return (
                        <button key={p.userId} type="button" className="kp-result kp-button" onClick={async () => { await place(p.userId, "role", role); onClose(); }}>
                            <ClassBar color={colorOf(view.classes, p)} />
                            <span className="kp-col kp-grow">
                                <CharName player={p} className="kp-result-name" />
                                <span className="kp-sub">@{p.displayName} · {specLine(p, view.classes)}</span>
                            </span>
                            <span className="kp-sub">{a && a.role ? roleLabel(a.role) : ""}</span>
                            <span className="kp-mono kp-muted">{attText(p)}</span>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}
