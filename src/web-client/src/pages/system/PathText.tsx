import { Fragment } from "react";

/**
 * A route or file path that may wrap only after a slash: "/api/dashboard"
 * breaks as "/api/" + "dashboard", never inside a word (browser check of
 * design pilot C, Systemstatus on a phone). Windows paths break after "\" too.
 */
export default function PathText({ text }: { text: string }) {
    const parts = text.match(/[^/\\]*[/\\]|[^/\\]+$/g) ?? [text];
    return (
        <>
            {parts.map((part, i) => (
                <Fragment key={i}>
                    {part}
                    {i < parts.length - 1 && <wbr />}
                </Fragment>
            ))}
        </>
    );
}
