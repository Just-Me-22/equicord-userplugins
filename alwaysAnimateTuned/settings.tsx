/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { Forms, Text } from "@webpack/common";

import { tallies } from "./sweeps";

function SweepReport() {
    const names = Object.keys(tallies);

    return <>
        <Forms.FormTitle tag="h5">Sweep results</Forms.FormTitle>
        {names.length === 0 && <Text variant="text-sm/normal">No sweep has run yet. Reload to populate this.</Text>}
        {names.map(name => {
            const t = tallies[name];
            return <Text variant="text-sm/normal" key={name}>
                {`${name}: ${t.rewritten} rewritten of ${t.seen}, skipped ${t.destructuring} destructuring, ${t.classMap} class map, ${t.literal} literal, ${t.alreadyOff} already off`}
            </Text>;
        })}
    </>;
}

export const settings = definePluginSettings({
    icons: {
        type: OptionType.BOOLEAN,
        description: "Always animate server icons, avatars, decor and more",
        default: true
    },
    statusEmojis: {
        type: OptionType.BOOLEAN,
        description: "Always animate status emojis",
        default: true
    },
    serverBanners: {
        type: OptionType.BOOLEAN,
        description: "Always animate server banners",
        default: true
    },
    nameplates: {
        type: OptionType.BOOLEAN,
        description: "Always animate nameplates",
        default: true
    },
    roleGradients: {
        type: OptionType.BOOLEAN,
        description: "Always animate role gradients",
        default: true
    },
    nameStyles: {
        type: OptionType.BOOLEAN,
        description: "Always play display name style effects (gradient, gummy, prism and the rest) instead of only while hovering",
        default: true,
        restartNeeded: true
    },
    respectReducedMotion: {
        type: OptionType.BOOLEAN,
        description: "Stop animating when the system asks for reduced motion. Discord checks this itself; forcing animation overrides it.",
        default: true
    },
    pauseWhenHidden: {
        type: OptionType.BOOLEAN,
        description: "Stop animating while the window is hidden, not only while it is unfocused.",
        default: true
    },
    pauseWhileScrolling: {
        type: OptionType.BOOLEAN,
        description: "Pause videos while a list is scrolling. This is when they cost most and show least.",
        default: true
    },
    scrollSpeed: {
        type: OptionType.NUMBER,
        description: "Only count a scroll faster than this many pixels per second. 0 counts any scroll.",
        default: 0
    },
    pauseWhileTyping: {
        type: OptionType.BOOLEAN,
        description: "Pause videos while you are typing in a text box.",
        default: true
    },
    pauseWhilePicking: {
        type: OptionType.BOOLEAN,
        description: "Pause nameplate videos while the emoji, GIF or sticker picker is open.",
        default: true
    },
    pauseOffscreen: {
        type: OptionType.BOOLEAN,
        description: "Only animate what is actually on screen.",
        default: true
    },
    idleAfter: {
        type: OptionType.NUMBER,
        description: "Stop animating after this many seconds without mouse or keyboard. 0 never idles.",
        default: 0
    },
    settleDelay: {
        type: OptionType.NUMBER,
        description: "Wait this many milliseconds before videos resume. Discord uses 1000 for its own hover gate.",
        default: 0
    },
    maxAnimated: {
        type: OptionType.NUMBER,
        description: "Most video surfaces playing at once, nearest the cursor winning. 0 means no limit.",
        default: 12
    },
    hoverOnly: {
        type: OptionType.BOOLEAN,
        description: "Only play the video surface under the cursor. Animated images are not affected.",
        default: false
    },
    fullRate: {
        type: OptionType.BOOLEAN,
        description: "Keep the full frame rate while two or more videos play, instead of Chromium slowing the whole window to their speed.",
        default: true
    },
    refreshStatic: {
        type: OptionType.BOOLEAN,
        description: "When the window is hidden, idle, or asked for reduced motion, redraw animated images as their still version. Costs one re-render each way, the same as switching windows.",
        default: true
    },
    sweepReport: {
        type: OptionType.COMPONENT,
        component: SweepReport
    }
});
