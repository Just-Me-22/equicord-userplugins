/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { RenderModalProps } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { ChannelStore, CloudUploader, DraftStore, DraftType, FluxDispatcher, GuildStore, MessageActions, Modal, PendingReplyStore, showToast, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { Album } from "./Album";
import { disposeItem, Edits, Item, snapshot, stillItem } from "./image";
import { EditorProps, ImageEditor } from "./ImageEditor";
import { exportItem, grabFrame } from "./media/export";
import { addToTray } from "./tray";
import { cl } from "./ui";

const logger = new Logger("UploadEditor");

export const PER_MESSAGE = 10;
const MB = 1024 * 1024;

const chunk = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / PER_MESSAGE) }, (_, i) => list.slice(i * PER_MESSAGE, (i + 1) * PER_MESSAGE));

function uploadLimit(channelId: string) {
    const premium = (UserStore.getCurrentUser() as { premiumType?: number; } | undefined)?.premiumType ?? 0;
    const byUser = ({ 1: 50, 2: 500, 3: 50 } as Record<number, number>)[premium] ?? 10;
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    const tier = guildId ? (GuildStore.getGuild(guildId) as { premiumTier?: number; } | undefined)?.premiumTier ?? 0 : 0;
    const byGuild = ({ 2: 50, 3: 100 } as Record<number, number>)[tier] ?? 10;
    return Math.max(byUser, byGuild) * MB;
}

const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

async function sendFiles(channelId: string, files: { file: File; item: Item; }[], content: string) {
    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    for (const [i, group] of chunk(files).entries()) {
        const uploads = group.map(({ file, item }) => {
            const upload = new CloudUploader({ file, platform: CloudUploadPlatform.WEB }, channelId) as InstanceType<typeof CloudUploader> & { spoiler: boolean; description: string | null; };
            upload.spoiler = item.spoiler;
            upload.description = item.alt.trim() || null;
            return upload;
        });
        await sendMessage(channelId, { content: i === 0 ? content : "" }, true, {
            ...(reply && i === 0 ? MessageActions.getSendMessageOptionsForReply(reply) : {}),
            attachmentsToUpload: uploads
        });
    }
}

const sameEdits = (a: Edits, b: Edits) => (Object.keys(a) as (keyof Edits)[]).every(k => a[k] === b[k]);

interface Oversize { id: number; size: number; }

