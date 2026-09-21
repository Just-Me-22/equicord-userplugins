/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { type IpcMainInvokeEvent } from "electron";
import { appendFile, readFile } from "fs/promises";
import { basename, join } from "path";

const LOG_PATH = join(DATA_DIR, "equicord-health.jsonl");
const FETCH_TIMEOUT = 10_000;

export async function readTheme(_: IpcMainInvokeEvent, name: string) {
    try {
        return await readFile(join(DATA_DIR, "themes", basename(name)), "utf-8");
    } catch {
        return null;
    }
}

// fetched here rather than in the renderer: Discord's connect-src does not allow a CDN
export async function fetchSheet(_: IpcMainInvokeEvent, url: string): Promise<{ css: string | null; error: string | null; }> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        if (!res.ok) return { css: null, error: `HTTP ${res.status}` };
        return { css: await res.text(), error: null };
    } catch (err) {
        return { css: null, error: String(err) };
    }
}

export async function appendReport(_: IpcMainInvokeEvent, line: string) {
    await appendFile(LOG_PATH, line + "\n", "utf-8");
    return LOG_PATH;
}
