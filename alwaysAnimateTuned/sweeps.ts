/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SweepTally {
    seen: number;
    rewritten: number;
    destructuring: number;
    literal: number;
    alreadyOff: number;
    classMap: number;
}

export const tallies: Record<string, SweepTally> = {};

const QUOTED = /^["'`]/;
const HASHED = /^["'`][A-Za-z][\w-]*__[\da-z]+["'`]$/;

function tally(name: string) {
    return tallies[name] ??= {
        seen: 0, rewritten: 0, destructuring: 0, literal: 0, alreadyOff: 0, classMap: 0
    };
}

export function sweep(prop: string) {
    return (match: string, value: string, rest: string) => {
        const counts = tally(prop);
        counts.seen++;

        if (/}=.+/.test(rest)) {
            counts.destructuring++;
            return match;
        }

        if (HASHED.test(value.trim())) {
            counts.classMap++;
            return match;
        }

        if (QUOTED.test(value.trim())) {
            counts.literal++;
            return match;
        }

        if (value === "!1") {
            counts.alreadyOff++;
            return match;
        }

        counts.rewritten++;
        return `${prop}:$self.on()${rest}`;
    };
}
