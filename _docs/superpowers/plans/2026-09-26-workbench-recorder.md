# Workbench recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A userplugin, Workbench, that records a Chromium trace of Discord from inside Discord and shows where the time went: by owner, restyles, slowest frames, events and network.

**Architecture:** The native side (Electron main process) attaches `webContents.debugger`, runs the tracing domain, streams events to a gzip file and into a collector. When the recording stops it builds a `summary.json` from the collected data. The renderer side has hotkeys, captures Flux events during a recording, and draws a bottom drawer with a timeline and four tabs. All parsing and summary code is plain TypeScript with no Discord or Electron imports, so it runs under `node:test`.

**Tech Stack:** TypeScript, Electron `webContents.debugger` (CDP 1.3), Node `zlib`/`fs`, React through `@webpack/common`, `node:test` run by `tsx`.

**Spec:** `src/userplugins/_docs/superpowers/specs/2026-09-26-workbench-recorder-design.md`

## Global Constraints

- No comments in source files. Every source file starts with the Vencord SPDX header used across the repo.
- No em dashes anywhere: code, UI copy, commit messages, README.
- UI copy is sentence case and minimal. No helper text under controls.
- Look: background `#000000`, text `#ffffff`, dim text `#8a8a8a`, accent `#ff5c00`, lines `#333333`, square corners, no shadow, font `ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace` at 12px.
- F9 opens and closes the drawer. F10 starts and stops a recording. Both only without modifier keys.
- Manual recordings stop after 60s. Startup recordings last 30s. Keep the 10 newest recordings.
- Output: `%APPDATA%\Equicord\workbench\YYYY-MM-DD_HH-MM-SS\trace.json.gz` and `summary.json`. Arm flag: `%APPDATA%\Equicord\workbench\next-startup`.
- Idle cost is zero: no observers, timers or debugger while not recording.
- Commits are short, with no AI attribution. Nothing is pushed and no GitHub repo is created without the user's go.
- Workbench is its own git repo in `src/userplugins/workbench`, ignored by the userplugins repo.

**Deviations from the spec, and why:**
- The summary is built in the main process from the events as they arrive instead of in a worker thread. Equicord's build bundles every plugin's native code into one `patcher.js`, so a worker would need a separate script the build doesn't produce. Events arrive in chunks of about a thousand, so each piece of work stays a few milliseconds. The one-time source map decode (~150ms) is the only longer step.
- Two trace categories are added to the spec's list: `toplevel` (the `RunTask` events that define busy time and frames) and `disabled-by-default-devtools.timeline.stack` (stacks on invalidations, needed for "what set it off").

## Files

| File | Job |
|---|---|
| `workbench/types.ts` | shared types |
| `workbench/sourceMap.ts` | decodes Equicord's renderer source map and looks up positions |
| `workbench/attribution.ts` | the owner of a call frame |
| `workbench/network.ts` | URL shortening, single-file chains, rate limits |
| `workbench/trace.ts` | `TraceCollector`: turns trace events into compact per-thread data |
| `workbench/summary.ts` | `buildSummary`: the four summaries and the timeline |
| `workbench/recorder.ts` | `Recorder`: attach, trace, stream to gzip |
| `workbench/native.ts` | Electron glue: IPC, folders, startup recording, patched-by headers |
| `workbench/flux.ts` | renderer Flux capture during a recording |
| `workbench/store.ts` | renderer view state and actions |
| `workbench/view.ts` | pure filters for the timeline window |
| `workbench/Drawer.tsx`, `Timeline.tsx`, `tables.tsx`, `style.css` | the UI |
| `workbench/index.tsx` | plugin definition, hotkeys, mounting |
| `workbench/test/*.test.ts` | tests |

Test command, run from `C:\Users\kkosi\Documents\Equicord-pr`:

```bash
npx tsx --test src/userplugins/workbench/test/*.test.ts
```

---

### Task 1: Scaffold the plugin and its repo

**Files:**
- Create: `workbench/types.ts`, `workbench/index.tsx`, `workbench/LICENSE` (copy of `userPanelServerProfile/LICENSE`)
- Modify: `src/userplugins/.gitignore` (add `workbench/`)

**Interfaces:**
- Produces: every type in `types.ts`, used by all later tasks.

- [ ] **Step 1: Write `types.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CallFrame {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
}

export interface TraceEvent {
    name: string;
    cat?: string;
    ph: string;
    ts: number;
    dur?: number;
    pid: number;
    tid: number;
    id?: string;
    args?: any;
}

export type OwnerKind = "plugin" | "equicord" | "discord" | "chromium" | "other";

export interface Owner {
    name: string;
    kind: OwnerKind;
}

export interface FluxRecord {
    type: string;
    at: number;
    ms: number;
}

export interface FluxCapture {
    records: FluxRecord[];
    markAt: number;
}

export interface FunctionRow {
    name: string;
    where: string;
    ms: number;
}

export interface OwnerRow extends Owner {
    ms: number;
    share: number;
    patchedBy?: string[];
    functions: FunctionRow[];
}

export interface RestyleRow {
    at: number;
    ms: number;
    elements: number;
    cause: string;
    by: string | null;
}

export interface RestyleGroup {
    cause: string;
    count: number;
    avgMs: number;
}

export interface SplitRow {
    name: string;
    ms: number;
}

export interface FrameRow {
    at: number;
    ms: number;
    start: string;
    split: SplitRow[];
}

export interface EventRow {
    type: string;
    count: number;
    ms: number;
    inSlowFrames: number;
}

export interface RequestRow {
    at: number;
    ms: number;
    route: string;
    kb: number | null;
    status: number | null;
}

export interface ChainRow {
    route: string;
    count: number;
    ms: number;
    between: number;
}

export interface Summary {
    startedAt: string;
    durationMs: number;
    busyMs: number;
    owners: OwnerRow[];
    ownerBuckets: Record<string, number[]>;
    timeline: number[];
    slowBuckets: number[];
    restyles: RestyleRow[];
    restyleGroups: RestyleGroup[];
    frames: FrameRow[];
    events: EventRow[];
    flux: FluxRecord[];
    requests: RequestRow[];
    chains: ChainRow[];
    rateLimited: string[];
    error?: string;
}

export interface RecordingInfo {
    folder: string;
    startedAt: string;
    durationMs: number;
    busyMs: number;
    error?: string;
}

export interface WorkbenchState {
    recording: boolean;
    since: number | null;
    armed: boolean;
}
```

- [ ] **Step 2: Write a stub `index.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "Workbench",
    description: "Records what Discord spends its time on and shows it in a drawer. F9 opens the drawer, F10 starts and stops a recording.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }]
});
```

- [ ] **Step 3: Init the repo and ignore it in the userplugins repo**

```bash
cd src/userplugins/workbench && git init -q && git branch -m main
cp ../userPanelServerProfile/LICENSE LICENSE
cd .. && printf 'workbench/\n' >> .gitignore
```

Put `workbench/` next to the other ignored plugin folders, above the blank line and `node_modules/`, and update the comment count ("these nine have their own repos").

- [ ] **Step 4: Build**

Run: `pnpm build` in `Equicord-pr`. Expected: `Done`, no errors.

- [ ] **Step 5: Commit both repos**

```bash
cd src/userplugins/workbench && git add -A && git commit -qm "Add the Workbench plugin skeleton"
cd .. && git add .gitignore && git commit -qm "Ignore Workbench, it has its own repo"
```

---

### Task 2: Source map lookups

**Files:**
- Create: `workbench/sourceMap.ts`
- Test: `workbench/test/sourceMap.test.ts`

**Interfaces:**
- Produces: `interface MappedPosition { source: string; line: number }` (source normalised to `src/...`, line 1-based), `interface PositionLookup { lookup(line: number, column: number): MappedPosition | null }` (line and column 0-based), `class SourceMapIndex implements PositionLookup` with `constructor(map: { sources: string[]; mappings: string })`.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SourceMapIndex } from "../sourceMap";

test("maps columns to the segment that starts at or before them", () => {
    const map = new SourceMapIndex({ sources: ["../../src/a.ts", "../../src/b.ts"], mappings: "AAAA,GCAA;AAEA" });
    assert.deepEqual(map.lookup(0, 0), { source: "src/a.ts", line: 1 });
    assert.deepEqual(map.lookup(0, 2), { source: "src/a.ts", line: 1 });
    assert.deepEqual(map.lookup(0, 3), { source: "src/b.ts", line: 1 });
    assert.deepEqual(map.lookup(1, 5), { source: "src/b.ts", line: 3 });
});

test("decodes negative and multi-digit values", () => {
    const map = new SourceMapIndex({ sources: ["x.ts"], mappings: "AAEA;AADA;gBAAA" });
    assert.deepEqual(map.lookup(0, 0), { source: "x.ts", line: 3 });
    assert.deepEqual(map.lookup(1, 0), { source: "x.ts", line: 2 });
    assert.equal(map.lookup(2, 15), null);
    assert.deepEqual(map.lookup(2, 16), { source: "x.ts", line: 2 });
});

test("returns null outside the map", () => {
    const map = new SourceMapIndex({ sources: ["x.ts"], mappings: "AAAA" });
    assert.equal(map.lookup(5, 0), null);
    assert.equal(map.lookup(-1, 0), null);
});

const dist = join(process.cwd(), "dist/desktop");

