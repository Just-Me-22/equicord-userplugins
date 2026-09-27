/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

const SETTLE = 1000;

const listeners = new Set<() => void>();
let settled = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit() {
    for (const listener of listeners) listener();
}

function onScroll() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        settled = true;
        emit();
    }, SETTLE);
    if (!settled) return;
    settled = false;
    emit();
}

function subscribe(listener: () => void) {
    if (!listeners.size) document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        document.removeEventListener("scroll", onScroll, { capture: true });
        clearTimeout(timer);
        settled = true;
    };
}

export function usePickerSettled() {
    return React.useSyncExternalStore(subscribe, () => settled);
}
