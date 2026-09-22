/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";

export interface EmojiSelectPayload {
    id?: string | null;
    name?: string | null;
    animated?: boolean;
    optionallyDiverseSequence?: string;
}

export const ReactionEmojiPicker = findComponentByCodeLazy<any>("showAddEmojiButton:", "pickerIntention:", "messageId:");

export function emojiValue(emoji: EmojiSelectPayload | null | undefined) {
    if (!emoji) return "";
    if (emoji.id && emoji.name) return `${emoji.name}:${emoji.id}`;
    if (emoji.optionallyDiverseSequence?.trim()) return emoji.optionallyDiverseSequence;
    return emoji.name?.trim() ?? "";
}

export function emojiMarkup(emoji: EmojiSelectPayload | null | undefined) {
    if (!emoji) return "";
    if (emoji.id && emoji.name) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    if (emoji.optionallyDiverseSequence?.trim()) return emoji.optionallyDiverseSequence;
    return emoji.name?.trim() ?? "";
}
