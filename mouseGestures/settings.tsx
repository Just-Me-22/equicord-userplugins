/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import type { Command } from "./actions";
import type { Shape } from "./shapes";
import type { StrokeOptions } from "./stroke";
import { StudioLauncher } from "./studio";

export const DEFAULT_BINDINGS: Record<string, string> = {
    "nav.back": "L",
    "nav.forward": "R",
    "nav.oldestUnread": "U",
    "nav.present": "D",
    "msg.replyOrEdit": "L",
    "msg.react": "R",
    "tab.next": "R",
    "tab.prev": "L",
    "tab.close": "D",
    "tab.reopen": "U",
    "server.prev": "U",
    "server.next": "D",
    "server.home": "L",
    "server.markRead": "3",
    "channel.prev": "U",
    "channel.next": "D",
    "channel.newTab": "R",
    "channel.markRead": "3",
    "person.dm": "R",
    "person.mention": "L",
    "person.profile": "U"
};

export const DEFAULTS_VERSION = 4;

export const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export const settings = definePluginSettings({
    studio: {
        type: OptionType.COMPONENT,
        component: () => <StudioLauncher />
    },
    bindings: {
        type: OptionType.CUSTOM,
        description: "",
        default: DEFAULT_BINDINGS
    },
    shapes: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as Shape[]
    },
    drawn: {
        type: OptionType.CUSTOM,
        description: "",
        default: {} as Record<string, [number, number][][]>
    },
    commands: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as Command[]
    },
    options: {
        type: OptionType.CUSTOM,
        description: "",
        default: {} as Record<string, Record<string, any>>
    },
    trailOpacity: {
        type: OptionType.CUSTOM,
        description: "",
        default: 100
    },
    trailGlow: {
        type: OptionType.CUSTOM,
        description: "",
        default: 0
    },
    trailCap: {
        type: OptionType.CUSTOM,
        description: "",
        default: "round"
    },
    trailTaper: {
        type: OptionType.CUSTOM,
        description: "",
        default: false
    },
    tailLength: {
        type: OptionType.CUSTOM,
        description: "",
        default: 48
    },
    fadeOut: {
        type: OptionType.CUSTOM,
        description: "",
        default: 300
    },
    matchColor: {
        type: OptionType.CUSTOM,
        description: "",
        default: ""
    },
    pillPos: {
        type: OptionType.CUSTOM,
        description: "",
        default: "cursor"
    },
    trailColor2: {
        type: OptionType.CUSTOM,
        description: "",
        default: "#c084fc"
    },
    defaultsVersion: {
        type: OptionType.CUSTOM,
        description: "",
        default: 1
    },
    diagonals: {
        type: OptionType.CUSTOM,
        description: "",
        default: true
    },
    stepSize: {
        type: OptionType.CUSTOM,
        description: "",
        default: 16
    },
    steady: {
        type: OptionType.CUSTOM,
        description: "",
        default: true
    },
    steadyAmount: {
        type: OptionType.CUSTOM,
        description: "",
        default: 60
    },
    startDistance: {
        type: OptionType.CUSTOM,
        description: "",
        default: 16
    },
    holdStart: {
        type: OptionType.CUSTOM,
        description: "",
        default: 300
    },
    holdToMove: {
        type: OptionType.CUSTOM,
        description: "",
        default: 600
    },
    readyRing: {
        type: OptionType.CUSTOM,
        description: "",
        default: true
    },
    cheatSheet: {
        type: OptionType.CUSTOM,
        description: "",
        default: true
    },
    hoverRun: {
        type: OptionType.CUSTOM,
        description: "",
        default: 800
    },
    cheatDelay: {
        type: OptionType.CUSTOM,
        description: "",
        default: 600
    },
    reactEmoji: {
        type: OptionType.CUSTOM,
        description: "",
        default: "💀"
    },
    trail: {
        type: OptionType.CUSTOM,
        description: "",
        default: true
    },
    trailColor: {
        type: OptionType.CUSTOM,
        description: "",
        default: ""
    },
    trailStyle: {
        type: OptionType.CUSTOM,
        description: "",
        default: "solid"
    },
    trailFade: {
        type: OptionType.CUSTOM,
        description: "",
        default: "full"
    },
    trailWidth: {
        type: OptionType.CUSTOM,
        description: "",
        default: 4
    },
    sound: {
        type: OptionType.CUSTOM,
        description: "",
        default: false
    },
    twoFingerSwipes: {
        type: OptionType.CUSTOM,
        description: "",
        default: false
    },
    swipeDistance: {
        type: OptionType.CUSTOM,
        description: "",
        default: 120
    }
});

export const strokeOptions = (): StrokeOptions => ({
    step: settings.store.stepSize,
    diagonals: settings.store.diagonals,
    steady: settings.store.steady ? settings.store.steadyAmount / 100 : 0
});