test("finds the patcher in Equicord's real renderer map", { skip: !existsSync(join(dist, "renderer.js.map")) }, () => {
    const map = new SourceMapIndex(JSON.parse(readFileSync(join(dist, "renderer.js.map"), "utf8")));
    const lines = readFileSync(join(dist, "renderer.js"), "utf8").split("\n");
    const line = lines.findIndex(text => text.includes("Undoing patch group"));
    assert.ok(line >= 0);
    assert.equal(map.lookup(line, lines[line].indexOf("Undoing patch group"))?.source, "src/webpack/patchWebpack.ts");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/sourceMap.test.ts`
Expected: FAIL, cannot find module `../sourceMap`.

- [ ] **Step 3: Write `sourceMap.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const VALUES = new Int8Array(128).fill(-1);
for (const [index, char] of [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].entries()) VALUES[char.charCodeAt(0)] = index;

export interface MappedPosition {
    source: string;
    line: number;
}

export interface PositionLookup {
    lookup(line: number, column: number): MappedPosition | null;
}

export class SourceMapIndex implements PositionLookup {
    private readonly sources: string[];
    private readonly offsets: Int32Array;
    private readonly segments: Int32Array;

    constructor(map: { sources: string[]; mappings: string; }) {
        this.sources = map.sources.map(source => source.replace(/^(\.\.\/)+/, ""));
        const { mappings } = map;
        let segments = new Int32Array(1 << 16);
        let used = 0;
        const offsets = [0];
        const fields = [0, 0, 0, 0, 0];
        let count = 0, value = 0, shift = 0, column = 0, source = 0, line = 0;

        for (let i = 0; i <= mappings.length; i++) {
            const char = i < mappings.length ? mappings.charCodeAt(i) : 59;
            if (char === 44 || char === 59) {
                if (count > 0) column += fields[0];
                if (count >= 4) {
                    source += fields[1];
                    line += fields[2];
                    if (used + 3 > segments.length) {
                        const grown = new Int32Array(segments.length * 2);
                        grown.set(segments);
                        segments = grown;
                    }
                    segments[used++] = column;
                    segments[used++] = source;
                    segments[used++] = line;
                }
                count = 0;
                if (char === 59) {
                    offsets.push(used);
                    column = 0;
                }
                continue;
            }

            const digit = VALUES[char];
            value += (digit & 31) << shift;
            if (digit & 32) {
                shift += 5;
                continue;
            }
            fields[count++] = value & 1 ? -(value >>> 1) : value >>> 1;
            value = 0;
            shift = 0;
        }

        this.segments = segments.subarray(0, used);
        this.offsets = Int32Array.from(offsets);
    }

    lookup(line: number, column: number): MappedPosition | null {
        if (line < 0 || line + 1 >= this.offsets.length) return null;

        let low = this.offsets[line] / 3;
        let high = this.offsets[line + 1] / 3 - 1;
        let found = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (this.segments[middle * 3] <= column) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        if (found < 0) return null;
        return { source: this.sources[this.segments[found * 3 + 1]], line: this.segments[found * 3 + 2] + 1 };
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/sourceMap.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add sourceMap.ts test/sourceMap.test.ts && git commit -qm "Decode Equicord's renderer source map"
```

---

### Task 3: Owners

**Files:**
- Create: `workbench/attribution.ts`
- Test: `workbench/test/attribution.test.ts`

**Interfaces:**
- Consumes: `PositionLookup` (Task 2), `CallFrame`, `Owner` (Task 1).
- Produces: `RENDERER_URL = "file:///VencordRenderer"`, `interface Attribution { owner: Owner; where: string }`, `attribute(frame: CallFrame, map: PositionLookup | null): Attribution | null` (null for idle and program time; frame line and column are 0-based).

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { attribute, RENDERER_URL } from "../attribution";
import { PositionLookup } from "../sourceMap";

const frame = (url: string, functionName = "f", lineNumber = 4) => ({ functionName, url, lineNumber, columnNumber: 0 });
const mapTo = (source: string): PositionLookup => ({ lookup: () => ({ source, line: 10 }) });

test("idle and program time have no owner", () => {
    for (const name of ["(program)", "(idle)", "(root)"]) assert.equal(attribute(frame("", name), null), null);
});

test("garbage collection goes to Chromium", () => {
    assert.deepEqual(attribute(frame("", "(garbage collector)"), null)?.owner, { name: "Chromium garbage collection", kind: "chromium" });
});

test("renderer code maps to its plugin or to Equicord", () => {
    const plugin = attribute(frame(RENDERER_URL), mapTo("src/userplugins/freezeLog/index.ts"));
    assert.deepEqual(plugin, { owner: { name: "freezeLog", kind: "plugin" }, where: "src/userplugins/freezeLog/index.ts:10" });
    assert.equal(attribute(frame(RENDERER_URL), mapTo("src/equicordplugins/messagePeek/hooks.ts"))?.owner.name, "messagePeek");
    assert.equal(attribute(frame(RENDERER_URL), mapTo("src/webpack/patchWebpack.ts"))?.owner.name, "Equicord patcher");
    assert.equal(attribute(frame(RENDERER_URL), mapTo("src/plugins/_api/badges/index.tsx"))?.owner.name, "Equicord core");
    assert.deepEqual(attribute(frame(RENDERER_URL), null)?.owner, { name: "Equicord", kind: "equicord" });
});

test("Discord code goes to its module or to Discord", () => {
    assert.deepEqual(attribute(frame("file:///WebpackModule12345"), null), { owner: { name: "Discord module 12345", kind: "discord" }, where: "WebpackModule12345:5" });
    assert.deepEqual(attribute(frame("https://canary.discord.com/assets/web.abc.js"), null), { owner: { name: "Discord", kind: "discord" }, where: "web.abc.js:5" });
});

test("anything else is labelled as such", () => {
    assert.equal(attribute(frame("https://example.com/x.js"), null)?.owner.name, "Other scripts");
    assert.equal(attribute(frame(""), null)?.owner.name, "Unattributed script");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/attribution.test.ts`
Expected: FAIL, cannot find module `../attribution`.

- [ ] **Step 3: Write `attribution.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PositionLookup } from "./sourceMap";
import { CallFrame, Owner } from "./types";

export const RENDERER_URL = "file:///VencordRenderer";

const PLUGIN_SOURCE = /^src\/(?:userplugins|equicordplugins|plugins)\/([^/]+)\//;
const MODULE_URL = /^file:\/\/\/WebpackModule(\w+)/;
const IDLE = new Set(["(program)", "(idle)", "(root)"]);

export interface Attribution {
    owner: Owner;
    where: string;
}

const fileOf = (url: string, lineNumber: number) => `${url.split("/").pop()}:${lineNumber + 1}`;

export function attribute(frame: CallFrame, map: PositionLookup | null): Attribution | null {
    const { functionName, url, lineNumber, columnNumber } = frame;
    if (IDLE.has(functionName)) return null;
    if (functionName === "(garbage collector)") return { owner: { name: "Chromium garbage collection", kind: "chromium" }, where: "" };

    if (url === RENDERER_URL) {
        const mapped = map?.lookup(lineNumber, columnNumber);
        if (!mapped) return { owner: { name: "Equicord", kind: "equicord" }, where: `renderer.js:${lineNumber + 1}` };

        const where = `${mapped.source}:${mapped.line}`;
        const plugin = mapped.source.match(PLUGIN_SOURCE)?.[1];
        if (plugin && !plugin.startsWith("_")) return { owner: { name: plugin, kind: "plugin" }, where };
        if (mapped.source === "src/webpack/patchWebpack.ts") return { owner: { name: "Equicord patcher", kind: "equicord" }, where };
        return { owner: { name: "Equicord core", kind: "equicord" }, where };
    }

    const module = url.match(MODULE_URL)?.[1];
    if (module) return { owner: { name: `Discord module ${module}`, kind: "discord" }, where: `WebpackModule${module}:${lineNumber + 1}` };
    if (/discord\.com\/assets\//.test(url)) return { owner: { name: "Discord", kind: "discord" }, where: fileOf(url, lineNumber) };
    if (url) return { owner: { name: "Other scripts", kind: "other" }, where: fileOf(url, lineNumber) };
    return { owner: { name: "Unattributed script", kind: "other" }, where: "" };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/attribution.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add attribution.ts test/attribution.test.ts && git commit -qm "Decide who owns each call frame"
```

---

### Task 4: Network rows

**Files:**
- Create: `workbench/network.ts`
- Test: `workbench/test/network.test.ts`

**Interfaces:**
- Consumes: `RequestRow`, `ChainRow` (Task 1).
- Produces: `short(url: string): string`, `singleFileChains(requests: RequestRow[]): ChainRow[]`, `rateLimitedRoutes(requests: RequestRow[]): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { rateLimitedRoutes, short, singleFileChains } from "../network";

const row = (at: number, ms: number, route = "a", status: number | null = 200) => ({ at, ms, route, kb: null, status });

test("short drops signed params and hides ids and hashes", () => {
    assert.equal(
        short("https://cdn.discordapp.com/attachments/123456789012345678/876543210987654321/x.png?ex=1&is=2&hm=3&width=32"),
        "cdn.discordapp.com/attachments/#/#/x.png?width=32"
    );
    assert.equal(short("https://cdn.discordapp.com/avatars/1234567890123456/a_0123456789abcdef0123456789abcdef.webp"), "cdn.discordapp.com/avatars/#/#.webp");
});

test("requests sent one after another form a chain", () => {
    const chain = Array.from({ length: 6 }, (_, i) => row(i * 500, 200));
    assert.deepEqual(singleFileChains(chain), [{ route: "a", count: 6, ms: 2700, between: 1500 }]);
});

test("overlapping or spread out requests do not", () => {
    assert.deepEqual(singleFileChains(Array.from({ length: 6 }, (_, i) => row(i * 100, 300))), []);
    assert.deepEqual(singleFileChains(Array.from({ length: 6 }, (_, i) => row(i * 3000, 100))), []);
});

test("429 answers are listed once per route", () => {
    assert.deepEqual(rateLimitedRoutes([row(0, 1, "a", 429), row(5, 1, "a", 429), row(9, 1, "b", 200)]), ["a"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/network.test.ts`
Expected: FAIL, cannot find module `../network`.

- [ ] **Step 3: Write `network.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChainRow, RequestRow } from "./types";

const CHAIN_GAP = 2000;
const CHAIN_MIN = 5;

export function short(url: string) {
    const { host, pathname, searchParams } = new URL(url);
    for (const key of ["ex", "is", "hm"]) searchParams.delete(key);
    const query = searchParams.toString();
    return `${host}${pathname}${query && "?" + query}`.replace(/\d{15,}|(?:a_)?[0-9a-f]{32}/g, "#");
}

function chainOf(route: string, run: RequestRow[]): ChainRow | null {
    if (run.length < CHAIN_MIN) return null;
    const last = run[run.length - 1];
    const span = last.at + last.ms - run[0].at;
    if (span < CHAIN_GAP) return null;
    const busy = run.reduce((sum, request) => sum + request.ms, 0);
    return { route, count: run.length, ms: Math.round(span), between: Math.max(0, Math.round(span - busy)) };
}

export function singleFileChains(requests: RequestRow[]): ChainRow[] {
    const byRoute = new Map<string, RequestRow[]>();
    for (const request of requests) {
        const list = byRoute.get(request.route);
        if (list) list.push(request);
        else byRoute.set(request.route, [request]);
    }

    const chains: ChainRow[] = [];
    for (const [route, list] of byRoute) {
        list.sort((a, b) => a.at - b.at);
        let run: RequestRow[] = [];
        for (const request of list) {
            const last = run[run.length - 1];
            const end = last ? last.at + last.ms : 0;
            if (last && (request.at < end || request.at - end > CHAIN_GAP)) {
                const chain = chainOf(route, run);
                if (chain) chains.push(chain);
                run = [];
            }
            run.push(request);
        }
        const chain = chainOf(route, run);
        if (chain) chains.push(chain);
    }

    return chains;
}

export function rateLimitedRoutes(requests: RequestRow[]) {
    return [...new Set(requests.filter(request => request.status === 429).map(request => request.route))];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/network.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add network.ts test/network.test.ts && git commit -qm "Shorten routes and find single-file chains and rate limits"
```

---

### Task 5: Trace collector

**Files:**
- Create: `workbench/trace.ts`
- Test: `workbench/test/trace.test.ts`

**Interfaces:**
- Consumes: `TraceEvent`, `CallFrame` (Task 1).
- Produces: `type RenderKind = "style" | "layout" | "paint" | "compositing" | "compile"`, `Span { ts; dur }`, `RenderSpan extends Span { kind }`, `RestyleSpan extends Span { elements }`, `Invalidation { ts; cause: string; frame: CallFrame | null }`, `Starter { ts; label: string }`, `ThreadData { name; tasks: Span[]; legacyTasks: Span[]; render; restyles; invalidations; starters }`, `Profile { thread: string; startTime; nodes: Map<number, CallFrame>; samples: number[]; deltas: number[] }`, `Request { at; url; status: number | null; end: number | null; bytes: number | null }`, `class TraceCollector` with `threads: Map<string, ThreadData>` keyed `"pid:tid"`, `profiles: Map<string, Profile>`, `requests: Map<string, Request>`, `mainPids: Set<number>`, `mark: number | null`, `fluxMark: number | null`, `first: number`, `last: number`, `add(events: TraceEvent[]): void`.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TraceCollector } from "../trace";

const at = (name: string, ts: number, extra: Record<string, unknown> = {}) => ({ name, ph: "X", ts, pid: 1, tid: 1, ...extra });

test("collects per-thread spans, marks and main frame processes", () => {
    const trace = new TraceCollector();
    trace.add([
        { name: "thread_name", ph: "M", ts: 0, pid: 1, tid: 1, args: { name: "CrRendererMain" } },
        { name: "TracingStartedInBrowser", ph: "I", ts: 10, pid: 9, tid: 9, args: { data: { frames: [{ processId: 1 }, { processId: 2, parent: "x" }] } } },
        { name: "workbench-start", ph: "R", ts: 100, pid: 1, tid: 1 },
        { name: "workbench-flux", ph: "R", ts: 150, pid: 1, tid: 1 },
        at("RunTask", 100, { dur: 60 }),
        at("UpdateLayoutTree", 110, { dur: 20, args: { elementCount: 500 } }),
        at("Paint", 140, { dur: 5 }),
        at("EventDispatch", 101, { dur: 50, args: { data: { type: "click" } } })
    ]);

    const thread = trace.threads.get("1:1")!;
    assert.equal(thread.name, "CrRendererMain");
    assert.deepEqual([...trace.mainPids], [1]);
    assert.equal(trace.mark, 100);
    assert.equal(trace.fluxMark, 150);
    assert.deepEqual(thread.tasks, [{ ts: 100, dur: 60 }]);
    assert.deepEqual(thread.restyles, [{ ts: 110, dur: 20, elements: 500 }]);
    assert.deepEqual(thread.render.map(span => span.kind), ["style", "paint"]);
    assert.deepEqual(thread.starters, [{ ts: 101, label: "event: click" }]);
    assert.equal(trace.first, 10);
    assert.equal(trace.last, 160);
});

test("describes invalidations and keeps their first script frame", () => {
    const trace = new TraceCollector();
    trace.add([{
        name: "StyleInvalidatorInvalidationTracking", ph: "I", ts: 5, pid: 1, tid: 1,
        args: { data: { nodeName: "DIV class='base__'", changedClass: "app-focused", stackTrace: [{ functionName: "", url: "", lineNumber: 0, columnNumber: 0 }, { functionName: "toggle", url: "file:///WebpackModule7", lineNumber: 3, columnNumber: 9 }] } }
    }, {
        name: "StyleRecalcInvalidationTracking", ph: "I", ts: 6, pid: 1, tid: 1, args: { data: { nodeName: "STYLE", reason: "Style sheet change" } }
    }]);

    const [first, second] = trace.threads.get("1:1")!.invalidations;
    assert.equal(first.cause, "class changed on DIV class='base__' (app-focused)");
    assert.equal(first.frame?.functionName, "toggle");
    assert.equal(second.cause, "stylesheet added or changed");
});

test("accumulates CPU profile chunks by profile id", () => {
    const trace = new TraceCollector();
    trace.add([
        { name: "Profile", ph: "P", ts: 50, pid: 1, tid: 1, id: "0x1", args: { data: { startTime: 50 } } },
        { name: "ProfileChunk", ph: "P", ts: 60, pid: 1, tid: 1, id: "0x1", args: { data: { cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: "a", url: "", lineNumber: 0, columnNumber: 0 } }], samples: [1, 1] }, timeDeltas: [5, 7] } } },
        { name: "ProfileChunk", ph: "P", ts: 70, pid: 1, tid: 1, id: "0x1", args: { data: { cpuProfile: { samples: [1] }, timeDeltas: [9] } } }
    ]);

    const profile = trace.profiles.get("1:0x1")!;
    assert.equal(profile.thread, "1:1");
    assert.equal(profile.startTime, 50);
    assert.deepEqual(profile.samples, [1, 1, 1]);
    assert.deepEqual(profile.deltas, [5, 7, 9]);
    assert.equal(profile.nodes.get(1)?.functionName, "a");
});

