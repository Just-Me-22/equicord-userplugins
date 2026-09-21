/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { WindowStore } from "@webpack/common";

const settings = definePluginSettings({
    icons: {
        type: OptionType.BOOLEAN,
        description: "Always animate server icons, avatars, decor and more",
        default: true,
    },
    statusEmojis: {
        type: OptionType.BOOLEAN,
        description: "Always animate status emojis",
        default: true,
    },
    serverBanners: {
        type: OptionType.BOOLEAN,
        description: "Always animate server banners",
        default: true,
    },
    nameplates: {
        type: OptionType.BOOLEAN,
        description: "Always animate nameplates",
        default: true,
    },
    roleGradients: {
        type: OptionType.BOOLEAN,
        description: "Always animate role gradients",
        default: true,
    },
    nameStyles: {
        type: OptionType.BOOLEAN,
        description: "Always play display name style effects (gradient, gummy, prism and the rest) instead of only while hovering",
        default: true,
        restartNeeded: true,
    }
});

export default definePlugin({
    name: "AlwaysAnimateTuned",
    description: "AlwaysAnimate, but it keeps Discord's window-focus gate, leaves deliberate static assets alone, and does not corrupt class-name maps. Disable the stock AlwaysAnimate when using this.",
    tags: ["Appearance"],
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    on: () => WindowStore.isFocused(),

    patches: [
        {
            find: "canAnimate:",
            predicate: () => settings.store.icons,
            all: true,
            noWarn: true,
            replacement: {
                match: /canAnimate:(.+?)([,}].*?\))/g,
                replace: (m, value, rest) => {
                    if (/}=.+/.test(rest)) return m;
                    if (value.startsWith("\"")) return m;
                    if (value === "!1") return m;
                    return `canAnimate:$self.on()${rest}`;
                }
            }
        },
        {
            find: "#{intl::GUILD_OWNER}),children:",
            predicate: () => settings.store.statusEmojis,
            replacement: {
                match: /(\.CUSTOM_STATUS.+?animateEmoji:)\i/,
                replace: "$1$self.on()"
            }
        },
        {
            find: "#{intl::DISCOVERABLE_GUILD_HEADER_PUBLIC_INFO}",
            predicate: () => settings.store.serverBanners,
            replacement: {
                match: /(guildBanner:\i,animate:)\i(?=}\):null)/,
                replace: "$1$self.on()"
            }
        },
        {
            find: "=!1,contentOnly:",
            predicate: () => settings.store.roleGradients,
            replacement: {
                match: /animate:\i/,
                replace: "animate:$self.on()"
            }
        },
        {
            find: '="left",className:',
            predicate: () => settings.store.roleGradients,
            replacement: {
                match: /,animateGradient:/,
                replace: ",animateGradient:$self.on(),_oldAnimateGradient:"
            }
        },
        {
            find: ".MINI_PREVIEW,[",
            predicate: () => settings.store.nameplates,
            replacement: {
                match: /animate:\i,loop:/,
                replace: "animate:$self.on(),loop:true,_loop:"
            },
        },
        {
            find: "effectDisplayType:",
            predicate: () => settings.store.nameStyles,
            all: true,
            noWarn: true,
            replacement: {
                match: /\?(\i\.\i)\.ANIMATED:\1\.STATIC/g,
                replace: "?$1.ANIMATED:($self.on()?$1.ANIMATED:$1.STATIC)"
            }
        },
        {
            // the DM list row, whose ternary is ANIMATED:PLAIN and whose loop is the
            // hover flag. boldFontOpacity:.9 is unique to it in the bundle
            find: "boldFontOpacity:.9",
            predicate: () => settings.store.nameStyles,
            replacement: [
                {
                    match: /\?(\i\.\i)\.ANIMATED:\1\.PLAIN(?=,loop:)/,
                    replace: "?$1.ANIMATED:($self.on()?$1.ANIMATED:$1.PLAIN)"
                },
                {
                    match: /,loop:\i(?=,boldFontOpacity:\.9)/,
                    replace: ",loop:$self.on()"
                }
            ]
        },
        {
            find: "animateGradient:",
            predicate: () => settings.store.roleGradients,
            all: true,
            noWarn: true,
            replacement: {
                match: /animateGradient:(.+?)([,}].*?\))/g,
                replace: (m, value, rest) => {
                    if (/}=.+/.test(rest)) return m;
                    if (value.startsWith("\"")) return m;
                    if (value === "!1") return m;
                    return `animateGradient:$self.on()${rest}`;
                }
            }
        },
    ]
});
