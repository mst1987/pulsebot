import { BRAND_ICONS, DISCORD_PATH, UI_GLYPHS, UI_LINE_ICONS, isBrandIcon, isUiLineIcon, type UiGlyph, type UiIconName } from "../../lib/ui/iconSet";

// An icon of the app's own set (#951, src/web-client/src/lib/ui/iconSet.ts):
// an own glyph as inline SVG in its tone colour, or a brand mark as the brand
// ships it. It carries the classes "wi uic", so every size a page gives a
// WowIcon (".rl-icon .wi" …) applies to it as well. Without a title it is
// decorative (the label next to it carries the meaning); with one it is an
// image with that name. data-icon names the key (tests, the browser check).
export default function Icon({ name, size = 18, title, className = "" }: {
    name: UiIconName;
    size?: number;
    title?: string;
    className?: string;
}) {
    const a11y = title
        ? { role: "img" as const, "aria-label": title }
        : { "aria-hidden": true as const };
    const cls = (extra: string) => `wi uic ${extra}${className ? ` ${className}` : ""}`;

    if (isBrandIcon(name)) {
        if (name === "discord") {
            return (
                <svg className={cls("uic-brand uic-discord")} data-icon={name} viewBox="0 0 24 24" width={size} height={size} {...a11y}>
                    {title && <title>{title}</title>}
                    <path d={DISCORD_PATH} fill="currentColor" />
                </svg>
            );
        }
        return (
            <img
                className={cls(`uic-brand uic-${name}`)}
                data-icon={name}
                src={BRAND_ICONS[name]}
                width={size}
                height={size}
                alt={title ?? ""}
                {...(title ? {} : { "aria-hidden": true })}
                loading="lazy"
            />
        );
    }

    if (isUiLineIcon(name)) {
        // A plain line icon for an action or state: no tone, it takes the
        // colour of the text or button it sits in.
        return (
            <svg
                className={cls("uic-line")}
                data-icon={name}
                viewBox="0 0 24 24"
                width={size}
                height={size}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                {...a11y}
            >
                {title && <title>{title}</title>}
                {UI_LINE_ICONS[name].map(d => <path key={d} d={d} />)}
            </svg>
        );
    }

    // menu.json is cast, not checked by tsc: an unknown name renders nothing
    // (like the server-rendered chrome) instead of taking the whole shell down.
    const glyph = UI_GLYPHS[name] as UiGlyph | undefined;
    if (!glyph) return null;
    return (
        <svg
            className={cls(`uic-${glyph.tone}`)}
            data-icon={name}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            {...a11y}
        >
            {title && <title>{title}</title>}
            <path d={glyph.d} fill="currentColor" fillRule="evenodd" />
        </svg>
    );
}
