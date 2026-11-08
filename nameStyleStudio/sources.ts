/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchUserProfile } from "@utils/discord";
import { findStoreLazy } from "@webpack";
import { GuildMemberStore, IconUtils, UserProfileStore, UserStore } from "@webpack/common";

import { extractPalette, Lab, rgbToLab } from "./color";

const UserProfileSettingsStore = findStoreLazy("UserProfileSettingsStore");
const CategoryStore = findStoreLazy("CollectiblesCategoryStore");
const PurchaseStore = findStoreLazy("CollectiblesPurchaseStore");

export type SourceId = "avatar" | "banner" | "decoration" | "nameplate" | "theme";

export interface Source {
    id: SourceId;
    label: string;
    image?: string;
    colors?: number[];
}

const pendingOf = (guildId?: string | null): Record<string, any> => UserProfileSettingsStore.getPendingChanges?.(guildId ?? void 0) ?? {};

function pick<T>(key: string, saved: T, guildId?: string | null, guildSaved?: T): T {
    if (guildId) {
        const gp = pendingOf(guildId);
        if (gp[key] !== void 0) return gp[key];
        if (guildSaved != null) return guildSaved;
    }
    const p = pendingOf();
    return p[key] !== void 0 ? p[key] : saved;
}

const imageOf = (v: any): string | undefined => typeof v === "string" ? v : v?.imageUri;

const CDN = "https://cdn.discordapp.com";

export async function loadSources(guildId?: string | null): Promise<Source[]> {
    const user = UserStore.getCurrentUser() as any;
    if (!user) return [];
    await fetchUserProfile(user.id).catch(() => null);
    const profile = UserProfileStore.getUserProfile(user.id) as any;
    const member = guildId ? GuildMemberStore.getMember(guildId, user.id) as any : null;
    const guildProfile = guildId ? (UserProfileStore as any).getGuildMemberProfile?.(user.id, guildId) : null;

    const guildAvatar = member?.avatar ? `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=256` : void 0;
    const avatar = imageOf(pick<any>("pendingAvatar", void 0, guildId, guildAvatar)) ?? IconUtils.getUserAvatarURL(user, false, 256);

    const guildBanner = guildProfile?.banner ? `${CDN}/guilds/${guildId}/users/${user.id}/banners/${guildProfile.banner}.png?size=600` : void 0;
    const savedBannerHash = profile?.banner ?? user.banner;
    const savedBanner = savedBannerHash ? IconUtils.getUserBannerURL({ id: user.id, banner: savedBannerHash, canAnimate: false, size: 600 }) : void 0;
    const banner = imageOf(pick<any>("pendingBanner", savedBanner, guildId, guildBanner));

    const decoration = pick<any>("pendingAvatarDecoration", user.avatarDecorationData, guildId, member?.avatarDecoration)?.asset;
    const nameplate = pick<any>("pendingNameplate", user.collectibles?.nameplate, guildId, member?.collectibles?.nameplate)?.asset;

    const theme = pick<number[] | null>("pendingThemeColors", profile?.themeColors ?? null, guildId, guildProfile?.themeColors)
        ?? (profile?.accentColor != null ? [profile.accentColor] : null);

    return [
        { id: "avatar", label: "Avatar", image: avatar },
        { id: "banner", label: "Banner", image: banner },
        { id: "decoration", label: "Decoration", image: decoration && `${CDN}/avatar-decoration-presets/${decoration}.png?size=160&passthrough=false` },
        { id: "nameplate", label: "Nameplate", image: nameplate && `${CDN}/assets/collectibles/${nameplate}static.png` },
        { id: "theme", label: "Profile theme", colors: theme?.filter(c => c != null) }
    ];
}

export function themeColorsNow(guildId?: string | null): number[] {
    const user = UserStore.getCurrentUser() as any;
    if (!user) return [];
    const profile = UserProfileStore.getUserProfile(user.id) as any;
    const guildProfile = guildId ? (UserProfileStore as any).getGuildMemberProfile?.(user.id, guildId) : null;
    const theme = pick<number[] | null>("pendingThemeColors", profile?.themeColors ?? null, guildId, guildProfile?.themeColors);
    return (theme ?? []).filter(c => c != null);
}

