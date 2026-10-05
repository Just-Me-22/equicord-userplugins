/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import definePlugin from "@utils/types";
import { ChannelStore, Constants, PermissionsBits, PermissionStore, RestAPI, showToast, Toasts } from "@webpack/common";

const BIN_WIDTH = 28;
const ROW_ID = "channels___";

function onClick(event: MouseEvent) {
    const row = (event.target as Element | null)?.closest?.(`[data-list-item-id^="${ROW_ID}"]`);
    if (!row?.parentElement?.className.includes("typeThread_")) return;
    if (event.clientX < row.getBoundingClientRect().right - BIN_WIDTH) return;
    const channel = ChannelStore.getChannel(row.getAttribute("data-list-item-id")!.slice(ROW_ID.length));
    if (!channel) return;
    event.preventDefault();
    event.stopPropagation();
    if (!PermissionStore.can(PermissionsBits.MANAGE_THREADS, channel)) {
        showToast("You can't delete this thread", Toasts.Type.FAILURE);
        return;
    }
    RestAPI.del({ url: Constants.Endpoints.CHANNEL(channel.id) })
        .catch(() => showToast(`Couldn't delete ${channel.name}`, Toasts.Type.FAILURE));
}

export default definePlugin({
    name: "ThreadTrash",
    description: "Shows a bin on thread rows when you hover them. One click deletes the thread.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    start() {
        document.addEventListener("click", onClick, true);
    },
    stop() {
        document.removeEventListener("click", onClick, true);
    }
});
