/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Guild } from "@vencord/discord-types";
import { StickerFormatType } from "@vencord/discord-types/enums";
import { EmojiStore, GuildStore, IconUtils, PermissionsBits, PermissionStore, StickersStore } from "@webpack/common";

export type Kind = "emoji" | "sticker";

export interface Asset {
    key: string;
    id: string;
    kind: Kind;
    guildId: string;
    name: string;
    animated: boolean;
    url: string;
    filename: string;
    tags: string;
    description: string;
}

export interface Capacity {
    static: number;
    animated: number;
    stickers: number;
    maxEmoji: number;
    maxStickers: number;
}

export interface GuildInfo {
    id: string;
    name: string;
    icon?: string;
    canManage: boolean;
    canCreate: boolean;
    capacity: Capacity;
}

const EMOJI_SLOTS = [50, 100, 150, 250];
const STICKER_SLOTS = [5, 15, 30, 60];

export const assetKey = (kind: Kind, id: string) => `${kind}:${id}`;

export function emojiAssets(guildId: string): Asset[] {
    return (EmojiStore.getGuildEmoji(guildId) ?? []).filter(emoji => !emoji.managed).map(emoji => ({
        key: assetKey("emoji", emoji.id),
        id: emoji.id,
        kind: "emoji",
        guildId,
        name: emoji.name,
        animated: emoji.animated,
        url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`,
        filename: `${emoji.name}.${emoji.animated ? "gif" : "png"}`,
        tags: "",
        description: ""
    }));
}

export function stickerAssets(guildId: string): Asset[] {
    return (StickersStore.getStickersByGuildId(guildId) ?? []).filter(sticker => sticker.format_type !== StickerFormatType.LOTTIE).map(sticker => {
        const gif = sticker.format_type === StickerFormatType.GIF;
        return {
            key: assetKey("sticker", sticker.id),
            id: sticker.id,
            kind: "sticker",
            guildId,
            name: sticker.name,
            animated: gif || sticker.format_type === StickerFormatType.APNG,
            url: gif ? `https://media.discordapp.net/stickers/${sticker.id}.gif` : `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
            filename: `${sticker.name}.${gif ? "gif" : "png"}`,
            tags: sticker.tags || "star",
            description: sticker.description ?? ""
        };
    });
}

export const assetsOf = (guildId: string, kind: Kind) => kind === "emoji" ? emojiAssets(guildId) : stickerAssets(guildId);

export function capacityOf(guild: Guild): Capacity {
    const tier = guild.features.has("PREMIUM_TIER_3_OVERRIDE") ? 3 : Number(guild.premiumTier) || 0;
    const emoji = EmojiStore.getGuildEmoji(guild.id) ?? [];
    return {
        static: emoji.filter(one => !one.animated && !one.managed).length,
        animated: emoji.filter(one => one.animated && !one.managed).length,
        stickers: (StickersStore.getStickersByGuildId(guild.id) ?? []).length,
        maxEmoji: Math.max(EMOJI_SLOTS[tier] ?? 50, guild.features.has("MORE_EMOJI") ? 200 : 0),
        maxStickers: Math.max(STICKER_SLOTS[tier] ?? 5, guild.features.has("MORE_STICKERS") ? 60 : 0)
    };
}

export function listGuilds(): GuildInfo[] {
    return Object.values(GuildStore.getGuilds())
        .map((guild: Guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }) : undefined,
            canManage: PermissionStore.can(PermissionsBits.MANAGE_GUILD_EXPRESSIONS, guild),
            canCreate: PermissionStore.can(PermissionsBits.CREATE_GUILD_EXPRESSIONS, guild) || PermissionStore.can(PermissionsBits.MANAGE_GUILD_EXPRESSIONS, guild),
            capacity: capacityOf(guild)
        }))
        .filter(info => info.canCreate || info.capacity.static + info.capacity.animated + info.capacity.stickers > 0)
        .sort((a, b) => Number(b.canCreate) - Number(a.canCreate) || a.name.localeCompare(b.name));
}

export interface Fit {
    fits: Asset[];
    overflow: Asset[];
}

export function fitInto(capacity: Capacity, assets: Asset[]): Fit {
    let freeStatic = capacity.maxEmoji - capacity.static;
    let freeAnimated = capacity.maxEmoji - capacity.animated;
    let freeStickers = capacity.maxStickers - capacity.stickers;
    const fits: Asset[] = [];
    const overflow: Asset[] = [];

    for (const asset of assets) {
        const room = asset.kind === "sticker" ? freeStickers : asset.animated ? freeAnimated : freeStatic;
        if (room <= 0) {
            overflow.push(asset);
            continue;
        }
        fits.push(asset);
        if (asset.kind === "sticker") freeStickers--;
        else if (asset.animated) freeAnimated--;
        else freeStatic--;
    }
    return { fits, overflow };
}

export function freeName(name: string, taken: Set<string>, max: number) {
    const base = name.slice(0, max);
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
        const suffix = `_${n}`;
        const candidate = base.slice(0, max - suffix.length) + suffix;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

export function takenNames(guildId: string, kind: Kind) {
    return new Set(assetsOf(guildId, kind).map(asset => asset.name.toLowerCase()));
}
