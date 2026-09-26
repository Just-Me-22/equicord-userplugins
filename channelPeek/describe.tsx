/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { Constants, Parser, RestAPI, useEffect, useState } from "@webpack/common";

import { rowSettings, settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

const ONLY_LINK = /^<?(https?:\/\/\S+)>?$/;

const fresh = new Map<string, string>();
const asked = new Set<string>();
const waiting = new Map<string, Set<(url: string) => void>>();
const queued: string[] = [];

function isExpired(url: string) {
    return parseInt(new URL(url).searchParams.get("ex") ?? "", 16) * 1000 < Date.now();
}

function refreshQueued() {
    const urls = queued.splice(0, 50);
    if (queued.length) setTimeout(refreshQueued);

    RestAPI.post({ url: Constants.Endpoints.ATTACHMENTS_REFRESH_URLS, body: { attachment_urls: urls } })
        .then(({ body }: { body: { refreshed_urls: { original: string; refreshed: string; }[]; }; }) => {
            for (const { original, refreshed } of body.refreshed_urls) {
                if (!refreshed) continue;
                fresh.set(original, refreshed);
                waiting.get(original)?.forEach(notify => notify(refreshed));
            }
        })
        .catch(() => { });
}

function useLiveUrl(url: string) {
    const [live, setLive] = useState(() => isExpired(url) ? fresh.get(url) : url);

    useEffect(() => {
        if (live) return;

        let listeners = waiting.get(url);
        if (!listeners) waiting.set(url, listeners = new Set());
        listeners.add(setLive);

        if (!asked.has(url)) {
            asked.add(url);
            if (queued.push(url) === 1) setTimeout(refreshQueued);
        }

        return () => {
            listeners!.delete(setLive);
            if (!listeners!.size) waiting.delete(url);
        };
    }, [url, live]);

    return live;
}

function kindOf(attachment: MessageAttachment) {
    const type = attachment.content_type ?? "";
    if (type.startsWith("image/")) return attachment.filename.endsWith(".gif") || type === "image/gif" ? "a GIF" : "an image";
    if (type.startsWith("video/")) return "a video";
    if (type.startsWith("audio/")) return "audio";
    if (type === "application/pdf") return "a PDF";
    return null;
}

function thumbFor(proxyUrl: string) {
    const url = new URL(proxyUrl);
    url.searchParams.set("width", "32");
    url.searchParams.set("height", "32");
    return url.href;
}

function attachmentText(attachment: MessageAttachment) {
    if (!settings.store.attachmentDetail) return attachment.content_type?.startsWith("image/") ? "sent an image" : "sent an attachment";

    const kind = kindOf(attachment);
    return kind ? `sent ${kind}` : `sent ${attachment.filename}`;
}

function Thumb({ attachment, blur }: { attachment: MessageAttachment; blur: boolean; }) {
    const src = useLiveUrl(attachment.proxy_url);
    if (!src) return <>{attachmentText(attachment)}</>;

    return <img
        className={cl("thumb", { "thumb-blurred": blur })}
        src={thumbFor(src)}
        alt={attachment.filename}
        loading="lazy"
    />;
}

function attachmentNode(attachment: MessageAttachment, channel: Channel) {
    const { thumbnails, blurNsfw } = settings.store;

    if (thumbnails && attachment.content_type?.startsWith("image/"))
        return <Thumb attachment={attachment} blur={Boolean(attachment.spoiler || (blurNsfw && channel.nsfw))} />;

    return attachmentText(attachment);
}

function embedText(message: Message) {
    const embed = message.embeds![0] as any;
    if (!settings.store.attachmentDetail) return "sent an embed";

    return embed.rawTitle || embed.title || embed.provider?.name || "sent an embed";
}

function bodyOf(message: Message, channel: Channel): React.ReactNode {
    if (message.content) {
        const link = settings.store.linkStyle === "domain" && message.content.match(ONLY_LINK);
        if (link) {
            try {
                return new URL(link[1]).hostname.replace(/^www\./, "");
            } catch {
                return Parser.parseInlineReply(message.content);
            }
        }
        return Parser.parseInlineReply(message.content);
    }

    if (message.poll) return message.poll.question.text ? `Poll: ${message.poll.question.text}` : "sent a poll";

    const attachment = message.attachments?.[0];
    if (attachment) return attachmentNode(attachment, channel);

    const sticker = message.stickerItems?.[0];
    if (sticker) return settings.store.attachmentDetail && sticker.name ? `sent ${sticker.name}` : "sent a sticker";

    if (message.embeds?.length) return embedText(message);

    return null;
}

interface CacheEntry {
    edited: number;
    settings: ReturnType<typeof rowSettings>;
    node: React.ReactNode;
}

const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 600;

export function describe(message: Message, channel: Channel): React.ReactNode {
    const current = rowSettings();
    const edited = +(message.editedTimestamp ?? 0);

    const hit = cache.get(message.id);
    if (hit?.settings === current && hit.edited === edited) return hit.node;

    const node = bodyOf(message, channel);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(message.id, { edited, settings: current, node });
    return node;
}

export function plainText(message: Message) {
    if (message.content) return message.content;
    if (message.poll) return message.poll.question.text ?? "";

    const attachment = message.attachments?.[0];
    if (attachment) return attachment.filename;
    if (message.stickerItems?.length) return message.stickerItems[0].name ?? "";
    if (message.embeds?.length) return (message.embeds[0] as any).rawTitle ?? "";

    return "";
}
