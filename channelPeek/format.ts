/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { RelationshipStore, UserStore } from "@webpack/common";

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
let patterns: RegExp[] = [];

function compile(term: string) {
    const slashed = term.match(/^\/(.+)\/([gimsuy]*)$/);
    if (slashed) {
        try {
            return new RegExp(slashed[1], slashed[2].replace("g", ""));
        } catch {
            return undefined;
        }
    }

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

function keywordPatterns() {
    const { keywords } = settings.store;
    if (!keywords) return [];

    if (keywords !== keywordSource) {
        keywordSource = keywords;
        patterns = keywords
            .split(",")
            .map(term => term.trim())
            .filter(Boolean)
            .map(compile)
            .filter((pattern): pattern is RegExp => Boolean(pattern));
    }

    return patterns;
}

export function matchesKeyword(text: string) {
    return keywordPatterns().some(pattern => pattern.test(text));
}

const KEYWORD_HIGHLIGHT = "vc-channel-peek-keyword";
const keywordRanges = new Highlight();

export function startKeywordHighlight() {
    CSS.highlights.set(KEYWORD_HIGHLIGHT, keywordRanges);
}

export function stopKeywordHighlight() {
    CSS.highlights.delete(KEYWORD_HIGHLIGHT);
    keywordRanges.clear();
}

export function markKeywords(root: HTMLElement) {
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue ?? "";
        for (const pattern of keywordPatterns()) {
            const found = pattern.exec(value);
            if (!found?.[0]) continue;

            const range = new Range();
            range.setStart(node, found.index);
            range.setEnd(node, found.index + found[0].length);
            ranges.push(range);
            keywordRanges.add(range);
        }
    }

    return () => ranges.forEach(range => keywordRanges.delete(range));
}

export function nameOf(message: Message) {
    const { author } = message;
    if (author.id === UserStore.getCurrentUser()?.id) return "You";
    return RelationshipStore.getNickname(author.id) || author.globalName || author.username;
}
