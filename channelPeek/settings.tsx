/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { OptionType } from "@utils/types";
import { Forms } from "@webpack/common";

const cl = classNameFactory("vc-channel-peek-");

export type OverrideMap = Record<string, string>;

export const hooks = {
    filterChanged: () => { },
    categoriesChanged: () => { },
    autoCollapseChanged: () => { }
};

function heading(text: string) {
    return {
        type: OptionType.COMPONENT as const,
        component: () => <Forms.FormTitle tag="h5" className={cl("group")}>{text}</Forms.FormTitle>
    };
}

export const settings = definePluginSettings({
    headingLine: heading("What the line says"),
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
    attachmentDetail: {
        type: OptionType.BOOLEAN,
        description: "Name the kind of attachment, and use embed and sticker titles.",
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
        description: "Mark replies.",
        default: false
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

    headingWhere: heading("Which channels get one"),
    mutedChannels: {
        type: OptionType.SELECT,
        description: "What muted channels get.",
        options: [
            { label: "No preview", value: "hide", default: true },
            { label: "A dimmed preview", value: "dim" },
            { label: "A normal preview", value: "show" }
        ]
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
    voiceOccupants: {
        type: OptionType.BOOLEAN,
        description: "Show who is in a voice channel on its second line.",
        default: false
    },
    categorySummary: {
        type: OptionType.BOOLEAN,
        description: "A collapsed category shows the newest message from inside it.",
        default: false,
        onChange: () => hooks.categoriesChanged()
    },

    headingUrgency: heading("What is worth your attention"),
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

    heatmap: {
        type: OptionType.BOOLEAN,
        description: "Show a 24 hour activity bar. It fills in as messages arrive, it cannot look backwards.",
        default: false
    },

    headingActions: heading("What you can do from a row"),
    jumpToMessage: {
        type: OptionType.BOOLEAN,
        description: "Clicking the preview opens the channel at that message instead of at the bottom.",
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

    catchUpButton: {
        type: OptionType.BOOLEAN,
        description: "Add a Catch Up item to the server menu, listing everything unread.",
        default: false
    },
    autoCollapse: {
        type: OptionType.BOOLEAN,
        description: "Collapse categories with nothing unread, and expand them when something arrives.",
        default: false,
        onChange: () => hooks.autoCollapseChanged()
    },

    headingFinding: heading("Finding a channel"),
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

    headingIcons: heading("Channel icons"),
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
        description: "Emoji for channels with none set and nothing guessed. Empty keeps the #.",
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
