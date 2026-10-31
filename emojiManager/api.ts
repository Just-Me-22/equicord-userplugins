/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AuthenticationStore } from "@webpack/common";

import type { Asset } from "./data";

export type ApiResult<T> = { ok: true; value: T; } | { ok: false; status: number; code?: number; error: string; };

interface Options {
    signal?: AbortSignal;
    onWait?(seconds: number): void;
}

const MAX_ATTEMPTS = 6;
const token = () => (AuthenticationStore as unknown as { getToken(): string; }).getToken();

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}

function describe(data: any, status: number): string {
    const nested: string[] = [];
    const walk = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node._errors)) node._errors.forEach((err: any) => err?.message && nested.push(err.message));
        Object.values(node).forEach(walk);
    };
    walk(data?.errors);
    return nested[0] ?? data?.message ?? `Discord answered ${status}`;
}

async function request<T>(method: string, path: string, body: BodyInit | object | undefined, { signal, onWait }: Options = {}): Promise<ApiResult<T>> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const headers: Record<string, string> = { authorization: token() };
        let payload: BodyInit | undefined;
        if (body instanceof FormData || typeof body === "string") payload = body;
        else if (body) {
            headers["content-type"] = "application/json";
            payload = JSON.stringify(body);
        }

        const res = await fetch(`${location.origin}/api/v9${path}`, { method, headers, body: payload, signal });
        if (res.status === 204) return { ok: true, value: undefined as T };

        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
            const wait = Number(data.retry_after ?? res.headers.get("retry-after") ?? 5);
            onWait?.(wait);
            await sleep(wait * 1000 + 250, signal);
            continue;
        }
        if (res.ok) return { ok: true, value: data as T };
        return { ok: false, status: res.status, code: data.code, error: describe(data, res.status) };
    }
    return { ok: false, status: 429, error: "Discord kept asking to wait" };
}

const toDataUri = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

export async function download(asset: Asset, signal?: AbortSignal) {
    const res = await fetch(asset.url, { signal });
    if (!res.ok) throw new Error(`Could not download ${asset.name} (${res.status})`);
    return res.blob();
}

export async function createEmoji(guildId: string, name: string, image: Blob, options?: Options) {
    return request<{ id: string; }>("POST", `/guilds/${guildId}/emojis`, { name, image: await toDataUri(image), roles: [] }, options);
}

export function createSticker(guildId: string, sticker: { name: string; tags: string; description: string; file: Blob; filename: string; }, options?: Options) {
    const form = new FormData();
    form.append("name", sticker.name);
    form.append("tags", sticker.tags);
    form.append("description", sticker.description);
    form.append("file", sticker.file, sticker.filename);
    return request<{ id: string; }>("POST", `/guilds/${guildId}/stickers`, form, options);
}

export function removeAsset(asset: Pick<Asset, "kind" | "id" | "guildId">, options?: Options) {
    return request<void>("DELETE", `/guilds/${asset.guildId}/${asset.kind === "emoji" ? "emojis" : "stickers"}/${asset.id}`, undefined, options);
}
