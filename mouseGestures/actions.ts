/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { closeTabAnimated, createTab, isTabSelected, jumpToUnreadTab, moveToTab, openedTabs, reopenClosedTab } from "@equicordplugins/channelTabs/util";
import NoReplyMentionPlugin from "@plugins/noReplyMention";
import { copyWithToast, insertTextIntoChatInputBox } from "@utils/discord";
import type { Channel, Message } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { ActiveJoinedThreadsStore, Alerts, ChannelStore, ComponentDispatch, Constants, EditMessageStore, FluxDispatcher, GuildChannelStore, MessageActions, MessageStore, MessageTypeSets, NavigationRouter, PermissionsBits, PermissionStore, PinActions, ReadStateStore, RestAPI, SelectedChannelStore, SelectedGuildStore, SettingsRouter, showToast, UserStore } from "@webpack/common";

import { settings } from "./settings";

export interface Hit {
    element: Element;
    message: Message;
    channel: Channel;
}

export type Group = "Messages" | "Getting around" | "Channel tabs" | "Layout";

export interface Action {
    id: string;
    label: string;
    group: Group;
    run(hit: Hit | null): void;
}

export const GROUPS: Group[] = ["Messages", "Getting around", "Channel tabs", "Layout"];

export const MESSAGE_SELECTOR = '[id^="chat-messages-"]';

export function messageAt(el: Element | null): Hit | null {
    const element = el?.closest(MESSAGE_SELECTOR);
    const ids = element?.id.match(/^chat-messages-(\d+)-(\d+)$/);
    if (!element || !ids) return null;
    const message = MessageStore.getMessage(ids[1], ids[2]);
    const channel = ChannelStore.getChannel(ids[1]);
    return message && channel ? { element, message, channel } : null;
}

const warn = (text: string) => showToast({ text, variant: "critical" });
const isMine = (m: Message) => m.author.id === UserStore.getCurrentUser()?.id;
const can = (perm: bigint, ch: Channel) => !ch.guild_id || PermissionStore.can(perm, ch);
const canReply = (m: Message) => MessageTypeSets.REPLYABLE.has(m.type) && !m.hasFlag(MessageFlags.EPHEMERAL);

function reply({ message, channel }: Hit, mention = true) {
    if (!canReply(message) || !can(PermissionsBits.SEND_MESSAGES, channel)) return warn("You can't reply to this message");
    const shouldMention = mention && (isPluginEnabled(NoReplyMentionPlugin.name) ? NoReplyMentionPlugin.shouldMention(message, false) : true);
    FluxDispatcher.dispatch({ type: "CREATE_PENDING_REPLY", channel, message, shouldMention, showMentionToggle: channel.guild_id != null });
}

function edit({ message, channel }: Hit) {
    if (!isMine(message)) return warn("You can only edit your own messages");
    if (message.state !== "SENT" || EditMessageStore.isEditing(channel.id, message.id)) return;
    MessageActions.startEditMessage(channel.id, message.id, message.content);
}

function emojiParam(raw: string) {
    const text = raw.trim();
    const custom = text.match(/^(?:<(?:a:)?|:)?([\w-]+?)(?:~\d+)?:(\d+)>?$/);
    return custom ? `${custom[1]}:${custom[2]}` : text;
}

async function react({ message, channel }: Hit) {
    const emoji = emojiParam(settings.store.reactEmoji);
    if (!emoji) return;
    if (!can(PermissionsBits.ADD_REACTIONS, channel)) return warn("You can't react here");
    const mine = message.reactions?.some(r => r.me && (r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name) === emoji);
    const url = Constants.Endpoints.REACTION(channel.id, message.id, emoji, "@me");
    await (mine ? RestAPI.del({ url }) : RestAPI.put({ url })).catch(() => warn("That reaction didn't go through"));
}

function remove({ message, channel }: Hit) {
    if (!isMine(message) && !PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel)) return warn("You can't delete this message");
    Alerts.show({
        title: "Delete this message?",
        body: message.content.length > 140 ? message.content.slice(0, 140) + "…" : message.content || "This message has no text.",
        confirmText: "Delete",
        cancelText: "Keep it",
        onConfirm: () => MessageActions.deleteMessage(channel.id, message.id)
    });
}

function pin({ message, channel }: Hit) {
    if (!can(PermissionsBits.MANAGE_MESSAGES, channel)) return warn("You can't pin messages here");
    if (message.pinned) PinActions.unpinMessage(channel, message.id);
    else PinActions.pinMessage(channel, message.id);
}

function quote(hit: Hit) {
    if (!hit.message.content) return;
    insertTextIntoChatInputBox(hit.message.content.split("\n").map(line => `> ${line}`).join("\n") + "\n");
    reply(hit, false);
}

function markUnread({ element }: Hit) {
    const target = element.querySelector('[role="article"]') ?? element.firstElementChild ?? element;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, detail: 1, altKey: true }));
}

function ack(channelIds: string[]) {
    const channels = channelIds
        .filter(id => ReadStateStore.hasUnread(id))
        .map(channelId => ({ channelId, messageId: ReadStateStore.lastMessageId(channelId), readStateType: 0 }));
    if (channels.length) FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
}

function markServerRead() {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return warn("Open a server first");
    const { SELECTABLE, VOCAL } = GuildChannelStore.getChannels(guildId);
    const threads = Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId)).flatMap(t => Object.values(t));
    ack([...SELECTABLE, ...VOCAL, ...threads].map((c: any) => c.channel.id));
}

function oldestUnread() {
    const channelId = SelectedChannelStore.getChannelId();
    const messageId = channelId && ReadStateStore.ackMessageId(channelId);
    if (!channelId || !messageId || ReadStateStore.getOldestUnreadTimestamp(channelId) <= 0) return warn("Nothing unread here");
    MessageActions.jumpToMessage({ channelId, messageId, offset: 1, context: "Keyboard Shortcut" });
}

