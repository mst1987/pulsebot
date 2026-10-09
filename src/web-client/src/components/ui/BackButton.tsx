// The coloured "back" (tokens --back-*): a link to the page one level up, or a
// button for a step back inside a page. One look everywhere it appears — the
// Kaderplaner's steps and the Raid-Detail's "Raid-Events" (styles in ui.css).
import { Link } from "react-router-dom";
import { buttonClass } from "./Button";
import { ArrowLeftIcon } from "./icons";

export default function BackButton({ label, onClick, to, size = "md", disabled = false, className = "" }: {
    label: string;
    onClick?: () => void;
    /** a route: the button is a link */
    to?: string;
    size?: "md" | "sm";
    disabled?: boolean;
    /** a page's own class beside the shared one */
    className?: string;
}) {
    const cls = buttonClass("ghost", size, true, ["back-btn", className].filter(Boolean).join(" "));
    if (to) return <Link to={to} className={cls}><ArrowLeftIcon />{label}</Link>;
    return <button type="button" className={cls} disabled={disabled} onClick={onClick}><ArrowLeftIcon />{label}</button>;
}
