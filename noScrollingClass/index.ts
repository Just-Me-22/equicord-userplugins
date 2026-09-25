/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoScrollingClass",
    description: "Stops Discord adding a class to lists while they scroll, which makes themes built on [class*=] selectors re-style the whole list at the start and end of every scroll",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    patches: [
        {
            find: ".current.dirty=2)",
            all: true,
            replacement: {
                match: /("stable"===\i\?\i\.\i:\i\.\i,\{(?:\[\i\]:[^,}]+,)*\[\i\.\i\]:)\i\}/,
                replace: "$1!1}"
            }
        }
    ]
});