export function EditorModal({ modalProps, channelId, initial }: { modalProps: RenderModalProps; channelId: string; initial: Item[]; }) {
    const [items, setItems] = useState(initial);
    const [editing, setEditing] = useState<number | null>(initial.length > 1 ? null : 0);
    const [caption, setCaption] = useState("");
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const [oversize, setOversize] = useState<Oversize[]>([]);
    const [hasDraft] = useState(() => Boolean(DraftStore.getDraft(channelId, DraftType.ChannelMessage)?.trim()));
    const limit = useRef(uploadLimit(channelId)).current;
    const exported = useRef(new WeakMap<Item, File>());

    const itemsRef = useRef(items);
    itemsRef.current = items;
    useEffect(() => () => itemsRef.current.forEach(disposeItem), []);

    const album = items.length > 1;
    const current = editing === null ? null : items[Math.min(editing, items.length - 1)];

    function updateItem(id: number, patch: Partial<Item>, record = false) {
        setOversize(list => list.filter(o => o.id !== id));
        setItems(list => list.map(entry => {
            if (entry.id !== id) return entry;
            const before = snapshot(entry);
            const last = entry.history[entry.history.length - 1];
            const history = record && !(last && sameEdits(last, before)) ? [...entry.history.slice(-49), before] : entry.history;
            return { ...entry, ...patch, history };
        }));
    }

    function undo(id: number) {
        setItems(list => list.map(entry => {
            if (entry.id !== id || !entry.history.length) return entry;
            const previous = entry.history[entry.history.length - 1];
            return { ...entry, ...previous, history: entry.history.slice(0, -1) };
        }));
    }

    function remove(target: Item) {
        if (items.length === 1) return modalProps.onClose();
        disposeItem(target);
        setItems(list => list.filter(entry => entry.id !== target.id));
        setEditing(items.length === 2 ? 0 : null);
    }

    async function grab(item: Item, ms: number) {
        try {
            const blob = await grabFrame(item, ms);
            const still = await stillItem(blob, item.file.name.replace(/\.[^.]+$/, "") + "-frame.png");
            setItems(list => [...list, still]);
            showToast({ text: "Frame added as a picture", variant: "success" });
        } catch (err) {
            logger.error("could not grab the frame", err);
            showToast({ text: "Could not save that frame", variant: "critical" });
        }
    }

    async function exportAll(): Promise<{ file: File; item: Item; }[]> {
        const out: { file: File; item: Item; }[] = [];
        for (const [i, item] of items.entries()) {
            let file = exported.current.get(item);
            if (!file) {
                const label = items.length > 1 ? `${i + 1} of ${items.length}, ` : "";
                file = await exportItem(item, f => setProgress(`Preparing ${label}${Math.round(f * 100)}%`));
                exported.current.set(item, file);
            }
            out.push({ file, item });
        }
        setProgress(null);
        return out;
    }

    async function shrink() {
        setSending(true);
        try {
            const next = [...items];
            for (const big of oversize) {
                const index = next.findIndex(i => i.id === big.id);
                if (index < 0) continue;
                let item = next[index];
                let file: File | null = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const ratio = Math.sqrt(limit * 0.92 / (file?.size ?? big.size));
                    item = { ...item, compress: Math.max(0.15, item.compress * Math.min(0.9, ratio)) };
                    file = item.kind === "video"
                        ? await exportItem(item, f => setProgress(`Shrinking ${Math.round(f * 100)}%`), { bitrate: Math.max(200_000, limit * 8 * 0.85 / ((item.trim[1] - item.trim[0]) / item.speed / 1000) - 128_000) })
                        : await exportItem(item, f => setProgress(`Shrinking ${Math.round(f * 100)}%`));
                    if (file.size <= limit) break;
                }
                next[index] = item;
                if (file) exported.current.set(item, file);
            }
            setItems(next);
            const still = oversize.filter(o => (exported.current.get(next.find(i => i.id === o.id)!)?.size ?? Infinity) > limit);
            setOversize(still.map(o => ({ ...o, size: exported.current.get(next.find(i => i.id === o.id)!)!.size })));
            if (!still.length) showToast({ text: "Everything fits now", variant: "success" });
        } catch (err) {
            logger.error("could not shrink", err);
            showToast({ text: "Could not shrink the file", variant: "critical" });
        } finally {
            setProgress(null);
            setSending(false);
        }
    }

    async function finish(how: "send" | "attach", force = false) {
        if (sending) return;
        setSending(true);
        try {
            const files = await exportAll();
            const big = files.filter(f => f.file.size > limit).map(f => ({ id: f.item.id, size: f.file.size }));
            if (big.length && !force) {
                setOversize(big);
                setSending(false);
                return;
            }
            const text = caption.trim();
            if (how === "send") {
                modalProps.onClose();
                await sendFiles(channelId, files, text);
                return;
            }
            await addToTray(channelId, files.map(f => f.file));
            if (text) insertTextIntoChatInputBox((hasDraft ? " " : "") + text);
            modalProps.onClose();
        } catch (err) {
            logger.error(`could not ${how}`, err);
            setProgress(null);
            showToast({ text: how === "send" ? "Could not send" : "Could not add the files", variant: "critical" });
            setSending(false);
        }
    }

    const messages = Math.ceil(items.length / PER_MESSAGE);
    const canAttach = messages === 1;
    const primary = hasDraft && canAttach ? "attach" : "send";
    const kinds = new Set(items.map(i => i.kind));
    const noun = items.length > 1 ? `${items.length} files` : kinds.has("video") ? "video" : kinds.has("gif") ? "GIF" : "picture";

    const editorProps: EditorProps | null = current && {
        item: current,
        onChange: (patch, record) => updateItem(current.id, patch, record),
        onUndo: () => undo(current.id),
        onBack: album ? () => setEditing(null) : undefined,
        onGrab: current.kind !== "image" ? ms => void grab(current, ms) : undefined,
        position: album ? `${items.indexOf(current) + 1} of ${items.length}` : undefined
    };

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={`Send ${noun}`}
            subtitle={progress ?? (messages > 1 ? `Goes out as ${messages} messages of up to ${PER_MESSAGE}` : undefined)}
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
            <div
                className={cl("body")}
                onKeyDown={event => {
                    if (!current || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
                    if ((event.target as HTMLElement).matches("input, textarea")) return;
                    event.preventDefault();
                    undo(current.id);
                }}
            >
                {oversize.length > 0 && (
                    <div className={cl("warning")} role="alert">
                        <span>
                            {oversize.length === 1
                                ? `${items.find(i => i.id === oversize[0].id)?.file.name ?? "A file"} is ${mb(oversize[0].size)}. Your upload limit here is ${mb(limit)}.`
                                : `${oversize.length} files are over your ${mb(limit)} upload limit.`}
                        </span>
                        <button className={cl("pill")} disabled={sending} onClick={() => void shrink()}>Shrink to fit</button>
                        <button className={cl("pill", "pill-quiet")} disabled={sending} onClick={() => void finish(primary, true)}>Send anyway</button>
                    </div>
                )}
                {editorProps
                    ? <ImageEditor key={current!.id} {...editorProps} />
                    : <Album items={items} onOpen={setEditing} onRemove={remove} onChange={(id, patch) => updateItem(id, patch)} />}
            </div>
        </Modal>
    );
}