function cycleTab(by: 1 | -1) {
    const i = openedTabs.findIndex(t => isTabSelected(t.id));
    if (i !== -1 && openedTabs.length > 1) moveToTab(openedTabs[(i + by + openedTabs.length) % openedTabs.length].id);
}

function tabs(run: () => void) {
    return () => isPluginEnabled("ChannelTabs") ? run() : warn("Turn on ChannelTabs for tab gestures");
}

function needsMessage(run: (hit: Hit) => void) {
    return (hit: Hit | null) => hit ? run(hit) : warn("Start this gesture on a message");
}

export const ACTIONS: Action[] = [
    { id: "msg.replyOrEdit", group: "Messages", label: "Reply, or edit if it's yours", run: needsMessage(hit => isMine(hit.message) ? edit(hit) : reply(hit)) },
    { id: "msg.reply", group: "Messages", label: "Reply", run: needsMessage(hit => reply(hit)) },
    { id: "msg.edit", group: "Messages", label: "Edit", run: needsMessage(edit) },
    { id: "msg.react", group: "Messages", label: "React with your emoji", run: needsMessage(react) },
    { id: "msg.quote", group: "Messages", label: "Quote", run: needsMessage(quote) },
    { id: "msg.copyText", group: "Messages", label: "Copy text", run: needsMessage(({ message }) => copyWithToast(message.content, "Message text copied")) },
    { id: "msg.copyLink", group: "Messages", label: "Copy link", run: needsMessage(({ message, channel }) => copyWithToast(`${location.origin}/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`, "Message link copied")) },
    { id: "msg.pin", group: "Messages", label: "Pin or unpin", run: needsMessage(pin) },
    { id: "msg.markUnread", group: "Messages", label: "Mark unread from here", run: needsMessage(markUnread) },
    { id: "msg.thread", group: "Messages", label: "Start a thread", run: needsMessage(({ message, channel }) => FluxDispatcher.dispatch({ type: "OPEN_THREAD_FLOW_MODAL", channelId: channel.id, messageId: message.id })) },
    { id: "msg.delete", group: "Messages", label: "Delete (asks first)", run: needsMessage(remove) },

    { id: "nav.back", group: "Getting around", label: "Back", run: () => NavigationRouter.back() },
    { id: "nav.forward", group: "Getting around", label: "Forward", run: () => NavigationRouter.forward() },
    { id: "nav.oldestUnread", group: "Getting around", label: "Jump to oldest unread", run: oldestUnread },
    { id: "nav.present", group: "Getting around", label: "Jump to newest messages", run: () => ComponentDispatch.dispatch("SCROLLTO_PRESENT") },
    { id: "nav.pageUp", group: "Getting around", label: "Scroll up a page", run: () => ComponentDispatch.dispatchToLastSubscribed("SCROLL_PAGE_UP") },
    { id: "nav.pageDown", group: "Getting around", label: "Scroll down a page", run: () => ComponentDispatch.dispatchToLastSubscribed("SCROLL_PAGE_DOWN") },
    { id: "nav.switcher", group: "Getting around", label: "Quick switcher", run: () => FluxDispatcher.dispatch({ type: "QUICKSWITCHER_SHOW", query: "", queryMode: null }) },
    { id: "nav.markChannelRead", group: "Getting around", label: "Mark channel read", run: () => ack([SelectedChannelStore.getChannelId()].filter(Boolean)) },
    { id: "nav.markServerRead", group: "Getting around", label: "Mark server read", run: markServerRead },

    { id: "tab.new", group: "Channel tabs", label: "New tab", run: tabs(() => createTab({ guildId: SelectedGuildStore.getGuildId() ?? "@me", channelId: SelectedChannelStore.getChannelId() } as any, true)) },
    { id: "tab.close", group: "Channel tabs", label: "Close tab", run: tabs(() => { const t = openedTabs.find(t => isTabSelected(t.id)); if (t && openedTabs.length > 1) closeTabAnimated(t.id); }) },
    { id: "tab.next", group: "Channel tabs", label: "Next tab", run: tabs(() => cycleTab(1)) },
    { id: "tab.prev", group: "Channel tabs", label: "Previous tab", run: tabs(() => cycleTab(-1)) },
    { id: "tab.reopen", group: "Channel tabs", label: "Reopen closed tab", run: tabs(reopenClosedTab) },
    { id: "tab.unread", group: "Channel tabs", label: "Go to a tab with unreads", run: tabs(jumpToUnreadTab) },

    { id: "layout.members", group: "Layout", label: "Show or hide members", run: () => FluxDispatcher.dispatch({ type: "CHANNEL_TOGGLE_MEMBERS_SECTION" }) },
    { id: "layout.search", group: "Layout", label: "Search this channel", run: () => ComponentDispatch.dispatch("FOCUS_SEARCH", { prefillCurrentChannel: true }) },
    { id: "layout.pins", group: "Layout", label: "Pinned messages", run: () => ComponentDispatch.dispatch("TOGGLE_CHANNEL_PINS") },
    { id: "layout.settings", group: "Layout", label: "Open settings", run: () => SettingsRouter.openUserSettings("my_account_panel") },
    { id: "layout.profile", group: "Layout", label: "Edit profile", run: () => SettingsRouter.openUserSettings("profiles_panel") }
];

export const onMessages = (a: Action) => a.group === "Messages";

export function resolve(gesture: string, hit: Hit | null) {
    const { bindings } = settings.store;
    const bound = ACTIONS.filter(a => bindings[a.id] === gesture);
    return (hit && bound.find(onMessages)) || bound.find(a => !onMessages(a));
}
