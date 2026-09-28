/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, createRoot, IconUtils, Popout, useEffect, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { plainText } from "./describe";
import { nameOf } from "./format";
import { emojiMarkup, EmojiSelectPayload, ReactionEmojiPicker } from "./picker";

const cl = classNameFactory("vc-channel-peek-");

const LAYERED = '[class*="layerContainer"], [class*="popout"], [class*="emojiPicker"], [class*="contentWrapper"]';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function close() {
    root?.render(null);
}

function Composer({ channel, anchor, message }: { channel: Channel; anchor: DOMRect; message: Message; }) {
    const [value, setValue] = useState("");
    const [sending, setSending] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const caret = useRef(0);

    useEffect(() => {
        input.current?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        const onDown = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (host?.contains(target)) return;
            if (target?.closest?.(LAYERED)) return;
            close();
        };

        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onDown);
        };
    }, []);

    const send = async () => {
        const content = value.trim();
        if (!content || sending) return;

        setSending(true);
        try {
            await sendMessage(channel.id, { content }, true, {
                messageReference: { guild_id: channel.guild_id, channel_id: channel.id, message_id: message.id }
            });
            close();
        } finally {
            setSending(false);
        }
    };

    const insert = (text: string) => {
        setValue(current => {
            const at = Math.min(caret.current, current.length);
            const next = current.slice(0, at) + text + current.slice(at);
            caret.current = at + text.length;

            requestAnimationFrame(() => {
                input.current?.focus();
                input.current?.setSelectionRange(caret.current, caret.current);
            });
            return next;
        });
    };

    const rememberCaret = () => {
        caret.current = input.current?.selectionStart ?? caret.current;
    };

    useEffect(() => {
        const box = input.current;
        if (!box) return;

        box.style.height = "auto";
        box.style.height = `${box.scrollHeight}px`;
    }, [value]);

    const top = Math.max(8, Math.min(anchor.top - 12, window.innerHeight - 130));

    return <div className={cl("reply")} style={{ left: anchor.right + 8, top }}>
        <div className={cl("reply-target")}>Replying in #{channel.name}</div>
        <div className={cl("reply-quote")}>
            <img className={cl("reply-quote-avatar")} src={IconUtils.getUserAvatarURL(message.author, false, 32)} alt="" />
            <span className={cl("reply-quote-name")}>{nameOf(message)}</span>
            <span className={cl("reply-quote-text")}>{plainText(message)}</span>
        </div>
        <div className={cl("reply-row")}>
            <textarea
                ref={input}
                className={cl("reply-input")}
                rows={1}
                value={value}
                disabled={sending}
                placeholder="Message"
                onChange={e => {
                    setValue(e.currentTarget.value);
                    caret.current = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
                }}
                onKeyUp={rememberCaret}
                onClick={rememberCaret}
                onKeyDown={e => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    e.preventDefault();
                    send();
                }}
            />
            <Popout
                position="bottom"
                align="right"
                targetElementRef={trigger}
                renderPopout={({ closePopout }: { closePopout: () => void; }) => (
                    <ReactionEmojiPicker
                        channel={channel}
                        closePopout={closePopout}
                        onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                            const markup = emojiMarkup(emoji);
                            if (markup) insert(markup);
                            if (willClose) closePopout();
                        }}
                    />
                )}
            >
                {(popoutProps: any) => (
                    <button
                        {...popoutProps}
                        ref={trigger}
                        className={cl("reply-emoji")}
                        aria-label="Pick an emoji"
                    >
                        <svg width={16} height={16} viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM12 18a5.5 5.5 0 0 0 5-3.2 1 1 0 0 0-1.8-.9A3.5 3.5 0 0 1 12 16a3.5 3.5 0 0 1-3.2-2.1 1 1 0 1 0-1.8.9A5.5 5.5 0 0 0 12 18Z" />
                        </svg>
                    </button>
                )}
            </Popout>
        </div>
    </div>;
}

export function openQuickReply(channel: Channel, anchor: DOMRect, message: Message) {
    if (!host) {
        host = document.createElement("div");
        host.className = cl("reply-host");
        document.body.append(host);
        root = createRoot(host);
    }

    root!.render(<Composer key={message.id} channel={ChannelStore.getChannel(channel.id) ?? channel} anchor={anchor} message={message} />);
}

export function destroyQuickReply() {
    root?.unmount();
    host?.remove();
    root = undefined;
    host = undefined;
}
