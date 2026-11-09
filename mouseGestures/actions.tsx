/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessagePopoverButtonMap } from "@api/MessagePopover";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { getUserSettingLazy } from "@api/UserSettings";
import { closeOtherTabs, closeTabAnimated, createTab, isTabSelected, jumpToUnreadTab, moveToTab, openedTabs, reopenClosedTab, toggleCompactTab, togglePin } from "@equicordplugins/channelTabs/util";
import NoReplyMentionPlugin from "@plugins/noReplyMention";
import { copyWithToast, insertTextIntoChatInputBox, openPrivateChannel, openUserProfile, sendMessage } from "@utils/discord";
import type { Channel, Message } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { cache, findByCodeLazy, findByPropsLazy, findStoreLazy } from "@webpack";
import { ActiveJoinedThreadsStore, Alerts, ChannelStore, ComponentDispatch, Constants, EditMessageStore, FluxDispatcher, GuildChannelStore, MediaEngineStore, MessageActions, MessageStore, MessageTypeSets, Modal, NavigationRouter, openModal, PermissionsBits, PermissionStore, PinActions, ReadStateStore, RestAPI, SelectedChannelStore, SelectedGuildStore, SettingsRouter, showToast, SortedGuildStore, UserGuildSettingsStore, UserStore, useState,VoiceActions } from "@webpack/common";

import { pointer, showCheat } from "./cheat";
import { openRadial } from "./radial";
import { settings } from "./settings";
import { openStudio } from "./studio";
import { Context, Hit, Zone } from "./zones";

const openForward: (args: { message: Message; source: string; }) => void = findByCodeLazy("initialSelectedDestinations:", "forwardOptions:");
const GuildNotifications = findByPropsLazy("updateGuildNotificationSettings");
const ChannelNotifications = findByPropsLazy("updateChannelOverrideSettings");
const VoiceChannels = findByPropsLazy("selectVoiceChannel");
const MediaEngineActions = findByPropsLazy("setVideoEnabled", "setGoLiveSource");
const Relationships = findByPropsLazy("cancelFriendRequest", "addRelationship");
const NoteStore = findStoreLazy("NoteStore");
const StatusSetting = getUserSettingLazy<string>("status", "status");

export interface OptionDef {
    key: string;
    label: string;
    type: "emoji" | "toggle" | "select" | "number";
    default: string | boolean | number;
    choices?: { value: string; label: string; }[];
    min?: number;
    max?: number;
}

export interface Action {
    id: string;
    label: string;
    zone: Zone;
    group?: string;
    custom?: boolean;
    plugin?: string;
    options?: OptionDef[];
    run(ctx: Context): void;
}

export type CommandKind = "react" | "type" | "send" | "link" | "channel" | "macro" | "radial";

export interface Command {
    id: string;
    label: string;
    kind: CommandKind;
    value: string;
    steps?: string[];
}

export const COMMAND_KINDS: { value: CommandKind; label: string; placeholder: string; }[] = [
    { value: "react", label: "React with an emoji", placeholder: "🔥 or name:id" },
    { value: "type", label: "Type text into the message box", placeholder: "Text to type" },
    { value: "send", label: "Send a message here", placeholder: "Message to send" },
    { value: "link", label: "Open a link", placeholder: "https://" },
    { value: "channel", label: "Go to a channel or DM", placeholder: "Paste a channel link" },
    { value: "macro", label: "Run several commands in a row", placeholder: "" },
    { value: "radial", label: "Open a ring of commands to pick from", placeholder: "" }
];

export function opt<T>(actionId: string, key: string, fallback: T): T {
    const value = settings.store.options?.[actionId]?.[key];
    return value === undefined ? fallback : value as T;
}

export function setOpt(actionId: string, key: string, value: unknown) {
    const all = { ...settings.store.options };
    all[actionId] = { ...all[actionId], [key]: value };
    settings.store.options = all;
}

const warn = (text: string) => showToast({ text, variant: "critical" });
const isMine = (m: Message) => m.author.id === UserStore.getCurrentUser()?.id;
const can = (perm: bigint, ch: Channel) => !ch.guild_id || PermissionStore.can(perm, ch);
const canReply = (m: Message) => MessageTypeSets.REPLYABLE.has(m.type) && !m.hasFlag(MessageFlags.EPHEMERAL);

const keybinds = new Map<string, any>();

