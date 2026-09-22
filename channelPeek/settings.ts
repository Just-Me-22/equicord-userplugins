/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export type OverrideMap = Record<string, string>;

export const hooks = { filterChanged: () => { } };

export const settings = definePluginSettings({
    showAuthor: {
        type: OptionType.BOOLEAN,
        description: "Prefix each preview with who sent it.",
        default: true
    },
    showAvatar: {
        type: OptionType.BOOLEAN,
        description: "Show the sender's avatar before their name.",
        default: false
    },
    roleColors: {
        type: OptionType.BOOLEAN,
        description: "Colour the sender's name with their top role colour.",
        default: true
    },
    colorScope: {
        type: OptionType.SELECT,
        description: "How much of the line the role colour covers.",
        options: [
            { label: "The whole line", value: "line", default: true },
            { label: "Just the name", value: "name" }
        ]
    },
    mutedChannels: {
        type: OptionType.SELECT,
        description: "What muted channels get.",
        options: [
            { label: "No preview", value: "hide", default: true },
            { label: "A dimmed preview", value: "dim" },
            { label: "A normal preview", value: "show" }
        ]
    },
    previewLines: {
        type: OptionType.SELECT,
        description: "How many lines a preview may use before it truncates.",
        options: [
            { label: "One", value: "1", default: true },
            { label: "Two", value: "2" }
        ]
    },
    fullTextTooltip: {
        type: OptionType.BOOLEAN,
        description: "Hovering a truncated preview shows the whole message.",
        default: false
    },
    attachmentDetail: {
        type: OptionType.BOOLEAN,
        description: "Name the kind of attachment instead of \"sent an attachment\", and use embed and sticker titles.",
        default: false
    },
    thumbnails: {
        type: OptionType.BOOLEAN,
        description: "Show a thumbnail of the image instead of the words \"sent an image\".",
        default: false
    },
    blurNsfw: {
        type: OptionType.BOOLEAN,
        description: "Blur thumbnails in age-restricted channels until you hover them.",
        default: true
    },
    linkStyle: {
        type: OptionType.SELECT,
        description: "How a message that is only a link reads.",
        options: [
            { label: "The raw URL", value: "raw", default: true },
            { label: "Just the site", value: "domain" }
        ]
    },
    replyContext: {
        type: OptionType.BOOLEAN,
        description: "Mark replies and say who is being replied to.",
        default: false
    },
    showAge: {
        type: OptionType.BOOLEAN,
        description: "Put the message's age at the end of the row.",
        default: false
    },
    staleAfter: {
        type: OptionType.NUMBER,
        description: "Fade previews older than this many hours. 0 leaves them alone.",
        default: 0
    },
    boldMentions: {
        type: OptionType.BOOLEAN,
        description: "Bold the preview when the message mentions you.",
        default: false
    },
    dimRead: {
        type: OptionType.BOOLEAN,
        description: "Dim channels you have already read.",
        default: false
    },
    unreadCount: {
        type: OptionType.BOOLEAN,
        description: "Show how many messages are unread.",
        default: false
    },
    keywords: {
        type: OptionType.STRING,
        description: "Highlight previews containing any of these words, separated by commas.",
        default: ""
    },
    typingIndicator: {
        type: OptionType.BOOLEAN,
        description: "Replace the preview while someone is typing in that channel.",
        default: false
    },
    voiceOccupants: {
        type: OptionType.BOOLEAN,
        description: "Show who is in a voice channel on its second line.",
        default: false
    },
    threads: {
        type: OptionType.BOOLEAN,
        description: "Preview threads as well as channels.",
        default: false
    },
    forums: {
        type: OptionType.BOOLEAN,
        description: "Preview forum channels with their newest post.",
        default: false
    },
    jumpToMessage: {
        type: OptionType.BOOLEAN,
        description: "Clicking the preview text opens the channel at that message instead of at the bottom.",
        default: false
    },
    markReadButton: {
        type: OptionType.BOOLEAN,
        description: "Hovering an unread channel offers a mark-as-read button.",
        default: false
    },
    quickReply: {
        type: OptionType.BOOLEAN,
        description: "Hovering a channel offers a reply box that opens beside the sidebar.",
        default: false
    },
    filterBar: {
        type: OptionType.BOOLEAN,
        description: "Put a search box and a hide-read toggle above the channel list.",
        default: false,
        onChange: () => hooks.filterChanged()
    },
    hideRead: {
        type: OptionType.BOOLEAN,
        description: "Hide channels with nothing unread.",
        default: false,
        onChange: () => hooks.filterChanged()
    },
    channelIcons: {
        type: OptionType.BOOLEAN,
        description: "Replace the # with the channel's emoji on a tinted circle.",
        default: true,
        restartNeeded: true
    },
    iconSize: {
        type: OptionType.SELECT,
        description: "How big the emoji circle is.",
        options: [
            { label: "Tiny - 20px circle, 14px emoji", value: "tiny", default: true },
            { label: "Small - 32px circle, 16px emoji", value: "small" },
            { label: "Medium - 42px circle, 20px emoji", value: "medium" }
        ]
    },
    autoEmoji: {
        type: OptionType.BOOLEAN,
        description: "Guess an emoji from the channel's name when it has none set.",
        default: false
    },
    iconFallback: {
        type: OptionType.STRING,
        description: "Emoji for channels that have none set and nothing guessed. Leave empty to keep the # on those.",
        default: "\u{1F310}"
    },
    iconOverrides: {
        type: OptionType.CUSTOM,
        description: "",
        default: {} as OverrideMap
    },
    mutedPreviews: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as string[]
    },
    mutedGuilds: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as string[]
    }
});
