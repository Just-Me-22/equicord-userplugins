/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    ActiveJoinedThreadsStore, FluxDispatcher, Menu, MessageStore, UserGuildSettingsStore, VoiceStateStore
} from "@webpack/common";

import { loadActivity, stopActivity } from "./activity";
import { openBulkEmoji } from "./BulkEmoji";
import { openCatchUp } from "./CatchUp";
import { hasSummary, refreshCategories, startCategories, stopCategories } from "./category";
import { ChannelIcon, openEmojiPicker } from "./ChannelIcon";
import { describe } from "./describe";
import { getOverrides, migrateOverrides, resolveEmoji, setOverride } from "./emoji";
import { refresh as refreshFilter, startFilter, stopFilter } from "./filter";
import { attachFilterBar, stopFilterBar } from "./FilterBar";
import { startKeywordHighlight, stopKeywordHighlight } from "./format";
import { lastMessageOf, startGateway, stopGateway } from "./gateway";
import Preview from "./Preview";
import { destroyQuickReply } from "./QuickReply";
import { forgetRowSettings, hooks, rowSettings, settings } from "./settings";
import { refreshAutoCollapse, stopAutoCollapse } from "./sidebar";
import { stopTicker } from "./ticker";

const logger = new Logger("ChannelPeek");

const LINE = 16;

const TEXTUAL = [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT];
const VOICE = [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE];

function listed(list: string[], id: string) {
    return list.includes(id);
}

function toggleInList(key: "mutedPreviews" | "mutedGuilds", id: string) {
    const current = settings.store[key] as string[];
    settings.store[key] = listed(current, id)
        ? current.filter(entry => entry !== id)
        : [...current, id];
}

function threadsOf(record: unknown) {
    return Object.values((record ?? {}) as Record<string, any>)
        .map(entry => entry?.channel ?? entry)
        .filter((post): post is Channel => Boolean(post?.id));
}

function newestForumPost(channel: Channel) {
    const { guild_id: guildId, id } = channel;
    const posts = [
        ...threadsOf(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, id)),
        ...threadsOf(ActiveJoinedThreadsStore.getActiveUnjoinedThreadsForParent(guildId, id))
    ];

    if (!posts.length) return undefined;

    return posts.reduce((newest, post) =>
        (post.lastMessageId ?? "") > (newest.lastMessageId ?? "") ? post : newest);
}

function previewable(channel: Channel) {
    const { threads, forums, voiceOccupants } = rowSettings();
    if (threads && channel.isThread?.()) return true;
    if (forums && channel.type === ChannelType.GUILD_FORUM) return true;
    if (voiceOccupants && VOICE.includes(channel.type)) return true;
    return TEXTUAL.includes(channel.type);
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || !previewable(channel)) return;

    const off = listed(settings.store.mutedPreviews as string[], channel.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-channel-peek-pick"
                label="Set Channel Emoji"
                action={() => openEmojiPicker(channel)}
            />
            {getOverrides()[channel.id] && (
                <Menu.MenuItem
                    id="vc-channel-peek-reset"
                    label="Reset Channel Emoji"
                    color="danger"
                    action={() => setOverride(channel.id, null)}
                />
            )}
            <Menu.MenuItem
                id="vc-channel-peek-toggle"
                label={off ? "Show Preview Here" : "Hide Preview Here"}
                action={() => toggleInList("mutedPreviews", channel.id)}
            />
        </Menu.MenuGroup>
    );
};

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild: { id: string; } | undefined; }) => {
    if (!guild) return;

    const off = listed(settings.store.mutedGuilds as string[], guild.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-channel-peek-guild"
                label={off ? "Show Channel Previews" : "Hide Channel Previews"}
                action={() => toggleInList("mutedGuilds", guild.id)}
            />
            <Menu.MenuItem
                id="vc-channel-peek-bulk"
                label="Channel Emoji…"
                action={openBulkEmoji}
            />
            {settings.store.catchUpButton && (
                <Menu.MenuItem
                    id="vc-channel-peek-catchup"
                    label="Catch Up…"
                    action={openCatchUp}
                />
            )}
        </Menu.MenuGroup>
    );
};

function previewTarget(channel: Channel) {
    if (!channel || !previewable(channel)) return undefined;

    const { mutedPreviews, mutedGuilds, mutedChannels } = rowSettings();
    if (mutedPreviews.has(channel.id)) return undefined;
    if (channel.guild_id && mutedGuilds.has(channel.guild_id)) return undefined;

    if (mutedChannels === "hide" && UserGuildSettingsStore.isChannelMuted(channel.guild_id, channel.id)) return undefined;

    if (channel.type === ChannelType.GUILD_FORUM) return newestForumPost(channel);

    if (VOICE.includes(channel.type)) return channel;

    if (!channel.lastMessageId && !MessageStore.getLastMessage(channel.id)) return undefined;

    return channel;
}

