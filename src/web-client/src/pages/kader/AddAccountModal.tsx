// "Spieler hinzufügen" one at a time: a member of the server (searched by name)
// or a raw Discord id with a display name, optionally with a first character (a
// Forever name or a nickname). The player goes into this Kader's pool; the
// bulk way in is the import from Discord roles (ImportModal).
import { useState } from "react";
import { addKaderAccount, addKaderPlayers, type KaderMember, type KaderNameStyle } from "../../api";
import { Button, Modal, Segment } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { className } from "../../lib/kader/model";
import { nameOk } from "../../lib/kader/names";
import { PickIcon, PickLabel } from "./parts";
import { useKader } from "./kaderContext";

type Way = "server" | "id";

export default function AddAccountModal({ startWay = "server", onClose }: { startWay?: Way; onClose: () => void }) {
    const t = useT();
    const toast = useToast();
    const { view, kader, run } = useKader();
    const [way, setWay] = useState<Way>(startWay);
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
    const inKader = (m: KaderMember) => !!kader.players[m.userId];
    const isNick = nameStyle === "nick";
    const someChar = !!((isNick ? nick : first || last) || cls);
    const charOk = !someChar || (!!cls && (isNick ? nameOk(nick, "nick") : nameOk(`${first.trim()} ${last.trim()}`, "forever")));
    const idOk = /^\d{17,20}$/.test(rawId.trim());
    const ready = charOk && (way === "server" ? !!member && !inKader(member) : idOk && rawName.trim().length > 0);

    const submit = async () => {
        const userId = way === "server" && member ? member.userId : rawId.trim();
        const displayName = way === "server" && member ? member.displayName : rawName.trim();
        const character = !someChar ? undefined : isNick
            ? { nameStyle, nickname: nick.trim(), className: cls }
            : { nameStyle, firstName: first.trim(), lastName: last.trim(), className: cls };
        const result = way === "server" && !character
            ? await run(addKaderPlayers(kader.id, [{ userId, displayName }]))
            : await run(addKaderAccount({ userId, displayName, kaderId: kader.id, character }));
        if (result) {
            toast(t("kader.add.done", { name: displayName }));
            onClose();
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            kicker={t("kader.import.kicker", { name: kader.name })}
            title={t("kader.add.title")}
            width={640}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ready} onClick={() => void submit()}>{t("kader.add.submit")}</Button>
                </>
            )}
        >
            <div className="kp-way">
                <Segment<Way> ariaLabel={t("kader.add.title")} value={way} onChange={setWay}
                    options={[{ value: "server", label: t("kader.add.fromServer") }, { value: "id", label: t("kader.add.byId") }]} />
            </div>
            {way === "server" ? (
                <>
                    <label className="field">
                        <span className="field-label">{t("kader.add.search")}</span>
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("kader.add.searchPlaceholder")} />
                    </label>
                    <div className="kp-results">
                        {view.members.length === 0 && <span className="kp-hint">{t("kader.add.noMembers")}</span>}
                        {hits.map((m) => (
                            <div key={m.userId} className={`kp-result${picked === m.userId ? " kp-picked" : ""}`}>
                                <PickIcon pick={m.prefill} size={22} />
                                <span className="kp-col kp-grow">
                                    <span className="kp-strong">{m.displayName}</span>
                                    {m.prefill ? <PickLabel pick={m.prefill} className="kp-sub" /> : <span className="kp-sub">{t("kader.add.noData")}</span>}
                                </span>
                                {inKader(m)
                                    ? <span className="kp-sub">{t("kader.add.inKader")}</span>
                                    : <Button size="sm" variant={picked === m.userId ? "primary" : "ghost"} aria-pressed={picked === m.userId} onClick={() => setPicked(picked === m.userId ? null : m.userId)}>
                                        {picked === m.userId ? t("kader.add.picked") : t("common.add")}
                                    </Button>}
                            </div>
                        ))}
                        {view.members.length > 0 && hits.length === 0 && <span className="kp-hint">{t("kader.add.nobody")}</span>}
                    </div>
                </>
            ) : (
                <div className="kp-two">
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