function keybind(bind: string) {
    if (keybinds.has(bind)) return keybinds.get(bind);
    const match = (m: any) => Array.isArray(m?.binds) && m.binds.includes(bind) && typeof m.action === "function";
    let found: any = null;
    outer: for (const mod of Object.values(cache)) {
        const exp = (mod as any)?.exports;
        if (!exp || typeof exp !== "object") continue;
        for (const value of Object.values(exp)) {
            if (match(value)) { found = value; break outer; }
            if (value && typeof value === "object")
                for (const inner of Object.values(value)) if (match(inner)) { found = inner; break outer; }
        }
    }
    keybinds.set(bind, found);
    return found;
}

function pressKeybind(bind: string) {
    const kb = keybind(bind);
    if (!kb) return warn("Discord moved this shortcut, so this gesture can't run");
    kb.action({ preventDefault() { }, stopPropagation() { } }, bind);
}

function reply({ message, channel }: Hit, mention = true) {
    mention &&= opt(currentReply, "ping", true);
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

let currentReply = "msg.reply";

async function react({ message, channel }: Hit, raw = opt("msg.react", "emoji", settings.store.reactEmoji)) {
    const emoji = emojiParam(raw);
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

function clickMessage({ element }: Hit, init: MouseEventInit, type = "click") {
    const target = element.querySelector('[role="article"]') ?? element;
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: r.left + 80, clientY: r.top + 20, ...init }));
}

function ack(channelIds: string[]) {
    const channels = channelIds
        .filter(id => ReadStateStore.hasUnread(id))
        .map(channelId => ({ channelId, messageId: ReadStateStore.lastMessageId(channelId), readStateType: 0 }));
    if (channels.length) FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
}

