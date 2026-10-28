/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, DraftType, UploadHandler } from "@webpack/common";

let passing = 0;
let passUntil = 0;

export function letThrough(count: number) {
    if (passing <= 0 || Date.now() > passUntil) return false;
    passing = Math.max(0, passing - count);
    return true;
}

export function addToTray(channelId: string, files: File[]) {
    passing = files.length;
    passUntil = Date.now() + 10_000;
    return UploadHandler.promptToUpload(files, ChannelStore.getChannel(channelId), DraftType.ChannelMessage);
}
