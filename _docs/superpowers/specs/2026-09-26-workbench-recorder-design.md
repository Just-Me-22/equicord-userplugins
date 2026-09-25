# Workbench: recorder

Workbench is a userplugin that replaces ProbeDeck and, over time, the need to open
DevTools. This spec covers the first piece: recording what Discord spends its time on
and showing it in Discord's own window. The command box, the command bridge, the
inspector and the move of ProbeDeck's lenses each get their own spec later.

## Why

Tonight's startup freeze was only explained by a DevTools Performance recording:
Equicord's patcher (`patchFactory`) took 3.0s of self time. Page code can't see that.
LoAF entries have no function names, and "busy, no script named" freezes stayed
unexplained for days. Workbench gets the same data DevTools gets, without opening
DevTools, and says which plugin, Equicord part, Discord module or rendering step owns
the time.

## How it gets the data

The native side (Electron main process) attaches Chromium's debugger to Discord's own
window with `webContents.debugger` and uses the tracing domain. This was tested on
2026-09-26: it attaches with DevTools closed and with DevTools open, and a 2s trace
returned 13,879 events, 109 CPU sample chunks, 116 restyles and 259 invalidation
records. No port is opened and nothing outside Discord can connect. The debugger is
attached only while recording and detached afterwards.

Trace categories: `devtools.timeline`, `disabled-by-default-devtools.timeline`,
`disabled-by-default-devtools.timeline.invalidationTracking`, `v8.execute`,
`disabled-by-default-v8.cpu_profiler`, `blink.user_timing`, `loading`.

The trace is returned as a gzip stream (`transferMode: "ReturnAsStream"`,
`streamCompression: "gzip"`) and written straight to disk, so a long recording never
sits in the renderer's memory.

## Files

| File | Runs in | Job |
|---|---|---|
| `workbench/native.ts` | main process | attach, trace, stream to disk, start the summary worker, startup recording |
| `workbench/summaryWorker.ts` | a worker thread in main | read the trace, run attribution and the summaries, write `summary.json` |
| `workbench/attribution.ts` | worker | decide the owner of each sample and event |
| `workbench/summary.ts` | worker | build the four summaries |
| `workbench/index.tsx` | renderer | hotkeys, Flux event capture, the drawer |
| `workbench/Drawer.tsx`, `Timeline.tsx`, `tables.tsx` | renderer | the UI |

The summary runs in a worker thread so parsing a big trace blocks neither Discord's
page nor Electron's main process.

## Recording

- **F10** or the Record button starts a recording. Pressing either again stops it. It
  stops by itself after 60s.
- **Record next startup** is a toggle in the drawer's bar. It writes a flag file
  (`workbench/next-startup`). The native side watches Discord's window, and when the
  page starts loading with the flag present it starts tracing, deletes the flag and
  stops 30s later. One use per arm.
- While recording, the renderer also logs Discord's Flux events (type, start, duration,
  stores over 2ms), the same way FreezeLog does. To line up the two clocks it puts a
  `performance.mark("workbench-start")` into the page at the start, which shows up in
  the trace.
- Idle, Workbench does nothing: no observers, no debugger, no timers.

## Output

Each recording gets a folder `%APPDATA%\Equicord\workbench\<date>_<time>\` (for
example `2026-09-26_01-30-12`, with no colons because Windows doesn't allow them) with:

- `trace.json.gz`: the raw trace. DevTools can load it.
- `summary.json`: everything the drawer shows. This is the file Claude reads.

Only the 10 newest folders are kept.

## Attribution

Each CPU sample's self time goes to the owner of its top frame:

| The frame's URL | Owner |
|---|---|
| Equicord's renderer script, mapped through `dist/desktop/renderer.js.map` to `src/userplugins/X`, `src/equicordplugins/X` or `src/plugins/X` | plugin X |
| the same, mapped to `src/webpack/patchWebpack.ts` | Equicord patcher |
| the same, mapped anywhere else under `src/` | Equicord core |
| `file:///WebpackModule<id>` | Discord module `<id>`, patched by the plugins named in its `// Webpack Module <id> - Patched by …` header |
| `*.discord.com/assets/…` | Discord |
| `(garbage collector)` | Chromium: garbage collection |
| `(program)`, `(idle)` | not counted as busy |

Rendering time comes from trace events and is split into Chromium style
(`UpdateLayoutTree`), layout (`Layout`), paint (`Paint`, `PrePaint`) and compositing
(`Layerize`, `Commit`), plus script compile (`v8.compile`, `CompileScript`).

Patched-module headers are read with `Debugger.getScriptSource`, only for the 20
modules with the most time, while still attached at the end of the recording.

## The four summaries

1. **Time by owner.** Owners sorted by time, with a share of busy time. Each opens to
   its 10 top functions with file and line.
2. **Restyles.** One row per `UpdateLayoutTree`: time, duration, element count, and the
   first invalidation before it (class change on which element and which class,
   attribute change, stylesheet added or changed, nodes inserted under which element),
   with the JS function and owner that caused it when the trace has a stack. Identical
   causes are grouped with a count and the average cost.
3. **Slowest frames.** The 20 longest main-thread tasks over 50ms: what started each
   (input event, timer, React scheduler, gateway message, idle callback, script load)
   and its split into script by owner, style, layout, paint and GC.
4. **Events and network.** Flux events: count and total time per type, and which ones
   landed inside a slow frame. Requests from `ResourceSendRequest`, `ResourceReceiveResponse` and
   `ResourceFinish`: shortened URL (FreezeLog's `short()` rules), time, size, status,
   plus FreezeLog's single-file chain and rate-limit flags.

## The drawer

- **F9** opens and closes it. It sits at the bottom, full width, over the chat.
- Look: ProbeDeck's. Black background, white text, `#ff5c00` accent, `#333` lines,
  square corners, monospace, no shadow.
- **Bar:** the name, Record/Stop with the elapsed time, the next-startup toggle, and a
  list of the saved recordings.
- **Timeline:** busy time per 100ms. Buckets holding a slow frame are orange. Clicking a
  bucket narrows all four tabs to that window, and clicking it again clears the filter.
- **Tabs:** Owners, Restyles, Frames, Events and network.
- **States:** before the first recording the drawer says "Press F10 or Record to start".
  While the summary builds it says "Building the summary". If the debugger can't
  attach, it shows the reason and nothing records. If the summary fails, the raw trace
  is kept and the error is shown and saved in `summary.json`.

## Cost

Idle: nothing. Recording: about what a DevTools recording costs, only while it runs.
Summary: off both of Discord's threads.

## Testing

The first real recording is saved as a fixture (`workbench/test/fixture.json.gz`). A
node script under `workbench/test/` checks against it that:

- known functions land on the right owner (`patchFactory` on Equicord patcher, a
  `$self` function on its plugin)
- every restyle gets a cause or an explicit "unknown"
- owner totals add up to the trace's busy time within 1%
- the timeline's buckets add up to the same total

## Not in this spec

The command box and the off-by-default bridge, the inspector with winning CSS rules,
and moving ProbeDeck's lenses. ProbeDeck also uses F9, so it gets turned off when
Workbench ships.
