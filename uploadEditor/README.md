# UploadEditor

Paste, drop or attach a picture and it opens in a preview before anything uploads, the way
Telegram does it. Crop it, draw on it, write a caption, and send it straight from there.

- **Crop** with corner and edge handles, free or locked to Original, 1:1, 4:3 or 16:9
- **Draw** in seven colours and three brush sizes, with undo
- **Caption** goes out with the picture. Enter sends, Shift+Enter is a new line
- **Several pictures** at once get a strip to switch between them, and all go in one message
- **Replies** still work. Pick a message to reply to first and the pictures go as that reply

Hold **Shift** while pasting or dropping to skip the editor and upload the normal way.

PNG, JPEG and WebP open in the editor. GIFs and other files upload as usual. A picture you
leave untouched is sent as the original file; only edited ones are re-encoded, in the same
format.

## Install

This is a userplugin, so it needs Equicord built from source.

```sh
cd Equicord/src/userplugins
git clone https://github.com/Just-Me-22/equicord-userplugins.git tmp
mv tmp/uploadEditor . && rm -rf tmp
cd ../..
pnpm build
```

Restart Discord, then turn on **UploadEditor** in Settings › Plugins.

## Notes for anyone reading the source

**Uploads are caught at `UPLOAD_ATTACHMENT_ADD_FILES`, not at paste or drop.** Every way of
adding a file ends in that one Flux action, so a single interceptor covers paste, drag and
drop and the attach button. The pictures are taken out of the action and anything else in it
carries on to Discord's tray.

**Sending goes through `sendMessage` with its own uploads,** so it never adds files back to the
tray and never re-triggers the interceptor.

**Crops and strokes are stored in the picture's own pixels.** The canvas only ever draws at
display size, so a large picture stays cheap to edit, and export draws once at full size.

**The caption is sent as plain text.** `@name` and `:emoji:` are not converted the way the
message box converts them.
