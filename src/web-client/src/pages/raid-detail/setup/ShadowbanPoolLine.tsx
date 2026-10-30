import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../../i18n";
import LevelMark from "../../../components/vermerke/LevelMark";
import { vermerkeHref } from "../../../components/vermerke/markText";

/**
 * Vermerke (#981): one calm line under the editor's bar - "2 Personen mit
 * Shadowban im Pool · Name, Name". The setup proposal leaves them out; this
 * says why they stay in "Angemeldet". Nothing without the list (an answer
 * carries it only past maySeeShort) or with an empty one. With read access to
 * "vermerke" each name links to the person's notes, else it is plain text.
 */
export function ShadowbanPoolLine({ people, canOpen = false }: {
    people?: { userId: string; name: string }[] | null;
    canOpen?: boolean;
}) {
    const t = useT();
    if (!people || people.length === 0) return null;
    return (
        <p className="se-banline" role="status">
            <LevelMark level="shadowban" iconOnly size={15} tipSub={t("vermerke.poolLineTip")} />
            <span className="se-banline-text">{t("vermerke.poolLine", { count: people.length })}</span>
            <span className="se-banline-sep" aria-hidden="true">·</span>
            <span className="se-banline-names">
                {people.map((p, i) => (
                    <Fragment key={p.userId}>
                        {i > 0 && ", "}
                        {canOpen
                            ? <Link to={vermerkeHref(p.userId)}>{p.name}</Link>
                            : <span>{p.name}</span>}
                    </Fragment>
                ))}
            </span>
        </p>
    );
}
