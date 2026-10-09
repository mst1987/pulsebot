// "Mitglied hinzufügen" (#655): find a person among the Discord members of the
// roster's server, pick the status (square fields), a character from their
// profile of the roster's version (the first is suggested) or one typed by
// hand, the trial's end and a note. Taking someone in gives the roster's
// Discord role - the dialog says so before the click. Opened prefilled from
// the Abgleich tab ("Ins Roster aufnehmen" for a role holder).
import { useEffect, useState } from "react";
import {
    saveRosterMember, searchRosterMembers,
    type RosterDetail, type RosterRoleResult, type RosterSearchResult, type RosterStatus,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { Button, Field, Modal } from "../../components/ui";
import { SearchIcon } from "../../components/ui/icons";
import { changedRoleLines, errorText, searchChar } from "../../lib/roster/rosterEdit";
import { initialOf } from "../../lib/roster/rosters";
import { CharChip, Notice, RoleResults, StatusPicker } from "./RosterParts";
import { useRosterAction } from "./useRosterAction";

export type AddPrefill = { userId: string; displayName: string };

const TYPED = "__typed";

/** The search step: a field and the matching people, non-members first. */
function PersonSearch({ rosterId, onPick }: { rosterId: string; onPick: (p: RosterSearchResult) => void }) {
    const t = useT();
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    useEffect(() => {
        const id = window.setTimeout(() => setQuery(q.trim()), 250);
        return () => window.clearTimeout(id);
    }, [q]);
    const found = useApi(() => searchRosterMembers({ id: rosterId, q: query }), [rosterId, query]);
    const list = found.data?.results || [];
    return (
        <section className="rn-dlg-sec">
            <label className="rn-lbl" htmlFor="rn-add-search">{t("roster.add.who")}</label>
            <span className="rn-find">
                <SearchIcon />
                <input id="rn-add-search" type="search" autoComplete="off" value={q} placeholder={t("roster.add.searchPlaceholder")} onChange={(e) => setQ(e.target.value)} />
            </span>
            {found.error && <p className="rn-sub">{errorText(found.error)}</p>}
            {!found.error && found.data && !list.length && <p className="rn-sub">{t("roster.add.nobody")}</p>}
            {!!list.length && (
                <ul className="rn-results" aria-label={t("roster.add.results")}>
                    {list.map((p) => (
                        <li key={p.userId}>
                            <button type="button" className="rn-result" disabled={p.inRoster} onClick={() => onPick(p)}>
                                <span className="rn-ava" aria-hidden="true">{initialOf(p.displayName)}</span>
                                <span className="rn-result-main">
                                    <b>{p.displayName}</b>
                                    <span className="rn-sub">
                                        {p.inRoster ? t("roster.add.inRoster") : p.chars.length ? p.chars.map((c) => c.name).join(", ") : t("roster.add.noProfileChars")}
                                    </span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default function AddMemberDialog({ data, prefill, onClose, onDone }: {
    data: RosterDetail;
    prefill?: AddPrefill | null;
    onClose: () => void;
    /** Someone was taken in: the page reloads. */
    onDone: () => void;
}) {
    const t = useT();
    const { run, busy } = useRosterAction();
    const rosterId = data.roster.id;
    const [person, setPerson] = useState<RosterSearchResult | null>(prefill ? { userId: prefill.userId, displayName: prefill.displayName, inRoster: false, chars: [] } : null);
    const [status, setStatus] = useState<RosterStatus>("core");
    const [charKey, setCharKey] = useState("");
    const [typed, setTyped] = useState("");
    const [trialUntil, setTrialUntil] = useState("");
    const [note, setNote] = useState("");
    const [failed, setFailed] = useState<RosterRoleResult[] | null>(null);

    // a prefilled person: look their profile characters up once
    const prefillChars = useApi(() => searchRosterMembers({ id: rosterId, q: prefill?.displayName || "" }), [rosterId, prefill?.userId], { enabled: !!prefill });
    useEffect(() => {
        const hit = prefillChars.data?.results.find((r) => r.userId === prefill?.userId);
        if (hit) setPerson((p) => (p && p.userId === hit.userId ? { ...p, chars: hit.chars } : p));
    }, [prefillChars.data, prefill?.userId]);

    const chars = person?.chars || [];
    // the first profile character is the suggestion until somebody picks another
    const pick = charKey || (chars[0] ? chars[0].key : TYPED);
    const pickPerson = (p: RosterSearchResult) => {
        setPerson(p);
        setCharKey("");
    };

    const roles = [data.roster.mainRole, status === "trial" ? data.roster.trialRole : null]
        .filter(Boolean).map((r) => `@${r?.name || r?.id}`).join(" + ");

    const submit = async () => {
        if (!person) return;
        const chosen = pick === TYPED ? typed.trim() : pick;
        const result = await run("add", () => saveRosterMember(rosterId, person.userId, {
            status,
            chars: chosen ? [chosen] : [],
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(status === "trial" && trialUntil ? { trialUntil } : {}),
        }, "add"), (r) => [t("roster.add.done", { name: person.displayName }), ...changedRoleLines(r.roles.results)].join(" · "));
        if (!result) return;
        onDone();
        if (result.roles.results.some((r) => !r.ok)) setFailed(result.roles.results);
        else onClose();
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="achievement_guildperk_everybodysfriend"
            tone="roster"
            kicker={data.roster.name}
            title={t("roster.add.title")}
            width={620}
            className="rn-dlg"
            footer={failed ? <Button onClick={onClose}>{t("roster.add.close")}</Button> : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    {person && <Button running={busy === "add"} onClick={submit}>{t("roster.add.submit")}</Button>}
                </>
            )}
        >
            {failed ? (
                <section className="rn-dlg-sec">
                    <p>{t("roster.add.doneText", { name: person?.displayName || "" })}</p>
                    <RoleResults results={failed} />
                </section>
            ) : !person ? <PersonSearch rosterId={rosterId} onPick={pickPerson} /> : (
                <>
                    <section className="rn-dlg-sec">
                        <div className="rn-lbl">{t("roster.add.person")}</div>
                        <div className="rn-picked">
                            <span className="rn-ava" aria-hidden="true">{initialOf(person.displayName)}</span>
                            <b>{person.displayName}</b>
                            {!prefill && <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>{t("roster.add.other")}</Button>}
                        </div>
                    </section>
                    <section className="rn-dlg-sec">
                        <div className="rn-lbl">{t("roster.add.status")}</div>
                        <StatusPicker value={status} onChange={setStatus} label={t("roster.add.status")} />
                        {status === "trial" && (
                            <Field label={t("roster.drawer.trialUntil")} htmlFor="rn-add-trial" hint={t("roster.add.trialHint")}>
                                <input id="rn-add-trial" type="date" value={trialUntil} onChange={(e) => setTrialUntil(e.target.value)} />
                            </Field>
                        )}
                    </section>
                    <section className="rn-dlg-sec">
                        <div className="rn-lbl">{t("roster.add.char", { version: data.roster.versionLabel })}</div>
                        <div className="rn-char-pick" role="radiogroup" aria-label={t("roster.add.char", { version: data.roster.versionLabel })}>
                            {chars.map((c, i) => (
                                <button key={c.key} type="button" role="radio" aria-checked={pick === c.key} className={`rn-char-opt${pick === c.key ? " is-on" : ""}`} onClick={() => setCharKey(c.key)}>
                                    <CharChip char={searchChar(c)} first />
                                    {i === 0 && <span className="rn-sub">{t("roster.add.suggested")}</span>}
                                </button>
                            ))}
                            <button type="button" role="radio" aria-checked={pick === TYPED} className={`rn-char-opt${pick === TYPED ? " is-on" : ""}`} onClick={() => setCharKey(TYPED)}>
                                {t("roster.drawer.typed")}
                            </button>
                        </div>
                        {pick === TYPED && (
                            <input className="inp-sm rn-typed-inp" value={typed} maxLength={40} aria-label={t("roster.drawer.typedLabel")} placeholder={t("roster.drawer.typedPlaceholder")} onChange={(e) => setTyped(e.target.value)} />
                        )}
                        {!chars.length && <p className="rn-sub">{t("roster.add.noProfileCharsHint")}</p>}
                    </section>
                    <section className="rn-dlg-sec">
                        <Field label={t("roster.drawer.note")} htmlFor="rn-add-note" hint={t("roster.drawer.noteHint")}>
                            <textarea id="rn-add-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
                        </Field>
                    </section>
                    <Notice>
                        {roles ? t("roster.add.roleNote", { roles }) : t("roster.add.noRoleNote")}
                    </Notice>
                </>
            )}
        </Modal>
    );
}
