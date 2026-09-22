/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

const KEY = "ChannelPeek_activity";
const HOURS = 24;
const HOUR = 3_600_000;

type Buckets = Record<string, { at: number; counts: number[]; }>;

let buckets: Buckets = {};
let dirty = false;
let saver: ReturnType<typeof setInterval> | undefined;

const hourNow = () => Math.floor(Date.now() / HOUR);

function rolled(entry: { at: number; counts: number[]; }) {
    const shift = hourNow() - entry.at;
    if (shift <= 0) return entry;

    entry.counts = shift >= HOURS
        ? new Array(HOURS).fill(0)
        : [...entry.counts.slice(shift), ...new Array(shift).fill(0)];
    entry.at = hourNow();
    return entry;
}

export function recordMessage(channelId: string) {
    const entry = buckets[channelId] ?? { at: hourNow(), counts: new Array(HOURS).fill(0) };
    rolled(entry);

    entry.counts[HOURS - 1] += 1;
    buckets[channelId] = entry;
    dirty = true;
}

export function activityOf(channelId: string) {
    const entry = buckets[channelId];
    if (!entry) return undefined;

    rolled(entry);
    const peak = Math.max(...entry.counts);
    return peak > 0 ? entry.counts.map(count => count / peak) : undefined;
}

export async function loadActivity() {
    buckets = (await DataStore.get<Buckets>(KEY)) ?? {};
    saver = setInterval(() => {
        if (!dirty) return;
        dirty = false;
        DataStore.set(KEY, buckets);
    }, 60_000);
}

export function stopActivity() {
    if (saver) clearInterval(saver);
    saver = undefined;
    if (dirty) DataStore.set(KEY, buckets);
}
