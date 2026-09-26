import { splitMentions } from "../../lib/raidplan/mention";
import { useT } from "../../i18n";

/** A text with the names of the visitor's own characters marked (the one highlight of "that is you", see .rp-me-hit). */
export default function Mentions({ text, names }: { text: string; names: string[] }) {
    const t = useT();
    if (names.length === 0) return <>{text}</>;
    return (
        <>
            {splitMentions(text, names).map((p, i) => (p.hit ? <mark key={i} className="rp-me-hit" data-tip={t("raidBoard.public.thatsYou")}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
        </>
    );
}
