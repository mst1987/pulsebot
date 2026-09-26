import { useEffect, useState, type CSSProperties } from "react";
import { postRaidSearch, previewRaidSearch, type ApiError, type SetupSearch } from "../../../api";
import { addRole, groupSearchBuffs, removeBuffs, searchNeedsFrom, stepRole, toggleSpec, type SearchNeeds } from "../../../lib/setupEditor";
import { roleLabel, rolePluralLabel, specLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import { Button, IconButton } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import WowIcon from "../../../components/ui/WowIcon";
import { useJobs } from "../../../components/Jobs";
import { XIcon } from "../../../components/icons";
import type { RaidCtx } from "../meta";

/**
 * "Suche": which classes and specs the raid still needs, worked out from the
 * setup as it stands (the server's suggestion) — and the orga edits it: more or
 * fewer of a role, specs taken in or out, a role added, a buff dropped. The
 * English message for the channel follows the changes (the server writes it),
 * stays editable by hand, and is posted into the event channel with one click.
 */
export function SearchModal({ open, onClose, ctx, search }: { open: boolean; onClose: () => void; ctx: RaidCtx; search: SetupSearch | null | undefined }) {
    const t = useT();
    const jobs = useJobs();
    const [needs, setNeeds] = useState<SearchNeeds>({ roles: [], buffs: [] });
    const [text, setText] = useState("");
    // the orga typed in the message: a change of the needs no longer rewrites it, "neu erzeugen" does
    const [touched, setTouched] = useState(false);
    const [writing, setWriting] = useState(false);
    const [posting, setPosting] = useState(false);
    useEffect(() => {
        if (!open || !search) return;
        setNeeds(searchNeedsFrom(search));
        setText(search.text);
        setTouched(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const regenerate = async (next: SearchNeeds) => {
        setWriting(true);
        try {
            const r = await previewRaidSearch(ctx.eventId, { roles: next.roles, buffs: next.buffs.map((b) => ({ key: b.key, required: b.required, specs: b.specs })) });
            setText(r.text);
            setTouched(false);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.search.failed"), "err");
        } finally {
            setWriting(false);
        }
    };
    const change = (next: SearchNeeds) => {
        setNeeds(next);
        if (!touched) void regenerate(next);
    };

    const nothing = !search || (!needs.roles.length && !needs.buffs.length && !search.open);
    const chip = (key: string, on: boolean, toggle?: () => void) => {
        const s = search?.specInfo[key];
        if (!s) return null;
        const inner = (
            <>
                <WowIcon name={s.icon || "inv_misc_questionmark"} size={18} />
                <span className="se-search-chip-name">{specLabel(key, s.label)}<small>{s.classLabel}</small></span>
            </>
        );
        return toggle
            ? <button key={key} type="button" className={`se-search-chip se-search-pick${on ? " is-on" : ""}`} style={{ "--se-chip": s.color } as CSSProperties} aria-pressed={on} onClick={toggle}>{inner}</button>
            : <span key={key} className="se-search-chip" style={{ "--se-chip": s.color } as CSSProperties}>{inner}</span>;
    };
    const chips = (keys: string[]) => keys.map((k) => chip(k, true));
    const missingRoles = Object.keys(search?.roleSpecs || {}).filter((r) => !needs.roles.some((x) => x.role === r));
    const post = async () => {
        setPosting(true);
        try {
            const r = await postRaidSearch(ctx.eventId, text);
            jobs.notify(r.message || t("setup.search.posted"), "ok");
            onClose();
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.search.failed"), "err");
        } finally {
            setPosting(false);
        }
    };
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_spyglass_02" tone="raids" kicker={t("setup.search.kicker")} title={t("setup.search.title")} width={780}
            hint={t("setup.search.hint")}
            footer={<Button variant="run" icon="inv_letter_15" running={posting} disabled={!search || !text.trim() || text.length > 2000 || writing} onClick={post}>{t("setup.search.post")}</Button>}
        >
            {!search ? <p className="se-note">{t("setup.search.none")}</p> : (
                <div className="se-search">
                    <p className="se-search-open">{t("setup.search.open", { open: search.open, size: search.size })}</p>
                    {needs.roles.map((r) => (
                        <div key={r.role} className="se-search-row">
                            <span className="se-search-need">
                                <span className="se-search-step" role="group" aria-label={roleLabel(r.role)}>
                                    <button type="button" onClick={() => change(stepRole(needs, r.role, -1))} aria-label={t("setup.search.fewer")}>-</button>
                                    <b>{r.missing}</b>
                                    <button type="button" onClick={() => change(stepRole(needs, r.role, 1))} aria-label={t("setup.search.more")}>+</button>
                                </span>
                                {r.missing > 1 ? rolePluralLabel(r.role) : roleLabel(r.role)}
                            </span>
                            <span className="se-search-chips">{(search.roleSpecs[r.role] || []).map((k) => chip(k, r.specs.includes(k), () => change(toggleSpec(needs, r.role, k))))}</span>
                        </div>
                    ))}
                    {groupSearchBuffs(needs.buffs).map((g) => (
                        <div key={g.id} className="se-search-row">
                            <span className="se-search-need" data-tip={g.buffs.map((b) => b.label).join(", ")}>
                                <span className="se-search-icons">{g.buffs.map((b) => <WowIcon key={b.key} name={b.icon || "inv_misc_questionmark"} size={20} />)}</span>
                                <span>
                                    {g.buffs.length > 2 ? t("setup.search.buffCount", { count: g.buffs.length }) : g.buffs.map((b) => b.label).join(", ")}
                                    <small className={g.required ? "se-search-req" : ""}>{g.required ? t("setup.search.required") : t("setup.search.helps")}</small>
                                </span>
                            </span>
                            <span className="se-search-chips">
                                {chips(g.specs)}
                                <IconButton
                                    className="se-search-drop" size="sm" icon={<XIcon />} tip={t("setup.search.drop")} tipSub={t("setup.search.dropSub")}
                                    onClick={() => change(removeBuffs(needs, g.buffs.map((b) => b.key)))}
                                />
                            </span>
                        </div>
                    ))}
                    {missingRoles.length > 0 && (
                        <div className="se-search-add">
                            <span className="se-tip-k">{t("setup.search.add")}</span>
                            {missingRoles.map((r) => (
                                <button key={r} type="button" className="se-search-addrole" onClick={() => change(addRole(needs, r, search.roleSpecs[r] || []))}>+ {roleLabel(r)}</button>
                            ))}
                        </div>
                    )}
                    {nothing && <p className="se-note">{t("setup.search.none")}</p>}
                    <label className="se-search-msg">
                        <span className="se-tip-k">{t("setup.search.message")}</span>
                        <textarea
                            value={text} maxLength={2000} rows={Math.min(16, text.split("\n").length + 3)} aria-label={t("setup.search.message")}
                            onChange={(e) => { setText(e.target.value); setTouched(true); }}
                        />
                        <span className="se-search-foot">
                            {touched && <button type="button" className="se-search-regen" onClick={() => void regenerate(needs)}>{t("setup.search.regenerate")}</button>}
                            <span className="se-search-count">{writing ? t("setup.search.writing") : `${text.length}/2000`}</span>
                        </span>
                    </label>
                </div>
            )}
        </Modal>
    );
}
