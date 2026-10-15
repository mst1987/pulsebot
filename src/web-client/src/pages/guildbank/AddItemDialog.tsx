// "Gegenstand hinzufügen": an item the bank does not hold gets a row of
// its own, so the orga can offer it and keep a waiting list for it. The input
// is an item id, a Wowhead link or a name; a name is searched on Wowhead
// (debounced) and a hit is added with one click. The item lands on "Ausgebbar"
// with stock 0 — requests for it wait on the list until a scan shows stock.
import { useEffect, useState } from "react";
import { searchGuildBankItems, type ApiError, type GuildBankItemHit } from "../../api";
import { Button, Field, Modal } from "../../components/ui";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useT } from "../../i18n";
import { isDirectItemInput } from "./bankView";
import { PlusIcon } from "../../components/ui/icons";

const SEARCH_DELAY_MS = 350;

export default function AddItemDialog({ bankKey, saving, onClose, onAdd }: {
    bankKey: string;
    saving: boolean;
    onClose: () => void;
    onAdd: (input: { itemId: number } | { query: string }) => void;
}) {
    const t = useT();
    const [text, setText] = useState("");
    const [hits, setHits] = useState<GuildBankItemHit[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState("");
    const value = text.trim();
    const direct = isDirectItemInput(value);
    const byName = value.length >= 2 && !direct && !/^https?:\/\//i.test(value);

    useEffect(() => {
        setHits(null);
        setSearchError("");
        if (!byName) {
            setSearching(false);
            return undefined;
        }
        let stale = false;
        setSearching(true);
        const timer = window.setTimeout(() => {
            searchGuildBankItems(bankKey, value)
                .then((r) => { if (!stale) setHits(r.items); })
                .catch((err: ApiError) => { if (!stale) setSearchError(err.message); })
                .finally(() => { if (!stale) setSearching(false); });
        }, SEARCH_DELAY_MS);
        return () => { stale = true; window.clearTimeout(timer); };
    }, [bankKey, value, byName]);

    const submit = () => {
        if (saving || !value) return;
        if (direct) onAdd({ query: value });
        else if (hits && hits.length === 1) onAdd({ itemId: hits[0].id });
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_jewelcrafting_crimsonspinel_01"
            tone="bank"
            kicker={t("guildbank.add.kicker")}
            title={t("guildbank.add.title")}
            width={520}
            initialFocus="#gb-add-query"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<PlusIcon />} onClick={submit} disabled={saving || !(direct || (hits && hits.length === 1))}>
                        {saving ? t("common.saving") : t("guildbank.add.submit")}
                    </Button>
                </>
            )}
        >
            <form className="gb-fields" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <Field className="field gb-wide" label={t("guildbank.add.label")} htmlFor="gb-add-query" hint={t("guildbank.add.hint")}
                    error={searchError || undefined}>
                    <input id="gb-add-query" maxLength={300} value={text} placeholder={t("guildbank.add.placeholder")} autoComplete="off"
                        onChange={(e) => setText(e.target.value)} />
                </Field>
                {byName && (
                    <div className="gb-wide gb-add-hits" aria-live="polite">
                        {searching && <span className="muted">{t("guildbank.add.searching")}</span>}
                        {!searching && hits && !hits.length && !searchError && <span className="muted">{t("guildbank.add.noHits")}</span>}
                        {!searching && hits && hits.length > 0 && (
                            <ul className="gb-reqs" aria-label={t("guildbank.add.hits")}>
                                {hits.map((h) => (
                                    <li key={h.id}>
                                        <button type="button" className="gb-add-hit" disabled={saving} onClick={() => onAdd({ itemId: h.id })}>
                                            <ItemIcon url={h.iconUrl} quality={h.quality} />
                                            <span className="gb-req-text">
                                                <span className="gb-req-title">{h.name}</span>
                                                <span className="gb-req-sub">{t("guildbank.add.itemId", { id: h.id })}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                {direct && <div className="gb-wide muted">{t("guildbank.add.directHint")}</div>}
                <div className="gb-wide gb-add-note">{t("guildbank.add.note")}</div>
                {/* Enter in the field adds */}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}
