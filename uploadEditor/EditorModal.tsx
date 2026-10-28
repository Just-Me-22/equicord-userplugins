/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { RenderModalProps } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { CloudUploader, DraftStore, DraftType, FluxDispatcher, MessageActions, Modal, PendingReplyStore, showToast, useEffect, useRef, useState } from "@webpack/common";

import { Album } from "./Album";
import { disposeItem, exportItem, Item } from "./image";
import { ImageEditor } from "./ImageEditor";
import { addToTray } from "./tray";
import { cl } from "./ui";

const logger = new Logger("UploadEditor");

export const PER_MESSAGE = 10;

const chunk = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / PER_MESSAGE) }, (_, i) => list.slice(i * PER_MESSAGE, (i + 1) * PER_MESSAGE));

async function sendFiles(channelId: string, files: File[], content: string) {
    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    for (const [i, group] of chunk(files).entries()) {
        const uploads = group.map(file => new CloudUploader({ file, platform: CloudUploadPlatform.WEB }, channelId));
        await sendMessage(channelId, { content: i === 0 ? content : "" }, true, {
            ...(reply && i === 0 ? MessageActions.getSendMessageOptionsForReply(reply) : {}),
            attachmentsToUpload: uploads
        });
    }
}

export function EditorModal({ modalProps, channelId, initial }: { modalProps: RenderModalProps; channelId: string; initial: Item[]; }) {
    const [items, setItems] = useState(initial);
    const [editing, setEditing] = useState<number | null>(initial.length > 1 ? null : 0);
    const [caption, setCaption] = useState("");
    const [sending, setSending] = useState(false);
    const [hasDraft] = useState(() => Boolean(DraftStore.getDraft(channelId, DraftType.ChannelMessage)?.trim()));

    const itemsRef = useRef(items);
    itemsRef.current = items;
    useEffect(() => () => itemsRef.current.forEach(disposeItem), []);

    const album = items.length > 1;
    const current = editing === null ? null : items[Math.min(editing, items.length - 1)];

    function updateItem(id: number, patch: Partial<Item>) {
        setItems(list => list.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    }

    function remove(target: Item) {
        if (items.length === 1) return modalProps.onClose();
        disposeItem(target);
        setItems(list => list.filter(entry => entry.id !== target.id));
        setEditing(items.length === 2 ? 0 : null);
    }

    async function finish(how: "send" | "attach") {
        if (sending) return;
        setSending(true);
        try {
            const files: File[] = [];
            for (const item of items) files.push(await exportItem(item));
            const text = caption.trim();

            if (how === "send") {
                modalProps.onClose();
                await sendFiles(channelId, files, text);
                return;
            } else {
                await addToTray(channelId, files);
                if (text) insertTextIntoChatInputBox((hasDraft ? " " : "") + text);
            }
            modalProps.onClose();
        } catch (err) {
            logger.error(`could not ${how}`, err);
            showToast(how === "send" ? "Could not send the pictures" : "Could not add the pictures", "failure");
            setSending(false);
        }
    }

    const messages = Math.ceil(items.length / PER_MESSAGE);
    const canAttach = messages === 1;
    const primary = hasDraft && canAttach ? "attach" : "send";

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={album ? `Send ${items.length} pictures` : "Send picture"}
            subtitle={messages > 1 ? `Goes out as ${messages} messages of up to ${PER_MESSAGE}` : undefined}
            actionBarInputLayout="chat-input"
            actionBarInput={
                <textarea
                    className={cl("caption")}
                    placeholder="Add a caption"
                    rows={1}
                    autoFocus
                    value={caption}
                    onChange={event => setCaption(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        void finish(primary);
                    }}
                />
            }
            actions={[
                { text: primary === "send" ? "Send" : "Add to message", variant: "primary", onClick: () => void finish(primary), loading: sending },
                ...(canAttach ? [{ text: primary === "send" ? "Add to message" : "Send now", variant: "secondary", disabled: sending, onClick: () => void finish(primary === "send" ? "attach" : "send") }] : []),
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose }
            ]}
        >
            <div className={cl("body")}>
                {current
                    ? (
                        <ImageEditor
                            key={current.id}
                            item={current}
                            onChange={patch => updateItem(current.id, patch)}
                            onBack={album ? () => setEditing(null) : undefined}
                            position={album ? `${items.indexOf(current) + 1} of ${items.length}` : undefined}
                        />
                    )
                    : <Album items={items} onOpen={setEditing} onRemove={remove} />}
            </div>
        </Modal>
    );
}