function subtitleFor(channel: Channel) {
    const target = previewTarget(channel);
    return target && <Preview channel={target} />;
}

function previewLines(channel: Channel) {
    const target = previewTarget(channel);
    if (!target) return 0;

    if (VOICE.includes(channel.type)) {
        return Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {}).length ? 1 : 0;
    }

    const message = lastMessageOf(target);
    if (!message || !describe(message, target)) return 0;

    return rowSettings().previewLines === "2" ? 2 : 1;
}

function onChannelSelect() {
    attachFilterBar();
    refreshFilter();
    refreshCategories();
    refreshAutoCollapse();
}

function syncFilter() {
    if (settings.store.filterBar) attachFilterBar();
    else stopFilterBar();

    if (settings.store.filterBar || settings.store.hideRead) startFilter();
    else stopFilter();

    refreshFilter();
}

export default definePlugin({
    name: "ChannelPeek",
    description: "Shows the most recent message under each server channel, the way MessagePeek does for DMs.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Appearance", "Chat"],
    settings,

    contextMenus: {
        "channel-context": channelContext,
        "guild-context": guildContext
    },

    patches: [
        {
            find: "UNREAD_IMPORTANT:",
            replacement: {
                match: /(?<=,subtitle:)(\i)(?=,subtitleColor:)/,
                replace: "$1=$self.getSubtitle(arguments[0])"
            }
        },
        {
            find: "voiceChannelsSectionNumber){let",
            replacement: [
                {
                    match: /if\(\(null!=(\i)\.subtitle\|\|(\i)===\1\.id\)&&\((\i)\+=16\)/,
                    replace: "if($3+=$self.subtitleHeight($1,$2===$1.id)"
                },
                {
                    match: /(getSectionHeight=(\i)=>\{let\{guild:\i,guildChannels:(\i),density:(\i)\}=this\.props.+?)return"compact"===\4\?32:40\}/,
                    replace: '$1return("compact"===$4?32:40)+$self.summaryHeight($3.getCategoryFromSection($2))}'
                }
            ]
        },
        {
            find: "UNREAD_IMPORTANT:",
            predicate: () => settings.store.channelIcons,
            replacement: {
                match: /(\.memo\(function\((\i)\)\{)(?=let\{className:\i,containerClassName:\i,channel:)/,
                replace: "$1const vcIcon=$self.renderChannelIcon($2);if(vcIcon!=null)return vcIcon;"
            }
        }
    ],

    start() {
        SettingsStore.addPrefixChangeListener("plugins.ChannelPeek", forgetRowSettings);
        migrateOverrides();
        startGateway();
        hooks.filterChanged = syncFilter;
        hooks.categoriesChanged = refreshCategories;
        hooks.autoCollapseChanged = refreshAutoCollapse;
        loadActivity();
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        syncFilter();
        startCategories();
        startKeywordHighlight();
    },

    stop() {
        SettingsStore.removePrefixChangeListener("plugins.ChannelPeek", forgetRowSettings);
        forgetRowSettings();
        stopGateway();
        hooks.filterChanged = () => { };
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        hooks.categoriesChanged = () => { };
        hooks.autoCollapseChanged = () => { };
        stopAutoCollapse();
        stopActivity();
        stopFilter();
        stopFilterBar();
        stopCategories();
        stopTicker();
        destroyQuickReply();
        stopKeywordHighlight();
    },

    subtitleHeight(entry: { subtitle?: unknown; record: Channel; }, selectedVoice: boolean) {
        if (entry.subtitle != null || selectedVoice) return LINE;
        try {
            return previewLines(entry.record) * LINE;
        } catch (err) {
            logger.error("preview height failed", err);
            return 0;
        }
    },

    summaryHeight(category: { id?: string; isCollapsed?: boolean; } | undefined) {
        if (!category?.id || !category.isCollapsed) return 0;
        try {
            return hasSummary(category.id) ? LINE : 0;
        } catch (err) {
            logger.error("summary height failed", err);
            return 0;
        }
    },

    getSubtitle(props: { channel: Channel; }) {
        try {
            return subtitleFor(props.channel);
        } catch (err) {
            logger.error("subtitle failed", err);
            return undefined;
        }
    },

    renderChannelIcon(props: { channel: Channel; containerClassName?: string; }) {
        const { channel } = props;
        if (!channel || !TEXTUAL.includes(channel.type)) return null;

        try {
            if (!resolveEmoji(channel)) return null;
        } catch (err) {
            logger.error("emoji lookup failed", err);
            return null;
        }

        return <ChannelIcon channel={channel} containerClassName={props.containerClassName} />;
    }
});
