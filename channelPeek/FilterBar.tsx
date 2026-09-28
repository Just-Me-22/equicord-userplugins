/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { createRoot, Tooltip, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { getQuery, refresh, restartFilter, setQuery } from "./filter";
import { settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

function Bar() {
    const { hideRead } = settings.use(["hideRead"]);
    const [value, setValue] = useState(getQuery());

    return <div className={cl("filter")}>
        <label className={cl("filter-field")}>
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />
            </svg>
            <input
                className={cl("filter-input")}
                value={value}
                placeholder="Filter channels"
                onChange={e => {
                    setValue(e.currentTarget.value);
                    setQuery(e.currentTarget.value);
                }}
                onKeyDown={e => {
                    if (e.key !== "Escape") return;
                    setValue("");
                    setQuery("");
                }}
            />
        </label>
        <Tooltip text={hideRead ? "Show all channels" : "Only unread channels"}>
            {tip => <button
                {...tip}
                className={cl("filter-toggle", { "filter-toggle-on": hideRead })}
                aria-pressed={hideRead}
                onClick={() => {
                    tip.onClick?.();
                    settings.store.hideRead = !hideRead;
                    refresh();
                }}
            >
                <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5Z" />
                </svg>
            </button>}
        </Tooltip>
    </div>;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function nav() {
    return document.querySelector<HTMLElement>('nav:not([class*="privateChannels_"])');
}

export function attachFilterBar() {
    if (!settings.store.filterBar) return;

    const target = nav();
    if (!target) return;
    if (host && target.firstChild === host) return;

    if (!host) {
        host = document.createElement("div");
        host.className = cl("filter-host");
        root = createRoot(host);
        root.render(<Bar />);
    }

    target.prepend(host);
    restartFilter();
}

export function stopFilterBar() {
    root?.unmount();
    host?.remove();
    root = undefined;
    host = undefined;
}
