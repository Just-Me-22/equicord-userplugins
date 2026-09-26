/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import definePlugin from "@utils/types";

import { NAMEPLATE, on, startGate, stopGate } from "./gate";
import { startPace, stopPace } from "./pace";
import { usePickerSettled } from "./picker";
import { settings } from "./settings";
import { sweep } from "./sweeps";

export default definePlugin({
    name: "AlwaysAnimateTuned",
    description: "AlwaysAnimate, but it keeps Discord's window-focus gate, leaves deliberate static assets alone, and does not corrupt class-name maps. Disable the stock AlwaysAnimate when using this.",
    tags: ["Appearance"],
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    on,

    usePickerSettled,

    decorationAnimates(props: { vcAnimate?: boolean; }) {
        return on() && (props.vcAnimate ?? true);
    },

    start() {
        startGate();
        startPace();
    },

    stop() {
        stopGate();
        stopPace();
    },

    patches: [
        {
            find: 'parentComponent:"AvatarDecorationModal"',
            predicate: () => settings.store.icons,
            replacement: {
                match: /onlyAnimateOnHoverOrFocus:!(\i)\}/,
                replace: "onlyAnimateOnHoverOrFocus:!$1,vcAnimate:$self.usePickerSettled()||$1}"
            }
        },
        {
            find: "isAvatarDecorationAnimating:",
            predicate: () => settings.store.icons,
            replacement: {
                match: /(onlyAnimateOnHoverOrFocus:\i=!1\}=(\i),.{0,1500}?)canAnimate:\i,size:(\i)\}\),\[/,
                replace: '$1["canAnimate"]:$self.decorationAnimates($2),size:$3}),[$2.vcAnimate,'
            }
        },
        {
            find: "/media/v1/collectibles-shop/",
            replacement: {
                match: /\$\{(\i)\?`\$\{\1\}\/`:""\}\$\{(\i)\}`/,
                replace: '${$1?`${$1}/`:""}${$2}${$1&&"static"===$2?"?format=webp":""}`'
            }
        },
        {
            find: "canAnimate:",
            predicate: () => settings.store.icons,
            all: true,
            noWarn: true,
            replacement: {
                match: /canAnimate:(.+?)([,}].*?\))/g,
                replace: sweep("canAnimate")
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
            find: "animateGradient:",
            predicate: () => settings.store.roleGradients,
            all: true,
            noWarn: true,
            replacement: {
                match: /animateGradient:(.+?)([,}].*?\))/g,
                replace: sweep("animateGradient")
            }
        },
        {
            find: 'location:"Nameplate_Asset"',
            replacement: [
                {
                    match: /(location:"Nameplate_Asset"\}\).{0,200}?animate:(\i),loop:\i,preload:)(\i)/,
                    replace: '$1$2?$3:"none"'
                },
                {
                    match: /(location:"Nameplate_Asset"\}\).{0,300}?preload:.{0,40}?className:)(\i)(?=\}\))/,
                    replace: `$1$2+" ${NAMEPLATE}"`
                }
            ]
        },
    ]
});
