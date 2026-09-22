/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Channel } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

import { resolveEmoji, setOverride, tintFor } from "./emoji";
import { EmojiSelectPayload, emojiValue, ReactionEmojiPicker } from "./picker";
import { settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

export function openEmojiPicker(channel: Channel) {
    openModal(props => (
        <Modal {...props} size="md" title="Set Channel Emoji">
            <div className={cl("picker-notice")}>
                Icon changes locally. Only you will see this change.
            </div>
            <ReactionEmojiPicker
                channel={channel}
                closePopout={props.onClose}
                onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                    const value = emojiValue(emoji);
                    if (value) setOverride(channel.id, value);
                    if (willClose) props.onClose();
                }}
            />
        </Modal>
    ));
}

export const ChannelIcon = ErrorBoundary.wrap(function ChannelIcon({ channel, containerClassName }: { channel: Channel; containerClassName?: string; }) {
    settings.use(["iconOverrides", "iconFallback", "iconSize", "autoEmoji"]);

    const resolved = resolveEmoji(channel);
    if (!resolved) return null;
    const { emoji, custom } = resolved;

    return (
        <div
            className={classes(cl("icon"), cl("icon-" + settings.store.iconSize), containerClassName)}
            style={{ background: tintFor(emoji) }}
            role="button"
            aria-label="Set channel emoji"
            onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                openEmojiPicker(channel);
            }}
        >
            {custom?.id
                ? <img className={cl("icon-custom")} src={`https://cdn.discordapp.com/emojis/${custom.id}.webp?size=32`} alt={emoji} />
                : <span className={cl("glyph")}>{emoji}</span>}
        </div>
    );
}, { noop: true });
