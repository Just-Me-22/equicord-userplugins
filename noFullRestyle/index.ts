/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoFullRestyle",
    description: "Stops three things that make Discord re-style the whole app: the screen reader announcer being moved to the start of the page when a modal opens, the focus class flipping on the page root when the window gains or loses focus, and the mouse/keyboard class flipping when you switch between typing and clicking. Loading spinners keep spinning while Discord is in the background, and keyboard focus outlines no longer show",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    patches: [
        {
            find: '.dataset.liveAnnouncer="true"',
            all: true,
            replacement: {
                match: /(this\.parentNode|document\.body)\.prepend\(this\.node\)/g,
                replace: "$1.append(this.node)"
            }
        },
        {
            find: '"app-focused":',
            replacement: [
                {
                    match: /"app-focused":\i/,
                    replace: '"app-focused":!0'
                },
                {
                    match: /"keyboard-mode":\i/,
                    replace: '"keyboard-mode":!1'
                },
                {
                    match: /"mouse-mode":\i/,
                    replace: '"mouse-mode":!0'
                }
            ]
        }
    ]
});
