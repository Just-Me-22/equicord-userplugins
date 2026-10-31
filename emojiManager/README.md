# EmojiManager

One window for the emoji and stickers of every server you're in. Select as many as you like,
drag them onto another server, and they move there.

- **Server rail** with free slots for static emoji, animated emoji and stickers on each server
- **Select** with click, Ctrl-click, Shift-click for a range, or drag a box over empty space. Ctrl+A selects everything, Delete removes the selection
- **Drag onto a server** to move. Hold Ctrl or Alt to copy instead. The server you're over says whether everything fits
- **Review before anything happens**: move or copy, where to send what doesn't fit, and which names get a number because they're taken
- **History** keeps a copy of everything moved or deleted, so it can be put back on the server it came from
- **Runs in the background**, so closing the window doesn't stop a big move. When Discord asks to wait, it waits and shows a countdown

A move uploads the copy first and deletes the original only once that worked.

Moving out of a server needs Manage Expressions there; without it you can still copy. Slot
counts follow the server's boost level, and Discord's own refusal is shown if they're ever off.

## Install

This is a userplugin, so it needs Equicord built from source.

```sh
cd Equicord/src/userplugins
git clone https://github.com/Just-Me-22/equicord-userplugins.git tmp
mv tmp/emojiManager . && rm -rf tmp
cd ../..
pnpm build
```

Restart Discord, then turn on **EmojiManager** in Settings › Plugins. Open it by right-clicking a
server › **Manage emoji and stickers**, or from the toolbox.

## Notes for anyone reading the source

**Dragging is done with pointer events, not HTML drag and drop.** Native drag never starts
inside Discord's modal layer, so tiles track the pointer themselves and find the server under
it with `elementFromPoint` and a `data-drop-guild` attribute.

**Uploads go straight to the API with `fetch`.** Stickers need a multipart body, and handling
429s in one place lets the queue show how long Discord asked to wait.

**History stores the image itself in IndexedDB**, so putting something back works even after
the original is gone from Discord's CDN.
