/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { GuildStore, showToast, useEffect, useState } from "@webpack/common";

import { createEmoji, createSticker, download, removeAsset } from "./api";
import { Asset, freeName, Kind, takenNames } from "./data";

const logger = new Logger("EmojiManager");
const historyStore = DataStore.createStore("EmojiManager", "history");
const HISTORY_LIMIT = 300;

export type Mode = "move" | "copy" | "delete";

export interface Task {
    asset: Asset;
    mode: Mode;
    target?: string;
    rename?: string;
}

export interface Problem {
    name: string;
    error: string;
}

export interface QueueState {
    running: boolean;
    total: number;
    done: number;
    problems: Problem[];
    waitUntil: number | null;
    current: string | null;
}

export interface HistoryEntry {
    key: string;
    id: string;
    kind: Kind;
    name: string;
    animated: boolean;
    tags: string;
    description: string;
    filename: string;
    fromGuild: string;
    fromName: string;
    toGuild?: string;
    toName?: string;
    mode: Mode;
    at: number;
    blob: Blob;
}

let state: QueueState = { running: false, total: 0, done: 0, problems: [], waitUntil: null, current: null };
const pending: Task[] = [];
const listeners = new Set<() => void>();
let controller = new AbortController();
const claimed = new Map<string, Set<string>>();

function pickName(target: string, kind: Kind, wanted: string) {
    const key = `${target}:${kind}`;
    const taken = takenNames(target, kind);
    claimed.get(key)?.forEach(name => taken.add(name));
    const name = freeName(wanted, taken, kind === "emoji" ? 32 : 30);
    claimed.set(key, (claimed.get(key) ?? new Set()).add(name.toLowerCase()));
    return name;
}

function update(next: Partial<QueueState>) {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
}

export function useQueue() {
    const [snapshot, setSnapshot] = useState(state);
    useEffect(() => {
        const listener = () => setSnapshot(state);
        listeners.add(listener);
        listener();
        return () => void listeners.delete(listener);
    }, []);
    return snapshot;
}

export const readHistory = () => DataStore.get<HistoryEntry[]>("entries", historyStore).then(list => list ?? []);

async function remember(entry: HistoryEntry) {
    const list = await readHistory();
    await DataStore.set("entries", [entry, ...list].slice(0, HISTORY_LIMIT), historyStore);
}

export async function forget(key: string, at: number) {
    const list = await readHistory();
    await DataStore.set("entries", list.filter(entry => !(entry.key === key && entry.at === at)), historyStore);
}

const guildName = (id?: string) => (id && GuildStore.getGuild(id)?.name) || "a server";

async function upload(kind: Kind, target: string, name: string, blob: Blob, extra: { tags: string; description: string; filename: string; }) {
    const options = { signal: controller.signal, onWait: (seconds: number) => update({ waitUntil: Date.now() + seconds * 1000 }) };
    const res = kind === "emoji"
        ? await createEmoji(target, name, blob, options)
        : await createSticker(target, { name, file: blob, ...extra }, options);
    update({ waitUntil: null });
    return res;
}

async function runTask(task: Task) {
    const { asset } = task;
    const blob = await download(asset, controller.signal);

    if (task.mode !== "delete") {
        const name = task.rename ?? pickName(task.target!, asset.kind, asset.name);
        const created = await upload(asset.kind, task.target!, name, blob, asset);
        if (!created.ok) throw new Error(created.error);
    }

    if (task.mode === "copy") return;

    await remember({
        key: asset.key, id: asset.id, kind: asset.kind, name: asset.name, animated: asset.animated,
        tags: asset.tags, description: asset.description, filename: asset.filename,
        fromGuild: asset.guildId, fromName: guildName(asset.guildId),
        toGuild: task.target, toName: task.target ? guildName(task.target) : undefined,
        mode: task.mode, at: Date.now(), blob
    });

    const removed = await removeAsset(asset, { signal: controller.signal, onWait: seconds => update({ waitUntil: Date.now() + seconds * 1000 }) });
    update({ waitUntil: null });
    if (!removed.ok) throw new Error(task.mode === "move" ? `Copied, but the original stayed: ${removed.error}` : removed.error);
}

async function drain() {
    if (state.running) return;
    update({ running: true, problems: [] });

    while (pending.length) {
        const task = pending.shift()!;
        update({ current: task.asset.name });
        try {
            await runTask(task);
        } catch (err) {
            if (controller.signal.aborted) break;
            const error = err instanceof Error ? err.message : String(err);
            logger.warn(`${task.mode} ${task.asset.name}: ${error}`);
            update({ problems: [...state.problems, { name: task.asset.name, error }] });
        }
        update({ done: state.done + 1 });
    }

    const { done, problems } = state;
    const stopped = controller.signal.aborted;
    pending.length = 0;
    claimed.clear();
    controller = new AbortController();
    update({ running: false, current: null, waitUntil: null });

    const ok = done - problems.length;
    if (stopped) showToast(`Stopped after ${ok}`, "message");
    else showToast(problems.length ? `${ok} done, ${problems.length} failed` : `${ok} done`, problems.length ? "failure" : "success");
}

export function enqueue(tasks: Task[]) {
    if (!tasks.length) return;
    if (!state.running) update({ total: 0, done: 0 });
    pending.push(...tasks);
    update({ total: state.total + tasks.length });
    void drain();
}

export function stopQueue() {
    controller.abort();
}

export async function restore(entry: HistoryEntry) {
    const name = pickName(entry.fromGuild, entry.kind, entry.name);
    const res = await upload(entry.kind, entry.fromGuild, name, entry.blob, entry);
    if (!res.ok) throw new Error(res.error);
    await forget(entry.key, entry.at);
}
