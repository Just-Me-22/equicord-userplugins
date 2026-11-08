/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    savedThemes: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as [number, number][]
    },
    alwaysAnimateNames: {
        type: OptionType.BOOLEAN,
        description: "Keep display name effects moving everywhere, not only when you hover a name. Discord's reduced motion setting still stops them",
        default: true,
        restartNeeded: true
    },
    movingGradient: {
        type: OptionType.BOOLEAN,
        description: "Make Gradient display names scroll like Prism (only you see this)",
        default: true,
        restartNeeded: true
    },
    savedLooks: {
        type: OptionType.CUSTOM,
        description: "",
        default: [] as { name: string; fontId?: number; effectId: number; colors: number[]; }[]
    },
    gallerySize: {
        type: OptionType.CUSTOM,
        description: "",
        default: {} as Record<string, "s" | "m" | "l">
    }
});