test("joins network events by request id", () => {
    const trace = new TraceCollector();
    trace.add([
        { name: "ResourceSendRequest", ph: "I", ts: 100, pid: 1, tid: 1, args: { data: { requestId: "r1", url: "https://x.test/a" } } },
        { name: "ResourceReceiveResponse", ph: "I", ts: 150, pid: 1, tid: 1, args: { data: { requestId: "r1", statusCode: 429 } } },
        { name: "ResourceFinish", ph: "I", ts: 180, pid: 1, tid: 1, args: { data: { requestId: "r1", decodedBodyLength: 2048 } } }
    ]);
    assert.deepEqual(trace.requests.get("r1"), { at: 100, url: "https://x.test/a", status: 429, end: 180, bytes: 2048 });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/trace.test.ts`
Expected: FAIL, cannot find module `../trace`.

- [ ] **Step 3: Write `trace.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CallFrame, TraceEvent } from "./types";

export type RenderKind = "style" | "layout" | "paint" | "compositing" | "compile";

export interface Span {
    ts: number;
    dur: number;
}

export interface RenderSpan extends Span {
    kind: RenderKind;
}

export interface RestyleSpan extends Span {
    elements: number;
}

export interface Invalidation {
    ts: number;
    cause: string;
    frame: CallFrame | null;
}

export interface Starter {
    ts: number;
    label: string;
}

export interface ThreadData {
    name: string;
    tasks: Span[];
    legacyTasks: Span[];
    render: RenderSpan[];
    restyles: RestyleSpan[];
    invalidations: Invalidation[];
    starters: Starter[];
}

export interface Profile {
    thread: string;
    startTime: number;
    nodes: Map<number, CallFrame>;
    samples: number[];
    deltas: number[];
}

export interface Request {
    at: number;
    url: string;
    status: number | null;
    end: number | null;
    bytes: number | null;
}

const RENDER: Record<string, RenderKind> = {
    UpdateLayoutTree: "style",
    Layout: "layout",
    PrePaint: "paint",
    Paint: "paint",
    Layerize: "compositing",
    Commit: "compositing",
    "v8.compile": "compile",
    CompileScript: "compile"
};

const STARTERS: Record<string, (data: any) => string> = {
    EventDispatch: data => `event: ${data?.type ?? "unknown"}`,
    TimerFire: () => "timer",
    FireIdleCallback: () => "idle callback",
    FireAnimationFrame: () => "animation frame",
    EvaluateScript: () => "script load",
    XHRReadyStateChange: () => "network callback",
    ParseHTML: () => "HTML parse",
    FunctionCall: data => `function ${data?.functionName || "call"}`
};

const NETWORK = new Set(["ResourceSendRequest", "ResourceReceiveResponse", "ResourceFinish"]);
const IGNORED_INVALIDATIONS = new Set(["LayoutInvalidationTracking", "PaintInvalidationTracking"]);

function causeOf(data: any) {
    const node = data.nodeName ?? "an element";
    const reason: string = data.reason ?? "";
    if (data.changedClass) return `class changed on ${node} (${data.changedClass})`;
    if (data.changedAttribute) return `attribute ${data.changedAttribute} changed on ${node}`;
    if (data.changedId) return `id changed on ${node}`;
    if (/sheet/i.test(reason)) return "stylesheet added or changed";
    if (/insert|remov|child/i.test(reason)) return `nodes inserted or removed under ${node}`;
    if (reason) return `${reason} on ${node}`;
    return "unknown";
}

export class TraceCollector {
    readonly threads = new Map<string, ThreadData>();
    readonly profiles = new Map<string, Profile>();
    readonly requests = new Map<string, Request>();
    readonly mainPids = new Set<number>();
    mark: number | null = null;
    fluxMark: number | null = null;
    first = Infinity;
    last = 0;

    add(events: TraceEvent[]) {
        for (const event of events) this.addOne(event);
    }

    private thread(event: TraceEvent) {
        const key = `${event.pid}:${event.tid}`;
        let data = this.threads.get(key);
        if (!data) this.threads.set(key, data = { name: "", tasks: [], legacyTasks: [], render: [], restyles: [], invalidations: [], starters: [] });
        return data;
    }

    private profile(event: TraceEvent) {
        const key = `${event.pid}:${event.id}`;
        let profile = this.profiles.get(key);
        if (!profile) this.profiles.set(key, profile = { thread: `${event.pid}:${event.tid}`, startTime: event.ts, nodes: new Map(), samples: [], deltas: [] });
        return profile;
    }

    private addOne(event: TraceEvent) {
        const { name, ph, ts, args } = event;
        if (ph === "M") {
            if (name === "thread_name") this.thread(event).name = args?.name ?? "";
            return;
        }

        if (ts > 0) {
            this.first = Math.min(this.first, ts);
            this.last = Math.max(this.last, ts + (event.dur ?? 0));
        }

        if (name === "TracingStartedInBrowser") {
            for (const frame of args?.data?.frames ?? []) if (!frame.parent && frame.processId) this.mainPids.add(frame.processId);
        } else if (name === "workbench-start") {
            this.mark ??= ts;
        } else if (name === "workbench-flux") {
            this.fluxMark ??= ts;
        } else if (name === "Profile") {
            this.profile(event).startTime = args?.data?.startTime ?? ts;
        } else if (name === "ProfileChunk") {
            this.chunk(event);
        } else if (NETWORK.has(name)) {
            this.network(event);
        } else if (name.endsWith("InvalidationTracking") && !IGNORED_INVALIDATIONS.has(name)) {
            const data = args?.data ?? {};
            const frame = (data.stackTrace ?? []).find((candidate: CallFrame) => candidate.url) ?? null;
            this.thread(event).invalidations.push({ ts, cause: causeOf(data), frame });
        } else if (ph === "X" && event.dur != null) {
            this.span(event, event.dur);
        }
    }

    private span(event: TraceEvent, dur: number) {
        const { name, ts, args } = event;
        const data = this.thread(event);
        if (name === "RunTask") data.tasks.push({ ts, dur });
        else if (name === "ThreadControllerImpl::RunTask") data.legacyTasks.push({ ts, dur });

        const kind = RENDER[name];
        if (kind) data.render.push({ ts, dur, kind });
        if (name === "UpdateLayoutTree") data.restyles.push({ ts, dur, elements: args?.elementCount ?? args?.data?.elementCount ?? 0 });

        const starter = STARTERS[name];
        if (starter) data.starters.push({ ts, label: starter(args?.data) });
    }

    private chunk(event: TraceEvent) {
        const profile = this.profile(event);
        const data = event.args?.data ?? {};
        for (const node of data.cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node.callFrame);

        const samples: number[] = data.cpuProfile?.samples ?? [];
        const deltas: number[] = data.timeDeltas ?? [];
        for (let i = 0; i < samples.length; i++) {
            profile.samples.push(samples[i]);
            profile.deltas.push(deltas[i] ?? 0);
        }
    }

    private network(event: TraceEvent) {
        const data = event.args?.data ?? {};
        const id = data.requestId;
        if (!id) return;

        if (event.name === "ResourceSendRequest") {
            this.requests.set(id, { at: event.ts, url: data.url ?? "", status: null, end: null, bytes: null });
            return;
        }

        const request = this.requests.get(id);
        if (!request) return;
        if (event.name === "ResourceReceiveResponse") {
            request.status = data.statusCode ?? null;
            return;
        }
        request.end = data.finishTime ? data.finishTime * 1e6 : event.ts;
        request.bytes = data.decodedBodyLength ?? data.encodedDataLength ?? null;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/trace.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add trace.ts test/trace.test.ts && git commit -qm "Collect trace events into per-thread data"
```

---

### Task 6: Summary

**Files:**
- Create: `workbench/summary.ts`
- Test: `workbench/test/summary.test.ts`

**Interfaces:**
- Consumes: `attribute` (Task 3), `PositionLookup` (Task 2), `short`, `singleFileChains`, `rateLimitedRoutes` (Task 4), `TraceCollector` and its types (Task 5), `Summary` and row types (Task 1).
- Produces: `buildSummary(collector: TraceCollector, options: { map: PositionLookup | null; flux: FluxCapture | null; startedAt: Date }): Summary`, `emptySummary(startedAt: Date, error?: string): Summary`. Times in the summary are milliseconds from the `workbench-start` mark, rounded to 0.1. The timeline has one entry per 100ms.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RENDERER_URL } from "../attribution";
import { buildSummary } from "../summary";
import { TraceCollector } from "../trace";

const T0 = 1_000_000;
const main = { pid: 1, tid: 1 };
const x = (name: string, ts: number, dur: number, args?: unknown) => ({ name, ph: "X", ts, dur, ...main, args });

function sample() {
    const trace = new TraceCollector();
    trace.add([
        { name: "thread_name", ph: "M", ts: 0, ...main, args: { name: "CrRendererMain" } },
        { name: "workbench-start", ph: "R", ts: T0, ...main },
        { name: "workbench-flux", ph: "R", ts: T0 + 4000, ...main },
        x("RunTask", T0, 60_000),
        x("EventDispatch", T0 + 100, 59_000, { data: { type: "click" } }),
        { name: "StyleInvalidatorInvalidationTracking", ph: "I", ts: T0 + 5000, ...main, args: { data: { nodeName: "DIV", changedClass: "foo", stackTrace: [{ functionName: "toggle", url: "file:///WebpackModule99", lineNumber: 1, columnNumber: 1 }] } } },
        x("UpdateLayoutTree", T0 + 30_000, 20_000, { elementCount: 500 }),
        x("RunTask", T0 + 200_000, 10_000),
        { name: "Profile", ph: "P", ts: T0, ...main, id: "0x1", args: { data: { startTime: T0 } } },
        {
            name: "ProfileChunk", ph: "P", ts: T0, ...main, id: "0x1", args: {
                data: {
                    cpuProfile: {
                        nodes: [
                            { id: 1, callFrame: { functionName: "(program)", url: "", lineNumber: 0, columnNumber: 0 } },
                            { id: 2, callFrame: { functionName: "flush", url: RENDERER_URL, lineNumber: 0, columnNumber: 0 } },
                            { id: 3, callFrame: { functionName: "render", url: "file:///WebpackModule99", lineNumber: 0, columnNumber: 0 } }
                        ],
                        samples: [2, 2, 3, 1]
                    },
                    timeDeltas: [1000, 10_000, 10_000, 10_000]
                }
            }
        },
        { name: "ResourceSendRequest", ph: "I", ts: T0 + 50_000, ...main, args: { data: { requestId: "r", url: "https://canary.discord.com/api/v9/channels/123456789012345678/messages?limit=1" } } },
        { name: "ResourceReceiveResponse", ph: "I", ts: T0 + 100_000, ...main, args: { data: { requestId: "r", statusCode: 200 } } },
        { name: "ResourceFinish", ph: "I", ts: T0 + 150_000, ...main, args: { data: { requestId: "r", decodedBodyLength: 2048 } } }
    ]);
    return trace;
}

const map = { lookup: () => ({ source: "src/userplugins/freezeLog/index.ts", line: 3 }) };
const flux = { records: [{ type: "CHANNEL_SELECT", at: 5, ms: 3 }], markAt: 0 };

test("splits busy time between owners and rendering", () => {
    const summary = buildSummary(sample(), { map, flux, startedAt: new Date(0) });
    const owners = Object.fromEntries(summary.owners.map(owner => [owner.name, owner.ms]));
    assert.equal(summary.busyMs, 70);
    assert.deepEqual(owners, { "freezeLog": 20, "Chromium style": 20, "Chromium other work": 20, "Discord module 99": 10 });
    assert.equal(summary.owners.reduce((sum, owner) => sum + owner.ms, 0), summary.busyMs);
    assert.equal(summary.owners.find(owner => owner.name === "freezeLog")?.functions[0].where, "src/userplugins/freezeLog/index.ts:3");
});

test("builds the timeline and slow buckets", () => {
    const summary = buildSummary(sample(), { map, flux, startedAt: new Date(0) });
    assert.deepEqual(summary.timeline, [60, 0, 10]);
    assert.deepEqual(summary.slowBuckets, [0]);
    assert.equal(summary.timeline.reduce((sum, ms) => sum + ms, 0), summary.busyMs);
    assert.equal(summary.ownerBuckets["freezeLog"][0], 20);
});

test("gives each restyle its cause", () => {
    const summary = buildSummary(sample(), { map, flux, startedAt: new Date(0) });
    assert.deepEqual(summary.restyles, [{ at: 30, ms: 20, elements: 500, cause: "class changed on DIV (foo)", by: "toggle (Discord module 99)" }]);
    assert.deepEqual(summary.restyleGroups, [{ cause: "class changed on DIV (foo)", count: 1, avgMs: 20 }]);
});

test("lists slow frames with what started them and their split", () => {
    const [frame] = buildSummary(sample(), { map, flux, startedAt: new Date(0) }).frames;
    assert.equal(frame.at, 0);
    assert.equal(frame.ms, 60);
    assert.equal(frame.start, "event: click");
    assert.deepEqual(frame.split, [{ name: "freezeLog", ms: 20 }, { name: "Chromium style", ms: 20 }, { name: "Discord module 99", ms: 10 }]);
});

test("aligns Flux events and joins requests", () => {
    const summary = buildSummary(sample(), { map, flux, startedAt: new Date(0) });
    assert.deepEqual(summary.flux, [{ type: "CHANNEL_SELECT", at: 9, ms: 3 }]);
    assert.deepEqual(summary.events, [{ type: "CHANNEL_SELECT", count: 1, ms: 3, inSlowFrames: 1 }]);
    assert.deepEqual(summary.requests, [{ at: 50, ms: 100, route: "canary.discord.com/api/v9/channels/#/messages?limit=1", kb: 2, status: 200 }]);
});

test("a trace without a main thread gives an error summary", () => {
    assert.match(buildSummary(new TraceCollector(), { map: null, flux: null, startedAt: new Date(0) }).error ?? "", /main thread/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/summary.test.ts`
Expected: FAIL, cannot find module `../summary`.

- [ ] **Step 3: Write `summary.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { attribute } from "./attribution";
import { rateLimitedRoutes, short, singleFileChains } from "./network";
import { PositionLookup } from "./sourceMap";
import { RenderKind, Span, ThreadData, TraceCollector } from "./trace";
import { CallFrame, EventRow, FluxCapture, FluxRecord, FrameRow, Owner, OwnerRow, RequestRow, RestyleGroup, RestyleRow, Summary } from "./types";

const BUCKET_US = 100_000;
const SLOW_US = 50_000;
const TOP_FRAMES = 20;
const TOP_FUNCTIONS = 10;
const TOP_GROUPS = 30;
const SPLIT_ROWS = 6;

const RENDER_OWNERS: Record<RenderKind, Owner> = {
    style: { name: "Chromium style", kind: "chromium" },
    layout: { name: "Chromium layout", kind: "chromium" },
    paint: { name: "Chromium paint", kind: "chromium" },
    compositing: { name: "Chromium compositing", kind: "chromium" },
    compile: { name: "Script compile", kind: "chromium" }
};

const OTHER_WORK: Owner = { name: "Chromium other work", kind: "chromium" };

interface Tally {
    owner: Owner;
    us: number;
    buckets: Float64Array;
    functions: Map<string, { name: string; where: string; us: number; }>;
}

interface Sample {
    ts: number;
    us: number;
    owner: string;
}

interface Options {
    map: PositionLookup | null;
    flux: FluxCapture | null;
    startedAt: Date;
}

const round = (value: number) => Math.round(value * 10) / 10;
const ms = (us: number) => round(us / 1000);

export function emptySummary(startedAt: Date, error?: string): Summary {
    return {
        startedAt: startedAt.toISOString(), durationMs: 0, busyMs: 0, owners: [], ownerBuckets: {}, timeline: [], slowBuckets: [],
        restyles: [], restyleGroups: [], frames: [], events: [], flux: [], requests: [], chains: [], rateLimited: [], error
    };
}

const tasksOf = (data: ThreadData) => data.tasks.length ? data.tasks : data.legacyTasks;

function mainThread(collector: TraceCollector) {
    const ranked = [...collector.threads].map(([key, data]) => ({
        key,
        data,
        busy: tasksOf(data).reduce((sum, task) => sum + task.dur, 0),
        score: (data.name === "CrRendererMain" ? 2 : 0) + (collector.mainPids.has(Number(key.split(":")[0])) ? 1 : 0)
    })).sort((a, b) => b.score - a.score || b.busy - a.busy);
    return ranked[0]?.busy ? ranked[0] : null;
}

function spread(buckets: Float64Array, ts: number, dur: number, t0: number) {
    let start = Math.max(ts, t0);
    const end = ts + dur;
    while (start < end) {
        const index = Math.floor((start - t0) / BUCKET_US);
        if (index >= buckets.length) return;
        const slice = Math.min(end, t0 + (index + 1) * BUCKET_US) - start;
        buckets[index] += slice;
        start += slice;
    }
}

function describe(frame: CallFrame, map: PositionLookup | null) {
    const found = attribute({ ...frame, lineNumber: frame.lineNumber - 1, columnNumber: frame.columnNumber - 1 }, map);
    return `${frame.functionName || "(anonymous)"} (${found?.owner.name ?? "unknown"})`;
}

export function buildSummary(collector: TraceCollector, { map, flux, startedAt }: Options): Summary {
    const main = mainThread(collector);
    if (!main) return emptySummary(startedAt, "The recording has no main thread events");

    const thread = main.data;
    const t0 = collector.mark ?? collector.first;
    const durationUs = Math.max(0, collector.last - t0);
    const bucketCount = Math.max(1, Math.ceil(durationUs / BUCKET_US));
    const bucketOf = (ts: number) => Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - t0) / BUCKET_US)));

    const tallies = new Map<string, Tally>();
    const tally = (owner: Owner) => {
        let entry = tallies.get(owner.name);
        if (!entry) tallies.set(owner.name, entry = { owner, us: 0, buckets: new Float64Array(bucketCount), functions: new Map() });
        return entry;
    };

    const samples: Sample[] = [];
    for (const profile of collector.profiles.values()) {
        if (profile.thread !== main.key) continue;
        const owners = new Map<number, ReturnType<typeof attribute>>();
        let ts = profile.startTime;
        for (let i = 0; i < profile.samples.length; i++) {
            ts += profile.deltas[i];
            const us = i + 1 < profile.samples.length ? profile.deltas[i + 1] : 0;
            if (us <= 0 || ts < t0) continue;

            const node = profile.samples[i];
            const frame = profile.nodes.get(node);
            if (!owners.has(node)) owners.set(node, frame ? attribute(frame, map) : null);
            const found = owners.get(node);
            if (!found || !frame) continue;

            const entry = tally(found.owner);
            entry.us += us;
            spread(entry.buckets, ts, us, t0);
            const key = `${frame.functionName}|${found.where}`;
            const fn = entry.functions.get(key) ?? { name: frame.functionName || "(anonymous)", where: found.where, us: 0 };
            fn.us += us;
            entry.functions.set(key, fn);
            samples.push({ ts, us, owner: found.owner.name });
        }
    }

    const render = [...thread.render].filter(span => span.ts + span.dur >= t0).sort((a, b) => a.ts - b.ts);
    for (const span of render) {
        const entry = tally(RENDER_OWNERS[span.kind]);
        entry.us += span.dur;
        spread(entry.buckets, span.ts, span.dur, t0);
    }

    const tasks = tasksOf(thread).filter(task => task.ts + task.dur >= t0);
    const busyUs = tasks.reduce((sum, task) => sum + Math.min(task.dur, task.ts + task.dur - t0), 0);
    const timeline = new Float64Array(bucketCount);
    for (const task of tasks) spread(timeline, task.ts, task.dur, t0);

    const counted = new Float64Array(bucketCount);
    for (const entry of tallies.values()) for (let i = 0; i < bucketCount; i++) counted[i] += entry.buckets[i];
    const other = tally(OTHER_WORK);
    for (let i = 0; i < bucketCount; i++) {
        other.buckets[i] = Math.max(0, timeline[i] - counted[i]);
        other.us += other.buckets[i];
    }

    const owners: OwnerRow[] = [...tallies.values()].filter(entry => entry.us > 0).sort((a, b) => b.us - a.us).map(entry => ({
        ...entry.owner,
        ms: ms(entry.us),
        share: busyUs ? round(entry.us / busyUs * 100) : 0,
        functions: [...entry.functions.values()].sort((a, b) => b.us - a.us).slice(0, TOP_FUNCTIONS).map(fn => ({ name: fn.name, where: fn.where, ms: ms(fn.us) }))
    }));
    const ownerBuckets = Object.fromEntries([...tallies.values()].filter(entry => entry.us > 0).map(entry => [entry.owner.name, Array.from(entry.buckets, ms)]));

    const slow = tasks.filter(task => task.dur >= SLOW_US);
    const slowBuckets = [...new Set(slow.flatMap(task => {
        const from = bucketOf(task.ts);
        return Array.from({ length: bucketOf(task.ts + task.dur) - from + 1 }, (_, i) => from + i);
    }))].sort((a, b) => a - b);

    const restyles = restylesOf(thread, t0, map);
    const fluxRecords = alignFlux(collector, flux, t0);
    const requests = requestsOf(collector, t0);

    return {
        startedAt: startedAt.toISOString(),
        durationMs: ms(durationUs),
        busyMs: ms(busyUs),
        owners,
        ownerBuckets,
        timeline: Array.from(timeline, ms),
        slowBuckets,
        restyles,
        restyleGroups: groupsOf(restyles),
        frames: framesOf(slow, thread, render, samples, t0),
        events: eventsOf(fluxRecords, slow, t0),
        flux: fluxRecords,
        requests,
        chains: singleFileChains(requests),
        rateLimited: rateLimitedRoutes(requests)
    };
}

function restylesOf(thread: ThreadData, t0: number, map: PositionLookup | null): RestyleRow[] {
    const invalidations = [...thread.invalidations].sort((a, b) => a.ts - b.ts);
    let cursor = 0;
    let previousEnd = -Infinity;
    return [...thread.restyles].filter(span => span.ts >= t0).sort((a, b) => a.ts - b.ts).map(span => {
        while (cursor < invalidations.length && invalidations[cursor].ts <= previousEnd) cursor++;
        const first = cursor < invalidations.length && invalidations[cursor].ts <= span.ts ? invalidations[cursor] : null;
        while (cursor < invalidations.length && invalidations[cursor].ts <= span.ts) cursor++;
        previousEnd = span.ts + span.dur;
        return {
            at: ms(span.ts - t0),
            ms: ms(span.dur),
            elements: span.elements,
            cause: first?.cause ?? "unknown",
            by: first?.frame ? describe(first.frame, map) : null
        };
    });
}

function groupsOf(restyles: RestyleRow[]): RestyleGroup[] {
    const groups = new Map<string, { count: number; total: number; }>();
    for (const row of restyles) {
        const group = groups.get(row.cause) ?? { count: 0, total: 0 };
        group.count++;
        group.total += row.ms;
        groups.set(row.cause, group);
    }
    return [...groups].sort((a, b) => b[1].total - a[1].total).slice(0, TOP_GROUPS).map(([cause, group]) => ({ cause, count: group.count, avgMs: round(group.total / group.count) }));
}

function framesOf(slow: Span[], thread: ThreadData, render: { ts: number; dur: number; kind: RenderKind; }[], samples: Sample[], t0: number): FrameRow[] {
    const starters = [...thread.starters].sort((a, b) => a.ts - b.ts);
    return [...slow].sort((a, b) => b.dur - a.dur).slice(0, TOP_FRAMES).map(task => {
        const end = task.ts + task.dur;
        const split = new Map<string, number>();
        const add = (name: string, us: number) => split.set(name, (split.get(name) ?? 0) + us);
        for (const sample of samples) if (sample.ts >= task.ts && sample.ts < end) add(sample.owner, sample.us);
        for (const span of render) {
            if (span.ts >= end) break;
            const overlap = Math.min(end, span.ts + span.dur) - Math.max(task.ts, span.ts);
            if (overlap > 0) add(RENDER_OWNERS[span.kind].name, overlap);
        }
        return {
            at: ms(task.ts - t0),
            ms: ms(task.dur),
            start: starters.find(starter => starter.ts >= task.ts && starter.ts <= end)?.label ?? "native work",
            split: [...split].sort((a, b) => b[1] - a[1]).slice(0, SPLIT_ROWS).map(([name, us]) => ({ name, ms: ms(us) }))
        };
    });
}

function alignFlux(collector: TraceCollector, flux: FluxCapture | null, t0: number): FluxRecord[] {
    if (!flux) return [];
    const offset = ((collector.fluxMark ?? t0) - t0) / 1000 - flux.markAt;
    return flux.records.map(record => ({ type: record.type, at: round(record.at + offset), ms: round(record.ms) }));
}

function eventsOf(records: FluxRecord[], slow: Span[], t0: number): EventRow[] {
    const windows = slow.map(task => [(task.ts - t0) / 1000, (task.ts + task.dur - t0) / 1000]);
    const rows = new Map<string, EventRow>();
    for (const record of records) {
        const row = rows.get(record.type) ?? { type: record.type, count: 0, ms: 0, inSlowFrames: 0 };
        row.count++;
        row.ms += record.ms;
        if (windows.some(([start, stop]) => record.at >= start && record.at <= stop)) row.inSlowFrames++;
        rows.set(record.type, row);
    }
    return [...rows.values()].map(row => ({ ...row, ms: round(row.ms) })).sort((a, b) => b.ms - a.ms);
}

function requestsOf(collector: TraceCollector, t0: number): RequestRow[] {
    const rows: RequestRow[] = [];
    for (const request of collector.requests.values()) {
        if (request.end == null || request.at < t0 || !/^https?:/.test(request.url)) continue;
        rows.push({
            at: ms(request.at - t0),
            ms: ms(request.end - request.at),
            route: short(request.url),
            kb: request.bytes == null ? null : round(request.bytes / 1024),
            status: request.status
        });
    }
    return rows.sort((a, b) => a.at - b.at);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/summary.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add summary.ts test/summary.test.ts && git commit -qm "Build the four summaries and the timeline"
```

---

### Task 7: Recorder

**Files:**
- Create: `workbench/recorder.ts`
- Test: `workbench/test/recorder.test.ts`

**Interfaces:**
- Consumes: `TraceEvent` (Task 1).
- Produces: `CATEGORIES: string[]`, `interface DebuggerLike` (Electron's `Debugger` subset: `attach`, `detach`, `isAttached`, `sendCommand`, `on("message")`, `removeListener("message")`), `class Recorder` with `constructor(dbg: DebuggerLike, tracePath: string, onEvents: (events: TraceEvent[]) => void)`, `start(): Promise<void>`, `stop(): Promise<void>`, `detach(): void`, and a public `dbg`.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { Recorder } from "../recorder";

class FakeDebugger extends EventEmitter {
    attached = false;
    failAttach = false;
    commands: string[] = [];

    attach() {
        if (this.failAttach) throw new Error("Another debugger is already attached");
        this.attached = true;
    }

    detach() {
        this.attached = false;
    }

    isAttached() {
        return this.attached;
    }

    async sendCommand(method: string) {
        this.commands.push(method);
        if (method === "Tracing.end") setImmediate(() => {
            this.emit("message", {}, "Tracing.dataCollected", { value: [{ name: "a", ph: "X", ts: 1, pid: 1, tid: 1 }, { name: "b", ph: "X", ts: 2, pid: 1, tid: 1 }] });
            this.emit("message", {}, "Tracing.dataCollected", { value: [{ name: "c", ph: "X", ts: 3, pid: 1, tid: 1 }] });
            this.emit("message", {}, "Tracing.tracingComplete", {});
        });
        return {};
    }
}

const folder = () => mkdtempSync(join(tmpdir(), "workbench-"));

test("streams every event to the callback and to a gzip trace", async () => {
    const dbg = new FakeDebugger();
    const path = join(folder(), "trace.json.gz");
    const seen: string[] = [];
    const recorder = new Recorder(dbg, path, events => seen.push(...events.map(event => event.name)));

    await recorder.start();
    await recorder.stop();
    recorder.detach();

    assert.deepEqual(seen, ["a", "b", "c"]);
    assert.deepEqual(JSON.parse(gunzipSync(readFileSync(path)).toString()).traceEvents.map((event: { name: string; }) => event.name), ["a", "b", "c"]);
    assert.deepEqual(dbg.commands, ["Tracing.start", "Tracing.end"]);
    assert.equal(dbg.attached, false);
    assert.equal(dbg.listenerCount("message"), 0);
});

test("a failed attach leaves nothing behind", async () => {
    const dbg = new FakeDebugger();
    dbg.failAttach = true;
    const path = join(folder(), "trace.json.gz");
    await assert.rejects(new Recorder(dbg, path, () => { }).start(), /already attached/);
    assert.equal(existsSync(path), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/recorder.test.ts`
Expected: FAIL, cannot find module `../recorder`.

- [ ] **Step 3: Write `recorder.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createWriteStream, WriteStream } from "fs";
import { finished } from "stream/promises";
import { createGzip, Gzip } from "zlib";

import { TraceEvent } from "./types";

export const CATEGORIES = [
    "toplevel",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.invalidationTracking",
    "disabled-by-default-devtools.timeline.stack",
    "v8.execute",
    "disabled-by-default-v8.cpu_profiler",
    "blink.user_timing",
    "loading"
];

type Listener = (event: unknown, method: string, params: any) => void;

export interface DebuggerLike {
    attach(protocolVersion: string): void;
    detach(): void;
    isAttached(): boolean;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<any>;
    on(event: "message", listener: Listener): unknown;
    removeListener(event: "message", listener: Listener): unknown;
}

export class Recorder {
    private gzip: Gzip | null = null;
    private file: WriteStream | null = null;
    private listener: Listener | null = null;
    private complete: Promise<void> | null = null;
    private written = 0;

    constructor(readonly dbg: DebuggerLike, private readonly tracePath: string, private readonly onEvents: (events: TraceEvent[]) => void) { }

    async start() {
        this.dbg.attach("1.3");
        const gzip = this.gzip = createGzip();
        this.file = gzip.pipe(createWriteStream(this.tracePath));
        gzip.write('{"traceEvents":[');

        this.complete = new Promise(resolve => {
            this.listener = (_event, method, params) => {
                if (method === "Tracing.dataCollected") this.take(params.value);
                else if (method === "Tracing.tracingComplete") resolve();
            };
            this.dbg.on("message", this.listener);
        });

        try {
            await this.dbg.sendCommand("Tracing.start", { traceConfig: { includedCategories: CATEGORIES }, transferMode: "ReportEvents" });
        } catch (err) {
            await this.close();
            this.detach();
            throw err;
        }
    }

    async stop() {
        await this.dbg.sendCommand("Tracing.end");
        await this.complete;
        await this.close();
    }

    detach() {
        if (this.dbg.isAttached()) this.dbg.detach();
    }

    private take(events: TraceEvent[]) {
        if (!events.length) return;
        this.onEvents(events);
        this.gzip!.write((this.written ? "," : "") + events.map(event => JSON.stringify(event)).join(","));
        this.written += events.length;
    }

    private async close() {
        if (this.listener) this.dbg.removeListener("message", this.listener);
        this.listener = null;
        if (!this.gzip || !this.file) return;
        this.gzip.end("]}");
        await finished(this.file);
        this.gzip = null;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/recorder.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add recorder.ts test/recorder.test.ts && git commit -qm "Record a trace through the debugger and stream it to disk"
```

---

### Task 8: Native side

**Files:**
- Create: `workbench/native.ts`

**Interfaces:**
- Consumes: `Recorder` (Task 7), `TraceCollector` (Task 5), `buildSummary`, `emptySummary` (Task 6), `SourceMapIndex` (Task 2), `Summary`, `RecordingInfo`, `WorkbenchState`, `FluxCapture` (Task 1).
- Produces (IPC, called as `Native.x` from the renderer): `start(): Promise<WorkbenchState>`, `stop(): Promise<string | null>` (the folder name), `armStartup(on: boolean): WorkbenchState`, `state(): WorkbenchState`, `list(): RecordingInfo[]`, `read(folder: string): Summary | null`. The page must expose `Vencord.Plugins.plugins.Workbench.takeFlux(): FluxCapture | null` and `onRecorded(folder: string): void` (Task 10).

This file is Electron glue and has no unit test. It is checked by `tsc`, the build, and Task 11.

- [ ] **Step 1: Write `native.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { app, IpcMainInvokeEvent, WebContents, webContents } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { Recorder } from "./recorder";
import { SourceMapIndex } from "./sourceMap";
import { buildSummary, emptySummary } from "./summary";
import { TraceCollector } from "./trace";
import { FluxCapture, RecordingInfo, Summary, WorkbenchState } from "./types";

const DIR = join(DATA_DIR, "workbench");
const FLAG = join(DIR, "next-startup");
const FOLDER = /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/;
const KEEP = 10;
const MANUAL_LIMIT = 60_000;
const STARTUP_LENGTH = 30_000;
const PATCHED_MODULES = 20;

interface Session {
    recorder: Recorder;
    collector: TraceCollector;
    folder: string;
    startedAt: Date;
    contents: WebContents;
    timer: ReturnType<typeof setTimeout>;
}

let session: Session | null = null;
let sourceMap: SourceMapIndex | null | undefined;

const pad = (value: number) => String(value).padStart(2, "0");
const folderName = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

function loadMap() {
    if (sourceMap !== undefined) return sourceMap;
    try {
        sourceMap = new SourceMapIndex(JSON.parse(readFileSync(join(__dirname, "renderer.js.map"), "utf8")));
    } catch {
        sourceMap = null;
    }
    return sourceMap;
}

function currentState(): WorkbenchState {
    return { recording: session != null, since: session?.startedAt.getTime() ?? null, armed: existsSync(FLAG) };
}

async function begin(contents: WebContents, limit: number) {
    if (session) return currentState();
    mkdirSync(DIR, { recursive: true });

    const startedAt = new Date();
    const folder = join(DIR, folderName(startedAt));
    mkdirSync(folder, { recursive: true });

    const collector = new TraceCollector();
    const recorder = new Recorder(contents.debugger, join(folder, "trace.json.gz"), events => collector.add(events));
    try {
        await recorder.start();
    } catch (err) {
        rmSync(folder, { recursive: true, force: true });
        throw err;
    }

    await contents.executeJavaScript('performance.mark("workbench-start")').catch(() => { });
    session = { recorder, collector, folder, startedAt, contents, timer: setTimeout(() => void finish(), limit) };
    return currentState();
}

async function annotatePatchedBy(current: Session, summary: Summary) {
    const wanted = new Set(summary.owners.filter(owner => owner.name.startsWith("Discord module ")).slice(0, PATCHED_MODULES).map(owner => owner.name.slice("Discord module ".length)));
    if (!wanted.size) return;

    const { dbg } = current.recorder;
    const scripts = new Map<string, string>();
    const listener = (_event: unknown, method: string, params: any) => {
        const id = method === "Debugger.scriptParsed" ? params.url?.match(/^file:\/\/\/WebpackModule(\w+)/)?.[1] : null;
        if (id && wanted.has(id)) scripts.set(id, params.scriptId);
    };

    dbg.on("message", listener);
    try {
        await dbg.sendCommand("Debugger.enable");
        await new Promise(resolve => setImmediate(resolve));
        for (const owner of summary.owners) {
            const scriptId = scripts.get(owner.name.slice("Discord module ".length));
            if (!scriptId) continue;
            const { scriptSource } = await dbg.sendCommand("Debugger.getScriptSource", { scriptId });
            owner.patchedBy = scriptSource.match(/Patched by ([^\n]+)/)?.[1].split(", ") ?? [];
        }
        await dbg.sendCommand("Debugger.disable");
    } finally {
        dbg.removeListener("message", listener);
    }
}

function prune() {
    const folders = readdirSync(DIR).filter(name => FOLDER.test(name)).sort().reverse();
    for (const name of folders.slice(KEEP)) rmSync(join(DIR, name), { recursive: true, force: true });
}

async function finish() {
    const current = session;
    if (!current) return null;
    session = null;
    clearTimeout(current.timer);

    let summary: Summary;
    try {
        await current.recorder.stop();
        const flux: FluxCapture | null = await current.contents.executeJavaScript("Vencord.Plugins.plugins.Workbench?.takeFlux?.() ?? null").catch(() => null);
        summary = buildSummary(current.collector, { map: loadMap(), flux, startedAt: current.startedAt });
        await annotatePatchedBy(current, summary).catch(() => { });
    } catch (err) {
        summary = emptySummary(current.startedAt, String(err));
    } finally {
        current.recorder.detach();
    }

    const name = folderName(current.startedAt);
    writeFileSync(join(current.folder, "summary.json"), JSON.stringify(summary));
    prune();
    await current.contents.executeJavaScript(`Vencord.Plugins.plugins.Workbench?.onRecorded?.(${JSON.stringify(name)})`).catch(() => { });
    return name;
}

export function start(event: IpcMainInvokeEvent) {
    return begin(event.sender, MANUAL_LIMIT);
}

export function stop() {
    return finish();
}

export function armStartup(_: IpcMainInvokeEvent, on: boolean) {
    mkdirSync(DIR, { recursive: true });
    if (on) writeFileSync(FLAG, "");
    else rmSync(FLAG, { force: true });
    return currentState();
}

export function state() {
    return currentState();
}

export function list(): RecordingInfo[] {
    if (!existsSync(DIR)) return [];
    return readdirSync(DIR).filter(name => FOLDER.test(name)).sort().reverse().flatMap(folder => {
        try {
            const summary: Summary = JSON.parse(readFileSync(join(DIR, folder, "summary.json"), "utf8"));
            return [{ folder, startedAt: summary.startedAt, durationMs: summary.durationMs, busyMs: summary.busyMs, error: summary.error }];
        } catch {
            return [];
        }
    });
}

export function read(_: IpcMainInvokeEvent, folder: string): Summary | null {
    if (!FOLDER.test(folder)) return null;
    try {
        return JSON.parse(readFileSync(join(DIR, folder, "summary.json"), "utf8"));
    } catch {
        return null;
    }
}

function watch(contents: WebContents) {
    contents.on("did-start-loading", () => {
        if (session || !existsSync(FLAG) || !/discord\.com/.test(contents.getURL())) return;
        rmSync(FLAG, { force: true });
        void begin(contents, STARTUP_LENGTH).catch(() => { });
    });
}

app.on("web-contents-created", (_, contents) => watch(contents));
for (const contents of webContents.getAllWebContents()) watch(contents);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep -i workbench`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd src/userplugins/workbench && git add native.ts && git commit -qm "Run recordings from the main process"
```

---

### Task 9: Timeline filters

**Files:**
- Create: `workbench/view.ts`
- Test: `workbench/test/view.test.ts`

**Interfaces:**
- Consumes: `Summary`, `OwnerRow`, `EventRow`, `FluxRecord` (Task 1).
- Produces: `BUCKET_MS = 100`, `windowOf(bucket: number | null): [number, number] | null`, `overlaps(at: number, ms: number, window: [number, number] | null): boolean`, `ownersIn(summary: Summary, bucket: number | null): OwnerRow[]`, `eventsIn(summary: Summary, window: [number, number] | null): EventRow[]`.

- [ ] **Step 1: Write the failing test**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { emptySummary } from "../summary";
import { eventsIn, overlaps, ownersIn, windowOf } from "../view";

const summary = {
    ...emptySummary(new Date(0)),
    timeline: [50, 20],
    owners: [{ name: "a", kind: "plugin" as const, ms: 40, share: 57, functions: [] }, { name: "b", kind: "discord" as const, ms: 30, share: 43, functions: [] }],
    ownerBuckets: { a: [40, 0], b: [10, 20] },
    events: [{ type: "X", count: 2, ms: 4, inSlowFrames: 0 }],
    flux: [{ type: "X", at: 10, ms: 1 }, { type: "X", at: 150, ms: 3 }]
};

test("a bucket is a 100ms window", () => {
    assert.equal(windowOf(null), null);
    assert.deepEqual(windowOf(3), [300, 400]);
});

test("rows overlap a window when any part of them is inside it", () => {
    assert.equal(overlaps(50, 100, [100, 200]), true);
    assert.equal(overlaps(250, 10, [100, 200]), false);
    assert.equal(overlaps(1, 1, null), true);
});

test("owners in a bucket come from that bucket only", () => {
    assert.deepEqual(ownersIn(summary, null), summary.owners);
    assert.deepEqual(ownersIn(summary, 1).map(owner => [owner.name, owner.ms, owner.share]), [["b", 20, 100]]);
});

test("events in a window are regrouped from the Flux list", () => {
    assert.deepEqual(eventsIn(summary, null), summary.events);
    assert.deepEqual(eventsIn(summary, [100, 200]), [{ type: "X", count: 1, ms: 3, inSlowFrames: 0 }]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/userplugins/workbench/test/view.test.ts`
Expected: FAIL, cannot find module `../view`.

- [ ] **Step 3: Write `view.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EventRow, OwnerRow, Summary } from "./types";

export const BUCKET_MS = 100;

export type Window = [number, number];

export function windowOf(bucket: number | null): Window | null {
    return bucket == null ? null : [bucket * BUCKET_MS, (bucket + 1) * BUCKET_MS];
}

export function overlaps(at: number, ms: number, range: Window | null) {
    return !range || (at < range[1] && at + ms > range[0]);
}

export function ownersIn(summary: Summary, bucket: number | null): OwnerRow[] {
    if (bucket == null) return summary.owners;
    const busy = summary.timeline[bucket] ?? 0;
    return summary.owners
        .map(owner => ({ ...owner, ms: summary.ownerBuckets[owner.name]?.[bucket] ?? 0 }))
        .filter(owner => owner.ms > 0)
        .map(owner => ({ ...owner, share: busy ? Math.round(owner.ms / busy * 1000) / 10 : 0 }))
        .sort((a, b) => b.ms - a.ms);
}

export function eventsIn(summary: Summary, range: Window | null): EventRow[] {
    if (!range) return summary.events;
    const rows = new Map<string, EventRow>();
    for (const record of summary.flux) {
        if (!overlaps(record.at, record.ms, range)) continue;
        const row = rows.get(record.type) ?? { type: record.type, count: 0, ms: 0, inSlowFrames: 0 };
        row.count++;
        row.ms = Math.round((row.ms + record.ms) * 10) / 10;
        rows.set(record.type, row);
    }
    return [...rows.values()].sort((a, b) => b.ms - a.ms);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/userplugins/workbench/test/view.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd src/userplugins/workbench && git add view.ts test/view.test.ts && git commit -qm "Filter the summary to a timeline window"
```

---

### Task 10: Renderer: Flux capture, state, drawer and hotkeys

**Files:**
- Create: `workbench/flux.ts`, `workbench/store.ts`, `workbench/Timeline.tsx`, `workbench/tables.tsx`, `workbench/Drawer.tsx`, `workbench/style.css`
- Modify: `workbench/index.tsx` (replace the stub)

**Interfaces:**
- Consumes: the IPC functions from Task 8 through `VencordNative.pluginHelpers.Workbench`, `ownersIn`, `eventsIn`, `overlaps`, `windowOf` (Task 9), types (Task 1).
- Produces: plugin methods `takeFlux()` and `onRecorded(folder)` used by `native.ts`.

- [ ] **Step 1: Write `flux.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher } from "@webpack/common";

import { FluxCapture, FluxRecord } from "./types";

interface ActionLogger {
    on(event: string, listener: () => void): void;
    off(event: string, listener: () => void): void;
}

let records: FluxRecord[] | null = null;
let current: { type: string; at: number; } | null = null;
let markAt = 0;

const logger = () => (FluxDispatcher as any).actionLogger as ActionLogger;

function begin(action: { type: string; }) {
    current = { type: action.type, at: performance.now() };
    return false;
}

function end() {
    if (records && current) records.push({ type: current.type, at: current.at, ms: performance.now() - current.at });
    current = null;
}

export function startFlux() {
    if (records) return;
    records = [];
    performance.mark("workbench-flux");
    markAt = performance.now();
    FluxDispatcher.addInterceptor(begin);
    logger().on("log", end);
}

export function takeFlux(): FluxCapture | null {
    if (!records) return null;
    const taken = { records, markAt };
    records = null;
    const interceptors: unknown[] = (FluxDispatcher as any)._interceptors;
    interceptors.splice(interceptors.indexOf(begin), 1);
    logger().off("log", end);
    return taken;
}
```

- [ ] **Step 2: Write `store.ts`**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { startFlux } from "./flux";
import { RecordingInfo, Summary, WorkbenchState } from "./types";

export const Native = VencordNative.pluginHelpers.Workbench as PluginNative<typeof import("./native")>;

export type Tab = "owners" | "restyles" | "frames" | "events";

export const view = {
    open: false,
    state: { recording: false, since: null, armed: false } as WorkbenchState,
    recordings: [] as RecordingInfo[],
    selected: null as string | null,
    summary: null as Summary | null,
    bucket: null as number | null,
    tab: "owners" as Tab,
    building: false,
    error: null as string | null
};

const listeners = new Set<() => void>();

export function update(patch: Partial<typeof view>) {
    Object.assign(view, patch);
    for (const listener of listeners) listener();
}

export function useView() {
    const [, bump] = useState(0);
    useEffect(() => {
        const listener = () => bump(n => n + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
    return view;
}

const messageOf = (err: unknown) => String(err instanceof Error ? err.message : err).split("Error: ").pop()!;

export async function select(folder: string) {
    update({ selected: folder, summary: await Native.read(folder), bucket: null });
}

export async function refresh() {
    const [state, recordings] = await Promise.all([Native.state(), Native.list()]);
    update({ state, recordings });
    if (!view.selected && recordings[0]) await select(recordings[0].folder);
}

export async function toggleRecording() {
    if (view.building) return;
    if (!view.state.recording) {
        try {
            update({ state: await Native.start(), error: null });
            startFlux();
        } catch (err) {
            update({ error: messageOf(err) });
        }
        return;
    }

    update({ building: true });
    try {
        await Native.stop();
    } catch (err) {
        update({ error: messageOf(err) });
    }
    update({ building: false });
    await refresh();
}

export async function onRecorded(folder: string) {
    update({ building: false });
    await refresh();
    await select(folder);
}

export async function toggleArmed() {
    update({ state: await Native.armStartup(!view.state.armed) });
}
```

- [ ] **Step 3: Write `Timeline.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

import { update } from "./store";
import { Summary } from "./types";
import { BUCKET_MS } from "./view";

const cl = classNameFactory("vc-workbench-");

export function Timeline({ summary, bucket }: { summary: Summary; bucket: number | null; }) {
    const slow = new Set(summary.slowBuckets);
    return (
        <div className={cl("timeline")}>
            {summary.timeline.map((ms, index) => (
                <button
                    key={index}
                    className={cl("bucket", { "bucket-slow": slow.has(index), "bucket-picked": bucket === index })}
                    style={{ height: `${Math.max(2, Math.min(100, ms / BUCKET_MS * 100))}%` }}
                    aria-label={`${index * BUCKET_MS}ms, ${ms}ms busy`}
                    onClick={() => update({ bucket: bucket === index ? null : index })}
                />
            ))}
        </div>
    );
}
```

- [ ] **Step 4: Write `tables.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, useState } from "@webpack/common";

import { Summary } from "./types";
import { eventsIn, overlaps, ownersIn, Window } from "./view";

const cl = classNameFactory("vc-workbench-");

const msText = (ms: number) => `${ms.toLocaleString("en-GB")}ms`;

export function Owners({ summary, bucket }: { summary: Summary; bucket: number | null; }) {
    const [openRow, setOpenRow] = useState<string | null>(null);
    return (
        <table className={cl("table")}>
            <tbody>
                {ownersIn(summary, bucket).map(owner => (
                    <React.Fragment key={owner.name}>
                    <tr className={cl("row")} onClick={() => setOpenRow(openRow === owner.name ? null : owner.name)}>
                        <td>{owner.name}{owner.patchedBy?.length ? <span className={cl("dim")}> patched by {owner.patchedBy.join(", ")}</span> : null}</td>
                        <td className={cl("num")}>{msText(owner.ms)}</td>
                        <td className={cl("dim")}>{owner.share}%</td>
                    </tr>
                    {openRow === owner.name && owner.functions.map(fn => (
                        <tr key={`${owner.name}|${fn.name}|${fn.where}`} className={cl("sub")}>
                            <td>{fn.name} <span className={cl("dim")}>{fn.where}</span></td>
                            <td className={cl("num")}>{msText(fn.ms)}</td>
                            <td />
                        </tr>
                    ))}
                    </React.Fragment>
                ))}
            </tbody>
        </table>
    );
}

export function Restyles({ summary, range }: { summary: Summary; range: Window | null; }) {
    const rows = summary.restyles.filter(row => overlaps(row.at, row.ms, range));
    return (
        <>
            {!range && (
                <table className={cl("table")}>
                    <tbody>
                        {summary.restyleGroups.map(group => (
                            <tr key={group.cause}>
                                <td>{group.cause}</td>
                                <td className={cl("num")}>{group.count}x</td>
                                <td className={cl("dim")}>{msText(group.avgMs)} each</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <table className={cl("table")}>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index}>
                            <td className={cl("dim")}>{msText(row.at)}</td>
                            <td className={cl("num")}>{msText(row.ms)}</td>
                            <td className={cl("dim")}>{row.elements} el</td>
                            <td>{row.cause}{row.by && <span className={cl("dim")}> by {row.by}</span>}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}

export function Frames({ summary, range }: { summary: Summary; range: Window | null; }) {
    return (
        <table className={cl("table")}>
            <tbody>
                {summary.frames.filter(frame => overlaps(frame.at, frame.ms, range)).map(frame => (
                    <tr key={frame.at}>
                        <td className={cl("dim")}>{msText(frame.at)}</td>
                        <td className={cl("num")}>{msText(frame.ms)}</td>
                        <td>{frame.start}</td>
                        <td className={cl("dim")}>{frame.split.map(part => `${part.name} ${msText(part.ms)}`).join(", ")}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function EventsAndNetwork({ summary, range }: { summary: Summary; range: Window | null; }) {
    const requests = summary.requests.filter(row => overlaps(row.at, row.ms, range));
    return (
        <div className={cl("columns")}>
            <table className={cl("table")}>
                <tbody>
                    {eventsIn(summary, range).map(row => (
                        <tr key={row.type}>
                            <td>{row.type}</td>
                            <td className={cl("num")}>{row.count}x</td>
                            <td className={cl("dim")}>{msText(row.ms)}{row.inSlowFrames ? `, ${row.inSlowFrames} in slow frames` : ""}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <table className={cl("table")}>
                <tbody>
                    {summary.rateLimited.map(route => (
                        <tr key={`429 ${route}`}><td className={cl("num")}>429</td><td colSpan={3}>{route}</td></tr>
                    ))}
                    {summary.chains.map(chain => (
                        <tr key={`chain ${chain.route}`}><td className={cl("num")}>one at a time</td><td colSpan={3}>{chain.count} requests, {msText(chain.ms)} ({msText(chain.between)} waiting) {chain.route}</td></tr>
                    ))}
                    {requests.map(row => (
                        <tr key={`${row.at} ${row.route}`}>
                            <td className={cl("dim")}>{msText(row.at)}</td>
                            <td className={cl("num")}>{msText(row.ms)}</td>
                            <td className={cl("dim")}>{row.status ?? ""}{row.kb != null ? ` ${row.kb}kb` : ""}</td>
                            <td>{row.route}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
```

- [ ] **Step 5: Write `Drawer.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { useEffect, useState } from "@webpack/common";

import { select, Tab, toggleArmed, toggleRecording, update, useView } from "./store";
import { EventsAndNetwork, Frames, Owners, Restyles } from "./tables";
import { Timeline } from "./Timeline";
import { windowOf } from "./view";

const cl = classNameFactory("vc-workbench-");

const TABS: [Tab, string][] = [["owners", "Owners"], ["restyles", "Restyles"], ["frames", "Frames"], ["events", "Events and network"]];

function useElapsed(since: number | null) {
    const [, bump] = useState(0);
    useEffect(() => {
        if (since == null) return;
        const timer = setInterval(() => bump(n => n + 1), 1000);
        return () => clearInterval(timer);
    }, [since]);
    return since == null ? 0 : Math.round((Date.now() - since) / 1000);
}

function Body() {
    const { summary, bucket, tab, building, state } = useView();
    if (building) return <div className={cl("note")}>Building the summary</div>;
    if (!summary) return <div className={cl("note")}>{state.recording ? "Recording" : "Press F10 or Record to start"}</div>;
    if (summary.error) return <div className={cl("note")}>{summary.error}</div>;

    const range = windowOf(bucket);
    return (
        <>
            <Timeline summary={summary} bucket={bucket} />
            <div className={cl("tabs")}>
                {TABS.map(([id, label]) => (
                    <button key={id} className={cl("tab", { "tab-active": tab === id })} onClick={() => update({ tab: id })}>{label}</button>
                ))}
                <span className={cl("dim", "totals")}>{summary.busyMs.toLocaleString("en-GB")}ms busy of {summary.durationMs.toLocaleString("en-GB")}ms</span>
            </div>
            <div className={cl("content")}>
                {tab === "owners" && <Owners summary={summary} bucket={bucket} />}
                {tab === "restyles" && <Restyles summary={summary} range={range} />}
                {tab === "frames" && <Frames summary={summary} range={range} />}
                {tab === "events" && <EventsAndNetwork summary={summary} range={range} />}
            </div>
        </>
    );
}

export function Drawer() {
    const { open, state, recordings, selected, error } = useView();
    const elapsed = useElapsed(state.since);
    if (!open) return null;

    return (
        <div className={cl("drawer")}>
            <div className={cl("bar")}>
                <span className={cl("name")}>Workbench</span>
                <button className={cl("record")} onClick={() => void toggleRecording()}>{state.recording ? `Stop ${elapsed}s` : "Record"}</button>
                <button className={cl("toggle")} onClick={() => void toggleArmed()}>Next startup: {state.armed ? "on" : "off"}</button>
                {recordings.length > 0 && (
                    <select className={cl("select")} value={selected ?? ""} onChange={e => void select(e.currentTarget.value)}>
                        {recordings.map(recording => (
                            <option key={recording.folder} value={recording.folder}>{recording.folder.replace("_", " ").replace(/-(\d\d)-(\d\d)$/, ":$1:$2")}, {Math.round(recording.busyMs)}ms busy</option>
                        ))}
                    </select>
                )}
                {error && <span className={cl("error")}>{error}</span>}
                <span className={cl("dim", "keys")}>F9 close, F10 record</span>
            </div>
            <Body />
        </div>
    );
}
```

- [ ] **Step 6: Write `style.css`**

```css
.vc-workbench-drawer {
    position: fixed;
    inset: auto 0 0;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    height: 40vh;
    background: #000;
    color: #fff;
    border-top: 2px solid #ff5c00;
    font: 500 12px/1.5 ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}

.vc-workbench-drawer button,
.vc-workbench-drawer select {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid #333;
    border-radius: 0;
    padding: 1px 8px;
    cursor: pointer;
}

.vc-workbench-bar,
.vc-workbench-tabs {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid #333;
}

.vc-workbench-name,
.vc-workbench-num,
.vc-workbench-error {
    color: #ff5c00;
}

.vc-workbench-drawer .vc-workbench-record {
    border-color: #ff5c00;
    color: #ff5c00;
}

.vc-workbench-dim {
    color: #8a8a8a;
}

.vc-workbench-keys,
.vc-workbench-totals {
    margin-left: auto;
}

.vc-workbench-drawer .vc-workbench-tab {
    border: 0;
    color: #8a8a8a;
}

.vc-workbench-drawer .vc-workbench-tab-active {
    background: #ff5c00;
    color: #000;
}

.vc-workbench-timeline {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 32px;
    padding: 4px 10px;
    border-bottom: 1px solid #333;
}

.vc-workbench-drawer .vc-workbench-bucket {
    flex: 1 1 0;
    min-width: 1px;
    padding: 0;
    border: 0;
    background: #555;
}

.vc-workbench-drawer .vc-workbench-bucket-slow {
    background: #ff5c00;
}

.vc-workbench-drawer .vc-workbench-bucket-picked {
    outline: 1px solid #fff;
}

.vc-workbench-content {
    flex: 1;
    overflow: auto;
}

.vc-workbench-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}

.vc-workbench-table {
    width: 100%;
    border-collapse: collapse;
}

.vc-workbench-table td {
    padding: 1px 10px;
    white-space: nowrap;
    vertical-align: top;
}

.vc-workbench-table td.vc-workbench-num {
    text-align: right;
}

.vc-workbench-row {
    cursor: pointer;
}

.vc-workbench-row:hover {
    background: #111;
}

.vc-workbench-sub td:first-child {
    padding-left: 24px;
}

.vc-workbench-note {
    padding: 10px;
    color: #8a8a8a;
}
```

- [ ] **Step 7: Replace `index.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import definePlugin from "@utils/types";
import { createRoot } from "@webpack/common";

import { Drawer } from "./Drawer";
import { startFlux, takeFlux } from "./flux";
import { Native, onRecorded, refresh, toggleRecording, update, view } from "./store";

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

function onKey(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    if (event.code === "F9") {
        event.preventDefault();
        update({ open: !view.open });
        if (view.open) void refresh();
    } else if (event.code === "F10") {
        event.preventDefault();
        void toggleRecording();
    }
}

export default definePlugin({
    name: "Workbench",
    description: "Records what Discord spends its time on and shows it in a drawer. F9 opens the drawer, F10 starts and stops a recording.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    takeFlux,
    onRecorded,

    async start() {
        window.addEventListener("keydown", onKey, true);
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        root.render(<Drawer />);

        const state = await Native.state();
        update({ state });
        if (state.recording) startFlux();
    },

    stop() {
        window.removeEventListener("keydown", onKey, true);
        takeFlux();
        root?.unmount();
        container?.remove();
        root = null;
        container = null;
        update({ open: false });
    }
});
```

- [ ] **Step 8: Typecheck, lint and build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -i workbench; npx eslint src/userplugins/workbench; pnpm build`
Expected: no workbench errors, `Done`.

- [ ] **Step 9: Run every test**

Run: `npx tsx --test src/userplugins/workbench/test/*.test.ts`
Expected: all passing.

- [ ] **Step 10: Commit**

```bash
cd src/userplugins/workbench && git add -A && git commit -qm "Add the drawer, hotkeys and Flux capture"
```

---

### Task 11: Live check and the real fixture

Needs a full Discord restart (the native side only loads at startup). The user does the restart. ProbeDeck also listens for F9, so turn ProbeDeck off first.

**Files:**
- Create: `workbench/test/fixture.json.gz`, `workbench/test/fixture-positions.json`, `workbench/test/fixture.test.ts`, `workbench/test/makeFixture.ts`

- [ ] **Step 1: Record once by hand.** After the restart: F9 opens the drawer, F10 starts, switch a channel, open a popout, F10 stops. Expected: "Building the summary", then the tabs fill. `summary.json` and `trace.json.gz` exist in the newest folder under `%APPDATA%\Equicord\workbench`.

- [ ] **Step 2: Check the event shapes the parsers assume**

```bash
node -e "
const events=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(process.argv[1])).toString()).traceEvents;
const one=n=>JSON.stringify(events.find(e=>e.name===n)??null).slice(0,600);
for (const n of ['RunTask','UpdateLayoutTree','StyleInvalidatorInvalidationTracking','StyleRecalcInvalidationTracking','ProfileChunk','ResourceFinish','TracingStartedInBrowser','workbench-start','workbench-flux']) console.log(n, one(n));
" "$APPDATA/Equicord/workbench/<newest folder>/trace.json.gz"
```

Check against `trace.ts`: `UpdateLayoutTree` element count location, invalidation `data` field names, and whether stack frame `lineNumber` is 1-based (then `summary.ts` `describe()` is right) or 0-based (then drop the `- 1`). Fix any mismatch in `trace.ts` or `summary.ts` and add a test case to `trace.test.ts` with the real shape.

- [ ] **Step 3: Write `makeFixture.ts`** (copies the newest trace and stores the map lookups it needs, so the fixture test doesn't depend on the current build's map)

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { RENDERER_URL } from "../attribution";
import { SourceMapIndex } from "../sourceMap";
import { TraceEvent } from "../types";

const dir = join(process.env.APPDATA!, "Equicord", "workbench");
const newest = readdirSync(dir).filter(name => /^\d{4}-/.test(name)).sort().pop()!;
const source = join(dir, newest, "trace.json.gz");
copyFileSync(source, join(__dirname, "fixture.json.gz"));

const map = new SourceMapIndex(JSON.parse(readFileSync(join(process.cwd(), "dist/desktop/renderer.js.map"), "utf8")));
const events: TraceEvent[] = JSON.parse(gunzipSync(readFileSync(source)).toString()).traceEvents;
const positions: Record<string, unknown> = {};
for (const event of events) {
    for (const node of event.args?.data?.cpuProfile?.nodes ?? []) {
        const { url, lineNumber, columnNumber } = node.callFrame;
        if (url === RENDERER_URL) positions[`${lineNumber}:${columnNumber}`] = map.lookup(lineNumber, columnNumber);
    }
}
writeFileSync(join(__dirname, "fixture-positions.json"), JSON.stringify(positions));
console.log(newest, Object.keys(positions).length, "renderer positions");
```

Run: `npx tsx src/userplugins/workbench/test/makeFixture.ts`
Expected: the folder name and a count of positions.

- [ ] **Step 4: Write `fixture.test.ts`** (the spec's four checks)

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { buildSummary } from "../summary";
import { TraceCollector } from "../trace";

const file = join(__dirname, "fixture.json.gz");
const skip = !existsSync(file);

function summarise() {
    const positions = JSON.parse(readFileSync(join(__dirname, "fixture-positions.json"), "utf8"));
    const map = { lookup: (line: number, column: number) => positions[`${line}:${column}`] ?? null };
    const collector = new TraceCollector();
    collector.add(JSON.parse(gunzipSync(readFileSync(file)).toString()).traceEvents);
    return buildSummary(collector, { map, flux: null, startedAt: new Date(0) });
}

test("owners add up to busy time within 1%", { skip }, () => {
    const summary = summarise();
    assert.ok(summary.busyMs > 0);
    const total = summary.owners.reduce((sum, owner) => sum + owner.ms, 0);
    assert.ok(Math.abs(total - summary.busyMs) <= summary.busyMs * 0.01, `${total} vs ${summary.busyMs}`);
});

test("the timeline adds up to the same total", { skip }, () => {
    const summary = summarise();
    const total = summary.timeline.reduce((sum, ms) => sum + ms, 0);
    assert.ok(Math.abs(total - summary.busyMs) <= summary.busyMs * 0.01, `${total} vs ${summary.busyMs}`);
});

test("every restyle has a cause or says unknown", { skip }, () => {
    for (const row of summarise().restyles) assert.ok(row.cause.length > 0);
});

test("Equicord and plugin code is attributed through the map", { skip }, () => {
    const kinds = new Set(summarise().owners.map(owner => owner.kind));
    assert.ok(kinds.has("equicord") || kinds.has("plugin"));
    assert.ok(kinds.has("discord"));
});
```

- [ ] **Step 5: Run every test**

Run: `npx tsx --test src/userplugins/workbench/test/*.test.ts`
Expected: all passing. If an invariant fails, the parser is double counting or missing events: find which owner or bucket is off, fix `summary.ts`, and rerun.

- [ ] **Step 6: Check "record next startup".** Arm it in the drawer, reload, wait 30s. Expected: a new recording whose timeline starts at the reload, with the patcher visible under Owners.

- [ ] **Step 7: Commit**

```bash
cd src/userplugins/workbench && git add -A && git commit -qm "Test the summary against a real recording"
```

---

### Task 12: README and publishing

- [ ] **Step 1: Write `README.md`**: what it does, install (clone into `src/userplugins/workbench`, `pnpm build`, full restart), F9 and F10, "next startup", where files go, what each tab shows, and that ProbeDeck should be off because both use F9.
- [ ] **Step 2: Add Workbench to `_setup.sh`** in the userplugins repo (`workbench https://github.com/Just-Me-22/Workbench.git`) and commit.
- [ ] **Step 3: Ask the user** before creating the GitHub repo (public or private) and before pushing any of the three repos.
