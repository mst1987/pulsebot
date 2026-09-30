// "Aus Discord-Rolle hinzufügen": pick roles of the server; everybody holding at
// least one of them shows on the right with the character they would be
// prefilled with (spec icon plus class; profile, logs or nothing yet). Whoever
// is new is taken into this Kader's pool; who is already in the Kader stays as
// they are.
import { useMemo, useState, type CSSProperties } from "react";
import { addKaderPlayers, type KaderMember } from "../../api";
import { Button, Modal, Segment } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { AlertIcon, CheckIcon, RecruitmentIcon, SearchIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { EmptyState, SpecTag } from "./parts";
import { useKader } from "./kaderContext";

type List = "new" | "known" | "nodata";

export default function ImportModal({ onClose, onById }: { onClose: () => void; onById: () => void }) {
    const t = useT();
    const toast = useToast();
    const { view, kader, run } = useKader();
    const [roleQ, setRoleQ] = useState("");
    const [roles, setRoles] = useState<string[]>([]);
    const [list, setList] = usePersistedState<List>("kader-import-list", "new");
    const [skip, setSkip] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const needle = roleQ.trim().toLowerCase();
    const shownRoles = view.discordRoles.filter((r) => !needle || r.name.toLowerCase().includes(needle));
    const holders = useMemo(() => view.members.filter((m) => m.roleIds.some((id) => roles.includes(id))), [view.members, roles]);
    const inKader = (m: KaderMember) => !!kader.players[m.userId];
    const fresh = holders.filter((m) => !inKader(m));
    const known = holders.filter(inKader);
    const noData = fresh.filter((m) => !m.prefill);
    const rows = list === "known" ? known : list === "nodata" ? noData : fresh;
    const chosen = fresh.filter((m) => !skip.includes(m.userId));
    const chosenNoData = chosen.filter((m) => !m.prefill).length;
    const roleNames = (m: KaderMember) => view.discordRoles.filter((r) => roles.includes(r.id) && m.roleIds.includes(r.id)).map((r) => r.name).join(" · ");

    const submit = async () => {
        if (!chosen.length) return;
        setBusy(true);
        const result = await run(addKaderPlayers(kader.id, chosen.map((m) => ({ userId: m.userId, displayName: m.displayName }))));
        setBusy(false);
        if (result) {
            toast(t("kader.import.done", { n: result.added }));
            onClose();
        }
    };

    const sourceText = (m: KaderMember) => {
        if (inKader(m)) return t("kader.import.inKader");
        if (!m.prefill) return t("kader.import.missing");
        return t(`kader.import.from.${m.prefill.source}`);
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            kicker={t("kader.import.kicker", { name: kader.name })}
            title={t("kader.import.title")}
            width={1080}
            className="kp-import kp-dialog"
            hint={chosen.length ? t("kader.import.summary", { n: chosen.length, missing: chosenNoData }) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<RecruitmentIcon />} disabled={!chosen.length || busy} onClick={() => void submit()}>{t("kader.import.submit", { n: chosen.length })}</Button>
                </>
            )}
        >
            <div className="kp-import-grid">
                <aside className="kp-import-roles">
                    <span className="kicker">{t("kader.import.roles")}</span>
                    <label className="kp-search">
                        <SearchIcon />
                        <input type="search" aria-label={t("kader.import.roleSearch")} placeholder={t("kader.import.roleSearch")} value={roleQ} onChange={(e) => setRoleQ(e.target.value)} />
                    </label>
                    <div className="kp-rolelist">
                        {view.discordRoles.length === 0 && <EmptyState icon={<AlertIcon />} text={t("kader.import.noRoles")} />}
                        {shownRoles.map((r) => {
                            const on = roles.includes(r.id);
                            return (
                                <button key={r.id} type="button" aria-pressed={on} className={`kp-roleopt${on ? " kp-on" : ""}`}
                                    onClick={() => setRoles(on ? roles.filter((x) => x !== r.id) : [...roles, r.id])}>
                                    <span className={`kp-check${on ? " kp-on" : ""}`}>{on && <CheckIcon />}</span>
                                    <span className="kp-dot" style={{ "--cc": r.color || "var(--muted)" } as CSSProperties} />
                                    <span className="kp-grow">{r.name}</span>
                                    <span className="kp-mono kp-muted" data-tip={t("kader.import.holders", { count: r.count })}>{r.count}</span>
                                </button>
                            );
                        })}
                    </div>
                    <span className="kp-grow" />
                    <p className="kp-note">{t("kader.import.rolesHint")}</p>
                    <button type="button" className="kp-link" onClick={onById}>{t("kader.import.byId")}</button>
                </aside>
                <section className="kp-import-list">
                    <div className="kp-between">
                        <span className="kp-muted"><b className="kp-mono kp-big-n">{holders.length}</b> {t("kader.import.members", { count: holders.length })}</span>
                        <Segment<List> size="sm" ariaLabel={t("kader.import.lists")} value={list} onChange={setList} options={[
                            { value: "new", label: t("kader.import.listNew", { n: fresh.length }) },
                            { value: "known", label: t("kader.import.listKnown", { n: known.length }) },
                            { value: "nodata", label: t("kader.import.listNoData", { n: noData.length }), icon: noData.length ? <AlertIcon /> : undefined },
                        ]} />
                    </div>
                    <div className="kp-trow kp-thead kp-import-row">
                        <span />
                        <span className="kicker">{t("kader.import.colDiscord")}</span>
                        <span className="kicker">{t("kader.import.colPrefill")}</span>
                        <span className="kicker">{t("kader.import.colSource")}</span>
                    </div>
                    <div className="kp-import-rows">
                        {!roles.length && <EmptyState icon={<RecruitmentIcon />} text={t("kader.import.pickRoles")} />}
                        {!!roles.length && !rows.length && <EmptyState icon={<SearchIcon />} text={t("kader.import.nobody")} />}
                        {rows.map((m) => {
                            const member = inKader(m);
                            const checked = !member && !skip.includes(m.userId);
                            return (
                                <div key={m.userId} className={`kp-trow kp-import-row${member ? " kp-dim" : ""}`}>
                                    <input type="checkbox" checked={checked} disabled={member} aria-label={t("kader.import.take", { name: m.displayName })}
                                        onChange={(e) => setSkip(e.target.checked ? skip.filter((id) => id !== m.userId) : [...skip, m.userId])} />
                                    <span className="kp-col">
                                        <span className="kp-strong">{m.displayName}</span>
                                        <span className="kp-sub">{roleNames(m)}</span>
                                    </span>
                                    <span className="kp-cell-char">
                                        {m.prefill ? <SpecTag pick={m.prefill} size={22} /> : <span className="kp-warntext">{t("kader.import.noData")}</span>}
                                    </span>
                                    <span className={`kp-sub${m.prefill ? "" : " kp-warntext"}`}>{sourceText(m)}</span>
                                </div>
                            );
                        })}
                    </div>
                    {view.members.length === 0 && <p className="kp-warntext">{t("kader.import.offline")}</p>}
                </section>
            </div>
        </Modal>
    );
}
