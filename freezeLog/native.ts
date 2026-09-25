/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";

const DIR = join(DATA_DIR, "freezeLog");
const FILE = join(DIR, "freezes.jsonl");
const LIMIT = 2 * 1024 * 1024;

export function append(_: IpcMainInvokeEvent, lines: string) {
    mkdirSync(DIR, { recursive: true });
    if (existsSync(FILE) && statSync(FILE).size > LIMIT) renameSync(FILE, FILE + ".old");
    appendFileSync(FILE, lines, "utf8");
}
