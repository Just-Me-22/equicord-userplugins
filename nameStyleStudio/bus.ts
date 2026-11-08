/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

export interface StudioTarget {
    guildId?: string | null;
    primary: number;
    secondary: number;
}

const listeners = new Set<() => void>();

export const emit = () => listeners.forEach(l => l());

export function useBus() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
}

export const themeTarget = { guildId: undefined as string | null | undefined };
