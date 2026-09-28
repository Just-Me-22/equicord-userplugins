/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    messageCount: {
        type: OptionType.SLIDER,
        description: "How many recent messages the preview loads",
        markers: [1, 5, 10, 15, 20, 25, 30, 40, 50],
        default: 10,
        stickToMarkers: false
    },
    hoverDelay: {
        type: OptionType.SLIDER,
        description: "Longest wait before the preview opens while the mouse keeps moving (milliseconds)",
        markers: [0, 100, 250, 500, 750, 1000, 1500, 2000],
        default: 450,
        stickToMarkers: false
    },
    openOnSettle: {
        type: OptionType.BOOLEAN,
        description: "Open as soon as the mouse slows down on a channel",
        default: true
    },
    instantKey: {
        type: OptionType.SELECT,
        description: "The key held while hovering",
        options: [
            { label: "Shift", value: "shift", default: true },
            { label: "Ctrl", value: "ctrl" },
            { label: "Alt", value: "alt" },
            { label: "Off", value: "none" }
        ]
    },
    requireKey: {
        type: OptionType.BOOLEAN,
        description: "Only open while that key is held. Off means hovering alone opens it, and holding the key skips the delay",
        default: false
    },
    scrollbar: {
        type: OptionType.SELECT,
        description: "Scrollbar in the preview. Wide gives a bigger target if you have no scroll wheel",
        options: [
            { label: "Thin", value: "thin", default: true },
            { label: "Wide", value: "wide" }
        ]
    },
    maxHeight: {
        type: OptionType.SLIDER,
        description: "How tall the messages can grow before they scroll (pixels)",
        markers: [200, 300, 400, 500, 600, 700, 800, 900],
        default: 560,
        stickToMarkers: false
    },
    width: {
        type: OptionType.SLIDER,
        description: "Preview width (pixels)",
        markers: [300, 400, 500, 600, 700, 800],
        default: 560,
        stickToMarkers: false
    },
    messageGap: {
        type: OptionType.SLIDER,
        description: "Extra space between messages (pixels)",
        markers: [0, 4, 8, 12, 16, 24, 32, 40],
        default: 4,
        stickToMarkers: false
    },
    animation: {
        type: OptionType.SELECT,
        description: "How the preview appears",
        options: [
            { label: "Fade", value: "fade", default: true },
            { label: "Pop", value: "pop" },
            { label: "Slide", value: "slide" },
            { label: "None", value: "none" }
        ]
    },
    display: {
        type: OptionType.SELECT,
        description: "Display style",
        options: [
            { label: "Same as chat", value: "auto", default: true },
            { label: "Compact", value: "compact" },
            { label: "Cozy", value: "cozy" }
        ]
    },
    clickToJump: {
        type: OptionType.BOOLEAN,
        description: "Click a message in the preview to open the channel at it",
        default: true
    },
    composer: {
        type: OptionType.BOOLEAN,
        description: "Show a message box at the bottom of the preview",
        default: true
    },
    collapseMedia: {
        type: OptionType.BOOLEAN,
        description: "Shrink images and embeds to a short strip",
        default: false
    },
    onlyUnread: {
        type: OptionType.BOOLEAN,
        description: "When a channel has unread messages, show only those",
        default: false
    },
    inDms: {
        type: OptionType.BOOLEAN,
        description: "Preview direct messages and group chats",
        default: true
    },
    inChannels: {
        type: OptionType.BOOLEAN,
        description: "Preview server channels",
        default: true
    },
    inServers: {
        type: OptionType.BOOLEAN,
        description: "Hovering a server icon lists its unread channels",
        default: true
    }
});
