/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { DraftType, FluxDispatcher, openModal } from "@webpack/common";

import { EditorModal } from "./EditorModal";
import { EDITABLE, loadItem } from "./image";
import { letThrough } from "./tray";

const logger = new Logger("UploadEditor");

const MAX_ATTACHMENTS = 10;

interface QueuedUpload {
    file?: File;
    isThumbnail?: boolean;
}

interface AddFilesAction {
    type: string;
    channelId: string;
    draftType: number;
    files: QueuedUpload[];
}

let shiftHeld = false;

const trackShift = (event: KeyboardEvent) => { shiftHeld = event.shiftKey; };
const releaseShift = () => { shiftHeld = false; };

const isEditable = (entry: QueuedUpload) => entry.file instanceof File && !entry.isThumbnail && EDITABLE.has(entry.file.type);

async function openEditor(channelId: string, files: File[]) {
    try {
        const items = await Promise.all(files.map(loadItem));
        openModal(props => <EditorModal modalProps={props} channelId={channelId} initial={items} />);
    } catch (err) {
        logger.error("could not open the editor", err);
    }
}

function intercept(action: AddFilesAction) {
    if (action.type !== "UPLOAD_ATTACHMENT_ADD_FILES" || shiftHeld) return false;
    if (action.draftType !== DraftType.ChannelMessage || !Array.isArray(action.files)) return false;

    const images = action.files.filter(isEditable);
    if (!images.length || images.length > MAX_ATTACHMENTS || letThrough(images.length)) return false;

    action.files = action.files.filter(entry => !isEditable(entry));
    setTimeout(() => openEditor(action.channelId, images.map(entry => entry.file!)));

    return action.files.length === 0;
}

export default definePlugin({
    name: "UploadEditor",
    description: "Opens pictures you upload in a preview where you can crop, draw and add a caption before sending.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Chat", "Media"],

    start() {
        FluxDispatcher.addInterceptor(intercept);
        window.addEventListener("keydown", trackShift, true);
        window.addEventListener("keyup", trackShift, true);
        window.addEventListener("blur", releaseShift);
    },

    stop() {
        const interceptors = FluxDispatcher._interceptors;
        const index = interceptors.indexOf(intercept);
        if (index > -1) interceptors.splice(index, 1);
        window.removeEventListener("keydown", trackShift, true);
        window.removeEventListener("keyup", trackShift, true);
        window.removeEventListener("blur", releaseShift);
    }
});
