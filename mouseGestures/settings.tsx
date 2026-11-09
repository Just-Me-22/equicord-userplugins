/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { GestureEditor, TrailColorPicker } from "./GestureEditor";

export const DEFAULT_BINDINGS: Record<string, string> = {
    "msg.replyOrEdit": "L",
    "msg.react": "R",
    "nav.back": "L",
    "nav.forward": "R",
    "nav.oldestUnread": "U",
    "nav.present": "D",
    "tab.close": "DR"
};

export const settings = definePluginSettings({
    editor: {
        type: OptionType.COMPONENT,
        component: () => <GestureEditor />
    },
    bindings: {
        type: OptionType.CUSTOM,
        description: "",
        default: DEFAULT_BINDINGS
    },
    reactEmoji: {
        type: OptionType.STRING,
        description: "The emoji the react gesture adds, or takes away if it's already yours. For a server emoji use name:id",
        default: "💀"
    },
    trail: {
        type: OptionType.BOOLEAN,
        description: "Draw the gesture's trail and show which action it will run while you drag. The trail turns grey and dashed while the gesture matches nothing",
        default: true
    },
    trailColor: {
        type: OptionType.CUSTOM,
        description: "",
        default: ""
    },
    trailColorPicker: {
        type: OptionType.COMPONENT,
        component: () => <TrailColorPicker />
    },
    stepSize: {
        type: OptionType.SLIDER,
        description: "How far you drag before a direction counts, in pixels. Lower is more sensitive, higher forgives wobbly lines",
        markers: [15, 20, 25, 30, 40, 50],
        default: 25,
        stickToMarkers: false
    },
    twoFingerSwipes: {
        type: OptionType.BOOLEAN,
        description: "Two-finger swipes sideways on the touchpad run the → and ← gestures, sliding the message along like on the phone app",
        default: false
    },
    swipeDistance: {
        type: OptionType.SLIDER,
        description: "How far a two-finger swipe has to travel",
        markers: [60, 90, 120, 160, 200, 260],
        default: 120,
        stickToMarkers: false
    }
});