export function nameStyleColors(guildId?: string | null): number[] | undefined {
    const user = UserStore.getCurrentUser() as any;
    const member = guildId ? GuildMemberStore.getMember(guildId, user?.id) as any : null;
    const colors = pick<any>("pendingDisplayNameStyles", user?.displayNameStyles, guildId, member?.displayNameStyles)?.colors;
    return colors?.length ? colors : undefined;
}

export function bannerImage(guildId?: string | null): Promise<string | undefined> {
    return loadSources(guildId).then(s => s.find(x => x.id === "banner")?.image);
}

export function sampleCover(src: string, u: number, v: number, boxW: number, boxH: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onerror = () => reject(new Error("Could not load your banner"));
        img.onload = () => {
            const scale = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
            const x = Math.min(img.naturalWidth - 1, Math.max(0, (u * boxW + (img.naturalWidth * scale - boxW) / 2) / scale));
            const y = Math.min(img.naturalHeight - 1, Math.max(0, (v * boxH + (img.naturalHeight * scale - boxH) / 2) / scale));
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 3;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(img, x - 1, y - 1, 3, 3, 0, 0, 3, 3);
            const { data } = ctx.getImageData(0, 0, 3, 3);
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }
            resolve(Math.round(r / 9) << 16 | Math.round(g / 9) << 8 | Math.round(b / 9));
        };
        img.src = src;
    });
}

export function readPixels(src: string): Promise<Lab[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onerror = () => reject(new Error("Could not load that image"));
        img.onload = () => {
            const scale = 72 / Math.max(img.naturalWidth, img.naturalHeight, 1);
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0, w, h);
            const { data } = ctx.getImageData(0, 0, w, h);
            const out: Lab[] = [];
            for (let i = 0; i < data.length; i += 4)
                if (data[i + 3] >= 160) out.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
            resolve(out);
        };
        img.src = src;
    });
}

export function currentEffect(guildId?: string | null): { skuId: string; thumbnail?: string; } | null {
    const user = UserStore.getCurrentUser() as any;
    if (!user) return null;
    const profile = UserProfileStore.getUserProfile(user.id) as any;
    const guildProfile = guildId ? (UserProfileStore as any).getGuildMemberProfile?.(user.id, guildId) : null;
    const skuId = pick<any>("pendingProfileEffect", profile?.profileEffect, guildId, guildProfile?.profileEffect)?.skuId;
    if (!skuId) return null;
    return { skuId, thumbnail: effectConfig(skuId)?.thumbnailPreviewSrc };
}

function effectConfig(skuId: string): any {
    return CategoryStore.getProduct?.(skuId)?.items?.[0] ?? PurchaseStore.getPurchase?.(skuId)?.items?.[0];
}

async function framesOf(src: string, count: number): Promise<Lab[]> {
    const Decoder = (window as any).ImageDecoder;
    if (!Decoder) return readPixels(src);
    const res = await fetch(src, { mode: "cors" });
    const decoder = new Decoder({ data: res.body, type: res.headers.get("content-type") ?? "image/png" });
    try {
        await decoder.tracks.ready;
        const total = decoder.tracks.selectedTrack?.frameCount ?? 1;
        const out: Lab[] = [];
        for (let k = 0; k < Math.min(count, total); k++) {
            const { image } = await decoder.decode({ frameIndex: Math.floor(k * total / count) });
            const w = 64;
            const h = Math.max(1, Math.round(w * image.displayHeight / Math.max(1, image.displayWidth)));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(image, 0, 0, w, h);
            image.close();
            const { data } = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < data.length; i += 4)
                if (data[i + 3] >= 160) out.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
        }
        return out;
    } finally {
        decoder.close();
    }
}

export async function effectPalette(skuId: string): Promise<number[]> {
    const config = effectConfig(skuId);
    const layers: string[] = (config?.effects ?? []).map((e: any) => e?.src).filter(Boolean).slice(0, 4);
    const pixels: Lab[] = [];
    for (const src of layers) pixels.push(...await framesOf(src, 8).catch(() => readPixels(src).catch(() => [])));
    if (!pixels.length && config?.thumbnailPreviewSrc) pixels.push(...await readPixels(config.thumbnailPreviewSrc).catch(() => []));
    return extractPalette(pixels, 6, "weight");
}
