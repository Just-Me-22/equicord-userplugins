/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { Parser } from "@webpack/common";

import { settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

const ONLY_LINK = /^<?(https?:\/\/\S+)>?$/;

function kindOf(attachment: MessageAttachment) {
    const type = attachment.content_type ?? "";
    if (type.startsWith("image/")) return attachment.filename.endsWith(".gif") || type === "image/gif" ? "a GIF" : "an image";
    if (type.startsWith("video/")) return "a video";
    if (type.startsWith("audio/")) return "audio";
    if (type === "application/pdf") return "a PDF";
    return null;
}

function thumbFor(attachment: MessageAttachment) {
    const url = new URL(attachment.proxy_url);
    url.searchParams.set("width", "32");
    url.searchParams.set("height", "32");
    return url.href;
}

function attachmentNode(attachment: MessageAttachment, channel: Channel) {
    const { attachmentDetail, thumbnails, blurNsfw } = settings.store;
    const isImage = attachment.content_type?.startsWith("image/");

    if (thumbnails && isImage) {
        const blur = attachment.spoiler || (blurNsfw && channel.nsfw);
        return <img
            className={cl("thumb", { "thumb-blurred": blur })}
            src={thumbFor(attachment)}
            alt={attachment.filename}
            loading="lazy"
        />;
    }

    if (!attachmentDetail) return isImage ? "sent an image" : "sent an attachment";

    const kind = kindOf(attachment);
    return kind ? `sent ${kind}` : `sent ${attachment.filename}`;
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
    key: string;
    node: React.ReactNode;
}

const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 600;

export function describe(message: Message, channel: Channel): React.ReactNode {
    const { attachmentDetail, thumbnails, linkStyle, blurNsfw } = settings.store;
    const key = `${message.editedTimestamp ?? ""}|${attachmentDetail}|${thumbnails}|${linkStyle}|${blurNsfw}`;

    const hit = cache.get(message.id);
    if (hit?.key === key) return hit.node;

    const node = bodyOf(message, channel);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(message.id, { key, node });
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
