/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
    listeners.forEach(notify => notify());
}

function subscribe(notify: () => void) {
    listeners.add(notify);
    if (!timer) timer = setInterval(tick, 60_000);

    return () => {
        listeners.delete(notify);
        if (listeners.size || !timer) return;

        clearInterval(timer);
        timer = undefined;
    };
}

export function useMinute(active: boolean) {
    const [, bump] = useState(0);

    useEffect(() => {
        if (!active) return;
        return subscribe(() => bump(n => n + 1));
    }, [active]);
}

export function stopTicker() {
    listeners.clear();
    if (timer) clearInterval(timer);
    timer = undefined;
}
