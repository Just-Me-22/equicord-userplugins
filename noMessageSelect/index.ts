/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import { TextIcon } from "@components/Icons";
import definePlugin from "@utils/types";

import noSelect from "./noSelect.css?managed";

const ATTR = "data-vc-selectable";

const rowOf = (channelId: string, messageId: string) => document.getElementById(`chat-messages-${channelId}-${messageId}`);

function clearSelectable() {
    for (const el of document.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR);
}

function makeSelectable(row: HTMLElement) {
    clearSelectable();
    row.setAttribute(ATTR, "");
    const content = row.querySelector('[id^="message-content-"]');
    if (!content?.textContent?.trim()) return;
    const range = document.createRange();
    range.selectNodeContents(content);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

export default definePlugin({
    name: "NoMessageSelect",
    description: "Stops message text from being selected when you drag or double-click over messages, so drags can draw gestures. The Select text button in a message's hover bar turns selection back on for that one message",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    dependencies: ["MessagePopoverAPI"],

    messagePopoverButton: {
        icon: TextIcon,
        render(msg) {
            const on = rowOf(msg.channel_id, msg.id)?.hasAttribute(ATTR);
            return {
                label: on ? "Stop selecting text" : "Select text",
                icon: TextIcon,
                onClick: () => {
                    const row = rowOf(msg.channel_id, msg.id);
                    if (!row) return;
                    if (!row.hasAttribute(ATTR)) return makeSelectable(row);
                    row.removeAttribute(ATTR);
                    getSelection()?.removeAllRanges();
                }
            };
        }
    },

    start() {
        enableStyle(noSelect);
    },

    stop() {
        disableStyle(noSelect);
        clearSelectable();
    }
});
