// "Discord-Account hinzufügen": a member of the server (searched by name) or a
// raw Discord id with a display name, optionally with a first character (a
// Forever name or a nickname).
// Accounts with an EventHelper profile of the version are in the pool already.
import { useState } from "react";
import { addKaderAccount, type KaderNameStyle } from "../../api";
import { Button, Modal, Segment } from "../../components/ui";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { className, specName } from "../../lib/kader/model";
import { nameOk } from "../../lib/kader/names";
import { useKader } from "./kaderContext";

type Tab = "server" | "id";

const initial = (name: string) => (name.trim()[0] || "?").toUpperCase();

export default function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: (userId: string) => void }) {
    const t = useT();
    const { view, run } = useKader();
    const [tab, setTab] = usePersistedState<Tab>("kader-add-tab", "server");
    const [q, setQ] = useState("");
    const [picked, setPicked] = useState<string | null>(null);
    const [rawId, setRawId] = useState("");
    const [rawName, setRawName] = useState("");
    const [first, setFirst] = useState("");
    const [last, setLast] = useState("");
    const [nick, setNick] = useState("");
    const [nameStyle, setNameStyle] = useState<KaderNameStyle>("forever");
    const [cls, setCls] = useState("");

    const needle = q.trim().toLowerCase();
    const hits = view.members.filter((m) => !needle || m.displayName.toLowerCase().includes(needle)).slice(0, 40);
    const member = view.members.find((m) => m.userId === picked);
    const isNick = nameStyle === "nick";
    const someChar = !!((isNick ? nick : first || last) || cls);
    const charOk = !someChar || (!!cls && (isNick ? nameOk(nick, "nick") : nameOk(`${first.trim()} ${last.trim()}`, "forever")));
    const ready = charOk && (tab === "server" ? !!member && !member.inPool : /^\d{17,20}$/.test(rawId.trim()) && rawName.trim().length > 0);

    const submit = async () => {
        const userId = tab === "server" && member ? member.userId : rawId.trim();
        const displayName = tab === "server" && member ? member.displayName : rawName.trim();
        const next = await run(addKaderAccount({ userId, displayName, character: !someChar ? undefined : isNick ? { nameStyle, nickname: nick.trim(), className: cls } : { nameStyle, firstName: first.trim(), lastName: last.trim(), className: cls } }));
        if (next) onAdded(userId);
    };

    const hintOf = (m: typeof view.members[number]) => {
        if (!m.hasProfile) return t("kader.add.noProfile");
        const line = m.profile ? `${className(view.classes, m.profile.className)} · ${specName(view.classes, m.profile.mainSpec) || t("kader.player.noSpec")}` : "";
        return m.pct === null ? t("kader.add.profile", { line }) : t("kader.add.profileAtt", { line, pct: m.pct });
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={t("kader.add.title")}
            width={640}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ready} onClick={() => void submit()}>{t("kader.add.submit")}</Button>
                </>
            )}
        >
            <Segment<Tab> ariaLabel={t("kader.add.title")} value={tab} onChange={setTab}
                options={[{ value: "server", label: t("kader.add.fromServer") }, { value: "id", label: t("kader.add.byId") }]} />
            {tab === "server" ? (
                <>
                    <label className="field kp-gap">
                        <span className="field-label">{t("kader.add.search")}</span>
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("kader.add.searchPlaceholder")} />
                    </label>
                    <div className="kp-results">
                        {view.members.length === 0 && <span className="kp-hint">{t("kader.add.noMembers")}</span>}
                        {hits.map((m) => (
                            <div key={m.userId} className={`kp-result${picked === m.userId ? " kp-picked" : ""}`}>
                                <span className="kp-avatar" aria-hidden="true">{initial(m.displayName)}</span>
                                <span className="kp-col kp-grow">
                                    <span className="kp-result-name">@{m.displayName}</span>
                                    <span className={`kp-sub${m.hasProfile ? " kp-accent2" : ""}`}>{hintOf(m)}</span>
                                </span>
                                {m.inPool
                                    ? <span className="kp-sub">{t("kader.add.inPool")}</span>
                                    : <Button size="sm" variant={picked === m.userId ? "primary" : "ghost"} aria-pressed={picked === m.userId} onClick={() => setPicked(picked === m.userId ? null : m.userId)}>
                                        {picked === m.userId ? t("kader.add.picked") : t("common.add")}
                                    </Button>}
                            </div>
                        ))}
                        {view.members.length > 0 && hits.length === 0 && <span className="kp-hint">{t("kader.pool.nobody")}</span>}
                    </div>
                </>
            ) : (
                <div className="kp-two kp-gap">
                    <label className="field">
                        <span className="field-label">{t("kader.add.discordId")}</span>
                        <input inputMode="numeric" value={rawId} onChange={(e) => setRawId(e.target.value)} placeholder="280140000001000000" />
                        <span className="kp-sub">{t("kader.add.discordIdHint")}</span>
                    </label>
                    <label className="field">
                        <span className="field-label">{t("kader.add.displayName")}</span>
                        <input value={rawName} maxLength={40} onChange={(e) => setRawName(e.target.value)} />
                    </label>
                </div>
            )}
            <div className="kp-charhead kp-gap">
                <span className="kicker">{t("kader.add.charOptional")}</span>
                <Segment<KaderNameStyle> size="sm" ariaLabel={t("kader.field.nameStyle")} value={nameStyle} onChange={setNameStyle}
                    options={[{ value: "forever", label: t("kader.field.nameForever") }, { value: "nick", label: t("kader.field.nameNick") }]} />
            </div>
            <div className={isNick ? "kp-two" : "kp-three"}>
                {isNick ? (
                    <label className="field">
                        <span className="field-label">{t("kader.field.nickname")}</span>
                        <input maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} />
                    </label>
                ) : (
                    <>
                        <label className="field">
                            <span className="field-label">{t("kader.field.firstName")}</span>
                            <input maxLength={12} value={first} onChange={(e) => setFirst(e.target.value.replace(/\s/g, ""))} />
                        </label>
                        <label className="field">
                            <span className="field-label">{t("kader.field.lastName")}</span>
                            <input maxLength={12} value={last} onChange={(e) => setLast(e.target.value.replace(/\s/g, ""))} />
                        </label>
                    </>
                )}
                <label className="field">
                    <span className="field-label">{t("kader.field.class")}</span>
                    <select value={cls} onChange={(e) => setCls(e.target.value)}>
                        <option value="">{t("kader.add.pickClass")}</option>
                        {view.classes.map((c) => <option key={c.key} value={c.key}>{className(view.classes, c.key)}</option>)}
                    </select>
                </label>
            </div>
        </Modal>
    );
}
