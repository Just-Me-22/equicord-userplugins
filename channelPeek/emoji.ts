/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";

import { OverrideMap, settings } from "./settings";

export interface ResolvedEmoji {
    emoji: string;
    custom: { id: string; name: string; } | null;
}

export function migrateOverrides() {
    const stored = settings.store.iconOverrides as unknown;
    if (typeof stored !== "string") return;

    const map: OverrideMap = {};
    for (const pair of stored.split(/\s+/)) {
        const at = pair.indexOf("=");
        if (at > 0) map[pair.slice(0, at)] = pair.slice(at + 1);
    }
    settings.store.iconOverrides = map;
}

export function getOverrides(): OverrideMap {
    const stored = settings.store.iconOverrides;
    return typeof stored === "string" ? {} : stored;
}

export function setOverride(channelId: string, emoji: string | null) {
    const next = { ...getOverrides() };
    if (emoji) next[channelId] = emoji;
    else delete next[channelId];
    settings.store.iconOverrides = next;
}

const AUTO = [
    [/\b(general|chat|talk|lounge|hangout)\b/, "\u{1F4AC}"],
    [/\b(announce|announcement|news|updates?)\b/, "\u{1F4E2}"],
    [/\b(rule|rules|info|read-?me|start|welcome)\b/, "\u{1F4CB}"],
    [/\b(art|draw|drawing|creative|gallery)\b/, "\u{1F3A8}"],
    [/\b(music|song|songs|audio)\b/, "\u{1F3B5}"],
    [/\b(meme|memes|funny|shitpost)\b/, "\u{1F602}"],
    [/\b(game|games|gaming|play)\b/, "\u{1F3AE}"],
    [/\b(anime|manga)\b/, "\u{1F338}"],
    [/\b(pic|pics|photo|photos|image|images|media)\b/, "\u{1F4F7}"],
    [/\b(video|videos|clip|clips|animation|animations)\b/, "\u{1F3AC}"],
    [/\b(link|links|share|resource|resources)\b/, "\u{1F517}"],
    [/\b(help|support|question|questions|ask)\b/, "\u{2753}"],
    [/\b(bot|bots|command|commands|spam)\b/, "\u{1F916}"],
    [/\b(dev|code|coding|programming|tech)\b/, "\u{1F4BB}"],
    [/\b(food|cooking|recipe|recipes)\b/, "\u{1F355}"],
    [/\b(pet|pets|cat|cats|dog|dogs|animal|animals)\b/, "\u{1F43E}"],
    [/\b(nsfw|lewd|spicy|horny)\b/, "\u{1F525}"],
    [/\b(vent|serious|mental|health)\b/, "\u{1F49A}"],
    [/\b(event|events|calendar|schedule)\b/, "\u{1F4C5}"],
    [/\b(vote|voting|poll|polls)\b/, "\u{1F5F3}"],
    [/\b(mod|mods|staff|admin)\b/, "\u{1F6E1}"],
    [/\b(intro|introduction|introductions|roles?)\b/, "\u{1F44B}"]
] as const;

const autoCache = new Map<string, string | null>();

function autoEmojiFor(name: string | undefined) {
    if (!name) return null;

    const cached = autoCache.get(name);
    if (cached !== undefined) return cached;

    const normalised = name.toLowerCase().replace(/[_-]+/g, " ");
    const hit = AUTO.find(([pattern]) => pattern.test(normalised))?.[1] ?? null;
    autoCache.set(name, hit);
    return hit;
}

export function resolveEmoji(channel: Channel): ResolvedEmoji | null {
    const override = getOverrides()[channel.id];
    if (override) {
        const custom = override.match(/^(.+):(\d+)$/);
        return custom
            ? { emoji: custom[1], custom: { id: custom[2], name: custom[1] } }
            : { emoji: override, custom: null };
    }

    const native = channel.iconEmoji;
    if (native?.name) return { emoji: native.name, custom: native.id ? { id: native.id, name: native.name } : null };

    const guessed = settings.store.autoEmoji ? autoEmojiFor(channel.name) : null;
    const emoji = guessed ?? settings.store.iconFallback;
    return emoji ? { emoji, custom: null } : null;
}

const tints = new Map<string, string>();

export function tintFor(emoji: string) {
    const cached = tints.get(emoji);
    if (cached) return cached;

    let hue = 7;
    for (const char of emoji) hue = (hue * 31 + char.codePointAt(0)!) % 360;

    const tint = `hsl(${hue} 45% 50% / 0.22)`;
    tints.set(emoji, tint);
    return tint;
}