function markServerRead(guildId = SelectedGuildStore.getGuildId()) {
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

function stepServer(by: 1 | -1) {
    const ids = SortedGuildStore.getFlattenedGuildIds();
    if (!ids.length) return;
    const i = ids.indexOf(SelectedGuildStore.getGuildId() ?? "");
    const next = i === -1 ? (by > 0 ? ids[0] : ids[ids.length - 1]) : ids[(i + by + ids.length) % ids.length];
    NavigationRouter.transitionToGuild(next);
}

function myLastMessage(channelId: string | undefined) {
    if (!channelId) return undefined;
    const me = UserStore.getCurrentUser()?.id;
    const list: Message[] = (MessageStore.getMessages(channelId) as any)?.toArray?.() ?? [];
    for (let i = list.length - 1; i >= 0; i--)
        if (list[i].author.id === me && (list[i].type === 0 || list[i].type === 19)) return list[i];
}

function editLast() {
    const channelId = SelectedChannelStore.getChannelId();
    const msg = myLastMessage(channelId);
    if (!channelId || !msg) return warn("No message of yours here to edit");
    MessageActions.startEditMessage(channelId, msg.id, msg.content);
}

function jumpLast() {
    const channelId = SelectedChannelStore.getChannelId();
    const msg = myLastMessage(channelId);
    if (!channelId || !msg) return warn("No message of yours loaded here");
    MessageActions.jumpToMessage({ channelId, messageId: msg.id, flash: true, jumpType: "INSTANT" });
}

function clickButton(pattern: RegExp, missing: string) {
    const button = [...document.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]')].find(b => pattern.test(b.getAttribute("aria-label")!));
    if (!button) return warn(missing);
    button.click();
}

function toggleCamera() {
    if (!SelectedChannelStore.getVoiceChannelId()) return warn("Join a call or voice channel first");
    MediaEngineActions.setVideoEnabled(!MediaEngineStore.isVideoEnabled());
}

function setStatus(status: string) {
    StatusSetting?.updateSetting(status);
    showToast({ text: `Status: ${STATUS_NAMES[status]}`, variant: "success" });
}

const STATUS_NAMES: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" };

async function copyInvite(guildId: string | undefined) {
    const id = guildId ?? SelectedGuildStore.getGuildId();
    if (!id) return warn("Start this gesture on a server");
    const pick = [SelectedGuildStore.getGuildId() === id ? SelectedChannelStore.getChannelId() : null, ...GuildChannelStore.getChannels(id).SELECTABLE.map((c: any) => c.channel.id)]
        .map(c => c && ChannelStore.getChannel(c))
        .find(c => c && PermissionStore.can(PermissionsBits.CREATE_INSTANT_INVITE, c));
    if (!pick) return warn("You can't make invites in this server");
    try {
        const { body } = await RestAPI.post({ url: `/channels/${pick.id}/invites`, body: { max_age: 86400, max_uses: 0 } });
        copyWithToast(`https://discord.gg/${body.code}`, "Invite link copied, valid for a day");
    } catch {
        warn("Couldn't make an invite");
    }
}

function muteHour(guildId: string) {
    const end = new Date(Date.now() + 3600_000).toISOString();
    GuildNotifications.updateGuildNotificationSettings(guildId, { muted: true, mute_config: { selected_time_window: 3600, end_time: end } });
    showToast({ text: "Muted for an hour", variant: "success" });
}

function NoteEditor({ userId, onClose, transitionState }: { userId: string; onClose(): void; transitionState: number; }) {
    const [note, setNote] = useState<string>(NoteStore.getNote?.(userId)?.note ?? "");
    const user = UserStore.getUser(userId);
    const save = () => {
        RestAPI.put({ url: `/users/@me/notes/${userId}`, body: { note } }).catch(() => warn("Couldn't save the note"));
        onClose();
    };
    return (
        <Modal transitionState={transitionState} onClose={onClose} size="sm" title={`Note for ${user?.globalName ?? user?.username ?? "them"}`} subtitle="Only you can see it." actions={[{ text: "Save", variant: "primary", onClick: save }, { text: "Cancel", variant: "secondary", onClick: onClose }]}>
            <textarea className="vc-mg-input vc-mgs-textarea" style={{ width: "100%", boxSizing: "border-box" }} value={note} maxLength={256} autoFocus onChange={e => setNote(e.currentTarget.value)} />
        </Modal>
    );
}

function block(userId: string) {
    const user = UserStore.getUser(userId);
    Alerts.show({
        title: `Block ${user?.globalName ?? user?.username ?? "them"}?`,
        body: "They won't be able to message you, and their messages are hidden.",
        confirmText: "Block",
        cancelText: "Cancel",
        onConfirm: () => Relationships.addRelationship({ userId, type: 2, context: { location: "Context Menu" } })
    });
}

async function saveForLater({ message, channel }: Hit) {
    try {
        await RestAPI.put({ url: `/users/@me/saved-messages/${channel.id}/${message.id}`, body: {} });
        showToast({ text: "Saved for later", variant: "success" });
    } catch {
        warn("Couldn't save that message");
    }
}

function openThread({ message, channel }: Hit) {
    const thread = (message as any).thread ?? ChannelStore.getChannel(message.id);
    if (!thread?.id) return warn("This message has no thread");
    NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${thread.id}`);
}

function jumpToReplied({ message, channel }: Hit) {
    const ref = message.messageReference;
    if (!ref?.message_id) return warn("This message isn't a reply");
    MessageActions.jumpToMessage({ channelId: ref.channel_id ?? channel.id, messageId: ref.message_id, flash: true });
}

function cycleTab(by: 1 | -1) {
    const i = openedTabs.findIndex(t => isTabSelected(t.id));
    if (i !== -1 && openedTabs.length > 1) moveToTab(openedTabs[(i + by + openedTabs.length) % openedTabs.length].id);
}

const tabHere = (ctx: Context) => ctx.tabId ?? openedTabs.find(t => isTabSelected(t.id))?.id;

function tabs(run: (ctx: Context) => void) {
    return (ctx: Context) => isPluginEnabled("ChannelTabs") ? run(ctx) : warn("Turn on ChannelTabs for tab gestures");
}

function needsMessage(run: (hit: Hit) => void) {
    return (ctx: Context) => ctx.hit ? run(ctx.hit) : warn("Start this gesture on a message");
}

function needs<K extends "guildId" | "channelId" | "userId">(key: K, what: string, run: (id: string, ctx: Context) => void) {
    return (ctx: Context) => ctx[key] ? run(ctx[key]!, ctx) : warn(`Start this gesture on ${what}`);
}

const thisChannel = (ctx: Context) => ctx.channelId ?? SelectedChannelStore.getChannelId();

function startCall(video = false) {
    if (!ComponentDispatch.hasSubscribers("CALL_START")) return warn("Open a DM or group chat to call");
    ComponentDispatch.dispatch("CALL_START", { shiftKey: video, preventDefault() { }, stopPropagation() { } });
}

function callPerson(userId: string, video = false) {
    openPrivateChannel(userId);
    let tries = 0;
    const wait = setInterval(() => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId() ?? "");
        const ready = channel?.isDM() && channel.getRecipientId() === userId && ComponentDispatch.hasSubscribers("CALL_START");
        if (ready || ++tries > 30) {
            clearInterval(wait);
            if (ready) startCall(video);
        }
    }, 100);
}

function joinVoice(channelId: string | undefined) {
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    if (!channel?.isVocal?.()) return warn("Start this gesture on a voice channel");
    VoiceChannels.selectVoiceChannel(channel.id);
}

const PING: OptionDef = { key: "ping", label: "Ping them", type: "toggle", default: true };
const PAGES: OptionDef = { key: "pages", label: "How many pages", type: "number", default: 1, min: 1, max: 5 };
const SETTINGS_PAGES = [
    { value: "my_account_panel", label: "My Account" },
    { value: "profiles_panel", label: "Profiles" },
    { value: "appearance_panel", label: "Appearance" },
    { value: "notifications_panel", label: "Notifications" },
    { value: "voice_and_video_panel", label: "Voice & Video" },
    { value: "chat_panel", label: "Chat" },
    { value: "keybinds_panel", label: "Keybinds" },
    { value: "equicord_plugins_panel", label: "Equicord plugins" },
    { value: "equicord_themes_panel", label: "Equicord themes" }
];

function replyAs(id: string, hit: Hit) {
    currentReply = id;
    try {
        reply(hit);
    } finally {
        currentReply = "msg.reply";
    }
}

function scrollPages(id: string, event: string) {
    const pages = Math.max(1, Math.min(5, Math.round(opt(id, "pages", 1))));
    for (let i = 0; i < pages; i++) setTimeout(() => ComponentDispatch.dispatchToLastSubscribed(event), i * 120);
}

function goToChannel(link: string) {
    const match = link.match(/(@me|\d{15,})\/(\d{15,})/) ?? link.match(/^()(\d{15,})$/);
    if (!match) return warn("That isn't a channel link");
    const guild = match[1] || ChannelStore.getChannel(match[2])?.guild_id || "@me";
    NavigationRouter.transitionTo(`/channels/${guild}/${match[2]}`);
}

function runMacro(c: Command, ctx: Context) {
    const steps = (c.steps ?? []).map(id => allActions().find(a => a.id === id)).filter((a): a is Action => !!a && a.id !== c.id);
    if (!steps.length) return warn("This macro has no steps yet. Add some in the gesture studio");
    steps.forEach((action, i) => setTimeout(() => action.run(ctx), i * 250));
}

function runCommand(c: Command, ctx: Context) {
    if (c.kind === "macro") return runMacro(c, ctx);
    if (c.kind === "radial") {
        const items = (c.steps ?? []).map(id => allActions().find(a => a.id === id)).filter((a): a is Action => !!a && a.id !== c.id);
        if (!items.length) return warn("This ring is empty. Add commands to it in the gesture studio");
        return openRadial(items, ctx, pointer.x, pointer.y);
    }
    const value = c.value.trim();
    if (!value) return warn("This command has nothing to do yet. Fill it in in the gesture studio");
    switch (c.kind) {
        case "react": return ctx.hit ? react(ctx.hit, value) : warn("Start this gesture on a message");
        case "type": return insertTextIntoChatInputBox(value);
        case "send": {
            const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId() ?? "");
            if (!channel || !can(PermissionsBits.SEND_MESSAGES, channel)) return warn("You can't send messages here");
            return sendMessage(channel.id, { content: value });
        }
        case "link": return /^https?:\/\//.test(value) ? VencordNative.native.openExternal(value) : warn("Links need to start with https://");
        case "channel": return goToChannel(value);
    }
}

export const commandLabel = (c: Command) => c.label.trim() || COMMAND_KINDS.find(k => k.value === c.kind)!.label;

const commandAction = (c: Command): Action => ({
    id: c.id,
    label: commandLabel(c),
    zone: c.kind === "react" ? "messages" : "anywhere",
    group: "Your commands",
    custom: true,
    run: ctx => runCommand(c, ctx)
});

const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

function clickPopover(key: string, hit: Hit) {
    const item = MessagePopoverButtonMap.get(key)?.render(hit.message);
    if (!item?.onClick) return warn("That button isn't available on this message");
    const target = hit.element.querySelector('[role="article"]') ?? hit.element;
    (item.onClick as any)({ preventDefault() { }, stopPropagation() { }, currentTarget: target, target, shiftKey: false, ctrlKey: false, altKey: false });
}

function pluginActions(): Action[] {
    const out: Action[] = [];
    for (const key of MessagePopoverButtonMap.keys()) {
        if (key === "NoMessageSelect") continue;
        out.push({ id: `plugin.popover.${key}`, zone: "messages", group: "From plugins", plugin: key, label: spaced(key), run: needsMessage(hit => clickPopover(key, hit)) });
    }
    for (const plugin of Object.values(plugins)) {
        const actions = plugin.toolboxActions;
        if (!actions || typeof actions === "function" || plugin.name === "MouseGestures" || !isPluginEnabled(plugin.name)) continue;
        for (const [text, fn] of Object.entries(actions as Record<string, () => void>))
            out.push({ id: `plugin.toolbox.${plugin.name}.${text}`, zone: "anywhere", group: "From plugins", plugin: plugin.name, label: text, run: () => fn() });
    }
    return out;
}

let cachedFrom: Command[] | null = null;
let cachedAt = 0;
let cached: Action[] = [];

export function allActions(): Action[] {
    const commands = settings.store.commands ?? [];
    const now = Date.now();
    if (commands !== cachedFrom || now - cachedAt > 3000) {
        cachedFrom = commands;
        cachedAt = now;
        cached = [...BUILTIN, ...pluginActions(), ...commands.map(commandAction)];
    }
    return cached;
}

const BUILTIN: Action[] = [
    { id: "nav.back", zone: "anywhere", group: "Getting around", label: "Back", run: () => NavigationRouter.back() },
    { id: "nav.forward", zone: "anywhere", group: "Getting around", label: "Forward", run: () => NavigationRouter.forward() },
    { id: "nav.oldestUnread", zone: "anywhere", group: "Getting around", label: "Jump to oldest unread", run: oldestUnread },
    { id: "nav.present", zone: "anywhere", group: "Getting around", label: "Jump to newest messages", run: () => ComponentDispatch.dispatch("SCROLLTO_PRESENT") },
    { id: "nav.pageUp", zone: "anywhere", group: "Getting around", label: "Scroll up", options: [PAGES], run: () => scrollPages("nav.pageUp", "SCROLL_PAGE_UP") },
    { id: "nav.pageDown", zone: "anywhere", group: "Getting around", label: "Scroll down", options: [PAGES], run: () => scrollPages("nav.pageDown", "SCROLL_PAGE_DOWN") },
    { id: "nav.switcher", zone: "anywhere", group: "Getting around", label: "Quick switcher", run: () => FluxDispatcher.dispatch({ type: "QUICKSWITCHER_SHOW", query: "", queryMode: null }) },
    { id: "nav.markChannelRead", zone: "anywhere", group: "Getting around", label: "Mark channel read", run: () => ack([SelectedChannelStore.getChannelId()].filter(Boolean)) },
    { id: "nav.markServerRead", zone: "anywhere", group: "Getting around", label: "Mark server read", run: () => markServerRead() },
    { id: "layout.members", zone: "anywhere", group: "Layout", label: "Show or hide members", run: () => FluxDispatcher.dispatch({ type: "CHANNEL_TOGGLE_MEMBERS_SECTION" }) },
    { id: "layout.search", zone: "anywhere", group: "Layout", label: "Search this channel", run: () => ComponentDispatch.dispatch("FOCUS_SEARCH", { prefillCurrentChannel: true }) },
    { id: "layout.pins", zone: "anywhere", group: "Layout", label: "Pinned messages", run: () => ComponentDispatch.dispatch("TOGGLE_CHANNEL_PINS") },
    { id: "layout.settings", zone: "anywhere", group: "Layout", label: "Open settings", options: [{ key: "page", label: "Page", type: "select", default: "my_account_panel", choices: SETTINGS_PAGES }], run: () => SettingsRouter.openUserSettings(opt("layout.settings", "page", "my_account_panel")) },
    { id: "layout.profile", zone: "anywhere", group: "Layout", label: "Edit profile", run: () => SettingsRouter.openUserSettings("profiles_panel") },
    { id: "layout.cheat", zone: "anywhere", group: "Layout", label: "Show the cheat sheet", run: ctx => setTimeout(() => showCheat(undefined, undefined, ctx), 0) },
    { id: "layout.studio", zone: "anywhere", group: "Layout", label: "Open the gesture studio", run: () => openStudio() },

    { id: "voice.call", zone: "anywhere", group: "Voice and calls", label: "Start a voice call here", run: () => startCall() },
    { id: "voice.videoCall", zone: "anywhere", group: "Voice and calls", label: "Start a video call here", run: () => startCall(true) },
    { id: "voice.accept", zone: "anywhere", group: "Voice and calls", label: "Answer an incoming call", run: () => ComponentDispatch.dispatch("CALL_ACCEPT") },
    { id: "voice.decline", zone: "anywhere", group: "Voice and calls", label: "Decline an incoming call", run: () => ComponentDispatch.dispatch("CALL_DECLINE") },
    { id: "voice.disconnect", zone: "anywhere", group: "Voice and calls", label: "Disconnect from voice", run: () => VoiceChannels.selectVoiceChannel(null) },
    { id: "voice.mute", zone: "anywhere", group: "Voice and calls", label: "Mute or unmute your mic", run: () => VoiceActions.toggleSelfMute() },
    { id: "voice.deafen", zone: "anywhere", group: "Voice and calls", label: "Deafen or undeafen", run: () => VoiceActions.toggleSelfDeaf() },
    { id: "voice.return", zone: "anywhere", group: "Voice and calls", label: "Go to the call you're in", run: () => pressKeybind("mod+alt+left") },
    { id: "voice.camera", zone: "anywhere", group: "Voice and calls", label: "Turn your camera on or off", run: toggleCamera },
    { id: "voice.screen", zone: "anywhere", group: "Voice and calls", label: "Share your screen, or stop", run: () => clickButton(/share your screen|stop streaming|stop sharing/i, "Join a call first. The share button lives in the voice panel") },
    { id: "voice.message", zone: "anywhere", group: "Voice and calls", label: "Record a voice message", run: () => ComponentDispatch.dispatch("RECORD_VOICE_MESSAGE") },

    { id: "pick.emoji", zone: "anywhere", group: "Pickers", label: "Emoji picker", run: () => ComponentDispatch.dispatch("TOGGLE_EMOJI_POPOUT") },
    { id: "pick.gif", zone: "anywhere", group: "Pickers", label: "GIF picker", run: () => ComponentDispatch.dispatch("TOGGLE_GIF_PICKER") },
    { id: "pick.sticker", zone: "anywhere", group: "Pickers", label: "Sticker picker", run: () => ComponentDispatch.dispatch("TOGGLE_STICKER_PICKER") },
    { id: "pick.soundboard", zone: "anywhere", group: "Pickers", label: "Soundboard", run: () => ComponentDispatch.dispatch("TOGGLE_SOUNDBOARD") },

    { id: "status.online", zone: "anywhere", group: "Status", label: "Set status: Online", run: () => setStatus("online") },
    { id: "status.idle", zone: "anywhere", group: "Status", label: "Set status: Idle", run: () => setStatus("idle") },
    { id: "status.dnd", zone: "anywhere", group: "Status", label: "Set status: Do Not Disturb", run: () => setStatus("dnd") },
    { id: "status.invisible", zone: "anywhere", group: "Status", label: "Set status: Invisible", run: () => setStatus("invisible") },
    { id: "status.toggleDnd", zone: "anywhere", group: "Status", label: "Do Not Disturb on or off", run: () => setStatus(StatusSetting?.getSetting() === "dnd" ? "online" : "dnd") },

    { id: "mine.edit", zone: "anywhere", group: "Your messages", label: "Edit your last message", run: editLast },
    { id: "mine.jump", zone: "anywhere", group: "Your messages", label: "Jump to your last message", run: jumpLast },

    { id: "inbox.toggle", zone: "anywhere", group: "Inbox and zoom", label: "Open your inbox", run: () => ComponentDispatch.dispatch("TOGGLE_INBOX") },
    { id: "inbox.markTop", zone: "anywhere", group: "Inbox and zoom", label: "Mark the top inbox item read", run: () => ComponentDispatch.dispatch("MARK_TOP_INBOX_CHANNEL_READ") },
    { id: "zoom.in", zone: "anywhere", group: "Inbox and zoom", label: "Zoom in", run: () => pressKeybind("mod+plus") },
    { id: "zoom.out", zone: "anywhere", group: "Inbox and zoom", label: "Zoom out", run: () => pressKeybind("mod+minus") },
    { id: "zoom.reset", zone: "anywhere", group: "Inbox and zoom", label: "Reset zoom", run: () => pressKeybind("mod+0") },

    { id: "msg.replyOrEdit", zone: "messages", label: "Reply, or edit if it's yours", options: [PING], run: needsMessage(hit => isMine(hit.message) ? edit(hit) : replyAs("msg.replyOrEdit", hit)) },
    { id: "msg.reply", zone: "messages", label: "Reply", options: [PING], run: needsMessage(hit => replyAs("msg.reply", hit)) },
    { id: "msg.edit", zone: "messages", label: "Edit", run: needsMessage(edit) },
    { id: "msg.react", zone: "messages", label: "React with your emoji", options: [{ key: "emoji", label: "Emoji", type: "emoji", default: "💀" }], run: needsMessage(hit => react(hit)) },
    { id: "msg.forward", zone: "messages", label: "Forward", run: needsMessage(({ message }) => openForward({ message, source: "message-context-menu" })) },
    { id: "msg.replyFile", zone: "messages", label: "Reply with a file", options: [PING], run: needsMessage(hit => { replyAs("msg.replyFile", hit); ComponentDispatch.dispatch("UPLOAD_FILE", { channelId: hit.channel.id }); }) },
    { id: "msg.quote", zone: "messages", label: "Quote", run: needsMessage(quote) },
    { id: "msg.copyText", zone: "messages", label: "Copy text", run: needsMessage(({ message }) => copyWithToast(message.content, "Message text copied")) },
    { id: "msg.copyLink", zone: "messages", label: "Copy link", run: needsMessage(({ message, channel }) => copyWithToast(`${location.origin}/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`, "Message link copied")) },
    { id: "msg.pin", zone: "messages", label: "Pin or unpin", run: needsMessage(pin) },
    { id: "msg.markUnread", zone: "messages", label: "Mark unread from here", run: needsMessage(hit => clickMessage(hit, { detail: 1, altKey: true })) },
    { id: "msg.thread", zone: "messages", label: "Start a thread", run: needsMessage(({ message, channel }) => FluxDispatcher.dispatch({ type: "OPEN_THREAD_FLOW_MODAL", channelId: channel.id, messageId: message.id })) },
    { id: "msg.menu", zone: "messages", label: "Open the message's menu", run: needsMessage(hit => clickMessage(hit, { button: 2 }, "contextmenu")) },
    { id: "msg.save", zone: "messages", label: "Save for later", run: needsMessage(saveForLater) },
    { id: "msg.openThread", zone: "messages", label: "Open its thread", run: needsMessage(openThread) },
    { id: "msg.jumpReplied", zone: "messages", label: "Jump to what it replies to", run: needsMessage(jumpToReplied) },
    { id: "msg.delete", zone: "messages", label: "Delete (asks first)", run: needsMessage(remove) },

    { id: "tab.next", zone: "tabs", label: "Next tab", run: tabs(() => cycleTab(1)) },
    { id: "tab.prev", zone: "tabs", label: "Previous tab", run: tabs(() => cycleTab(-1)) },
    { id: "tab.close", zone: "tabs", label: "Close this tab", run: tabs(ctx => { const id = tabHere(ctx); if (id != null && openedTabs.length > 1) closeTabAnimated(id); }) },
    { id: "tab.closeOthers", zone: "tabs", label: "Close the other tabs", run: tabs(ctx => { const id = tabHere(ctx); if (id != null) closeOtherTabs(id); }) },
    { id: "tab.reopen", zone: "tabs", label: "Reopen closed tab", run: tabs(reopenClosedTab) },
    { id: "tab.new", zone: "tabs", label: "New tab", run: tabs(() => createTab({ guildId: SelectedGuildStore.getGuildId() ?? "@me", channelId: SelectedChannelStore.getChannelId() } as any, true)) },
    { id: "tab.pin", zone: "tabs", label: "Pin or unpin this tab", run: tabs(ctx => { const id = tabHere(ctx); if (id != null) togglePin(id); }) },
    { id: "tab.compact", zone: "tabs", label: "Shrink or grow this tab", run: tabs(ctx => { const id = tabHere(ctx); if (id != null) toggleCompactTab(id); }) },
    { id: "tab.unread", zone: "tabs", label: "Go to a tab with unreads", run: tabs(jumpToUnreadTab) },

    { id: "server.prev", zone: "servers", label: "Previous server", run: () => stepServer(-1) },
    { id: "server.next", zone: "servers", label: "Next server", run: () => stepServer(1) },
    { id: "server.home", zone: "servers", label: "Home (DMs)", run: () => NavigationRouter.transitionTo("/channels/@me") },
    { id: "server.markRead", zone: "servers", label: "Mark this server read", run: ctx => markServerRead(ctx.guildId ?? SelectedGuildStore.getGuildId()) },
    { id: "server.mute", zone: "servers", label: "Mute or unmute this server", run: needs("guildId", "a server", id => GuildNotifications.updateGuildNotificationSettings(id, { muted: !UserGuildSettingsStore.isMuted(id) })) },
    { id: "server.invite", zone: "servers", label: "Copy an invite link", run: ctx => copyInvite(ctx.guildId) },
    { id: "server.settings", zone: "servers", label: "Open server settings", run: needs("guildId", "a server", id => FluxDispatcher.dispatch({ type: "GUILD_SETTINGS_OPEN", guildId: id, section: "OVERVIEW" })) },
    { id: "server.muteHour", zone: "servers", label: "Mute for an hour", run: needs("guildId", "a server", muteHour) },
    { id: "server.hideMuted", zone: "servers", label: "Hide or show muted channels", run: needs("guildId", "a server", id => GuildNotifications.updateGuildNotificationSettings(id, { hide_muted_channels: !UserGuildSettingsStore.isGuildCollapsed(id) })) },
    { id: "server.nextUnread", zone: "servers", label: "Next unread channel", run: () => pressKeybind("alt+shift+down") },

    { id: "channel.prev", zone: "channels", label: "Previous channel", run: () => pressKeybind("alt+up") },
    { id: "channel.next", zone: "channels", label: "Next channel", run: () => pressKeybind("alt+down") },
    { id: "channel.prevUnread", zone: "channels", label: "Previous unread channel", run: () => pressKeybind("alt+shift+up") },
    { id: "channel.nextUnread", zone: "channels", label: "Next unread channel", run: () => pressKeybind("alt+shift+down") },
    { id: "channel.markRead", zone: "channels", label: "Mark this channel read", run: ctx => ack([thisChannel(ctx)].filter(Boolean)) },
    { id: "channel.mute", zone: "channels", label: "Mute or unmute this channel", run: needs("channelId", "a channel", (id, ctx) => ChannelNotifications.updateChannelOverrideSettings(ctx.guildId ?? null, id, { muted: !UserGuildSettingsStore.isChannelMuted(ctx.guildId ?? null, id) })) },
    { id: "channel.join", zone: "channels", label: "Join this voice channel", run: ctx => joinVoice(ctx.channelId) },
    { id: "channel.newTab", zone: "channels", label: "Open in a new tab", run: tabs(ctx => { const id = thisChannel(ctx); if (id) createTab({ guildId: ChannelStore.getChannel(id)?.guild_id ?? "@me", channelId: id } as any, true); }) },

    { id: "person.dm", zone: "people", label: "Message them", run: needs("userId", "someone", id => openPrivateChannel(id)) },
    { id: "person.mention", zone: "people", label: "Mention them in your message", run: needs("userId", "someone", id => insertTextIntoChatInputBox(`<@${id}> `)) },
    { id: "person.profile", zone: "people", label: "Open their profile", run: needs("userId", "someone", (id, ctx) => openUserProfile(id, ctx.guildId)) },
    { id: "person.call", zone: "people", label: "Call them", run: needs("userId", "someone", id => callPerson(id)) },
    { id: "person.videoCall", zone: "people", label: "Video call them", run: needs("userId", "someone", id => callPerson(id, true)) },
    { id: "person.addFriend", zone: "people", label: "Add as a friend", run: needs("userId", "someone", id => Relationships.addRelationship({ userId: id, context: { location: "Context Menu" } })) },
    { id: "person.note", zone: "people", label: "Write a private note", run: needs("userId", "someone", id => openModal(props => <NoteEditor userId={id} {...props} />)) },
    { id: "person.copyName", zone: "people", label: "Copy their username", run: needs("userId", "someone", id => copyWithToast(UserStore.getUser(id)?.username ?? id, "Username copied")) },
    { id: "person.block", zone: "people", label: "Block (asks first)", run: needs("userId", "someone", block) },
    { id: "person.copyId", zone: "people", label: "Copy their user ID", run: needs("userId", "someone", id => copyWithToast(id, "User ID copied")) }
];

const DIAGONAL = /[7913]/;
const straightened = (gesture: string) => gesture.replace(/[7913]/g, "").replace(/(.)\1+/g, "$1");

export function resolve(gesture: string, ctx: Context) {
    const { bindings } = settings.store;
    const zones = [...ctx.zones, "anywhere" as const];
    for (const zone of zones) {
        const action = allActions().find(a => a.zone === zone && bindings[a.id] === gesture);
        if (action) return action;
    }
    if (!DIAGONAL.test(gesture)) return;
    const loose = straightened(gesture);
    for (const zone of zones) {
        const action = allActions().find(a => a.zone === zone && bindings[a.id] === loose && !DIAGONAL.test(bindings[a.id]));
        if (action) return action;
    }
}
