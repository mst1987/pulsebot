import type { Lang } from "../../i18n";

// The flag in front of "DE" / "EN" in the language switch. Drawn as SVG: Windows
// shows flag emojis as two letters. English is the Union Jack.
export default function LangFlag({ lang }: { lang: Lang }) {
    if (lang === "de") {
        return (
            <svg className="lang-flag" viewBox="0 0 5 3" width="20" height="12" aria-hidden="true">
                <rect width="5" height="1" y="0" fill="#000" />
                <rect width="5" height="1" y="1" fill="#dd0000" />
                <rect width="5" height="1" y="2" fill="#ffce00" />
            </svg>
        );
    }
    return (
        <svg className="lang-flag" viewBox="0 0 60 30" width="20" height="12" aria-hidden="true">
            <clipPath id="lang-flag-uk"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
            <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
            <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#lang-flag-uk)" stroke="#c8102e" strokeWidth="4" />
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
            <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
        </svg>
    );
}
