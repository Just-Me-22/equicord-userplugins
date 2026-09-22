/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function ageOf(timestamp: number) {
    const elapsed = Date.now() - timestamp;
    if (elapsed < MINUTE) return "now";
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
    if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
    return `${Math.floor(elapsed / (7 * DAY))}w`;
}

export function isStale(timestamp: number) {
    const { staleAfter } = settings.store;
    return staleAfter > 0 && Date.now() - timestamp > staleAfter * HOUR;
}

let keywordSource = "";
let keywordList: string[] = [];

export function matchesKeyword(text: string) {
    const { keywords } = settings.store;
    if (!keywords) return false;

    if (keywords !== keywordSource) {
        keywordSource = keywords;
        keywordList = keywords.split(",").map(word => word.trim().toLowerCase()).filter(Boolean);
    }
    if (!keywordList.length) return false;

    const haystack = text.toLowerCase();
    return keywordList.some(word => haystack.includes(word));
}
