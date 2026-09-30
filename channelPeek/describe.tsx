/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { Constants, Parser, RestAPI, Tooltip, useEffect, useState } from "@webpack/common";

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

function thumbFor(proxyUrl: string, size: number) {
    const url = new URL(proxyUrl);
    url.searchParams.set("width", String(size));
    url.searchParams.set("height", String(size));
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

    return <Tooltip text={<img className={cl("thumb-large")} src={thumbFor(src, 240)} alt={attachment.filename} />}>
        {tip => <img
            {...tip}
            className={cl("thumb", { "thumb-blurred": blur })}
            src={thumbFor(src, 32)}
            alt={attachment.filename}
            loading="lazy"
        />}
    </Tooltip>;
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

const CODE = /^```([\w+-]*)\n?([\s\S]*?)(?:```|$)/;

function codeNode(content: string) {
    const code = content.match(CODE);
    if (!code) return null;
    const first = code[2].split("\n").find(line => line.trim()) ?? "";
    return <span className={cl("code")}>
        {code[1] && <span className={cl("code-lang")}>{code[1]}</span>}
        <code>{first}</code>
    </span>;
}

function linkTitle(message: Message, url: string) {
    const embed = message.embeds?.[0] as any;
    const title = embed?.rawTitle || embed?.title;
    const site = embed?.provider?.name || new URL(url).hostname.replace(/^www\./, "");
    return title ? `${site} · ${title}` : site;
}

function pollText(message: Message) {
    const poll = message.poll as any;
    const question = poll.question?.text;
    if (!settings.store.eventBadges) return question ? `Poll: ${question}` : "sent a poll";

    const counts: any[] = poll.results?.answer_counts ?? poll.results?.answerCounts ?? [];
    const votes = counts.reduce((sum, one) => sum + (one.count ?? 0), 0);
    return `Poll: ${question ?? "untitled"}${counts.length ? `, ${votes} vote${votes === 1 ? "" : "s"}` : ""}`;
}

function bodyOf(message: Message, channel: Channel): React.ReactNode {
    if (message.content) {
        if (settings.store.codePreview) {
            const code = codeNode(message.content);
            if (code) return code;
        }

        const link = settings.store.linkStyle !== "raw" && message.content.match(ONLY_LINK);
        if (link) {
            try {
                return settings.store.linkStyle === "title"
                    ? linkTitle(message, link[1])
                    : new URL(link[1]).hostname.replace(/^www\./, "");
            } catch {
                return Parser.parseInlineReply(message.content);
            }
        }
        return Parser.parseInlineReply(message.content);
    }

    if (message.poll) return pollText(message);

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
