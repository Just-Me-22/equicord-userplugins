# UploadEditor

Paste, drop or attach a picture and it opens in a preview before anything uploads, the way
Telegram does it. Crop it, draw on it, write a caption, and send it straight from there.

- **Crop** with corner and edge handles, free or locked to Original, 1:1, 4:3 or 16:9
- **Draw** in seven colours and three brush sizes, with undo
- **Caption** goes out with the picture. Enter sends, Shift+Enter is a new line
- **Add to message** puts the edited pictures in Discord's upload tray instead of sending, so they go out with what you have typed. If the message box already has text, this is the main button
- **Several pictures** open as an album grid, the way Telegram shows them. Click one to crop or draw on it; each tile shows your edits
- **More than ten** is fine. Discord allows ten per message, so they go out as several messages in order, with the caption on the first
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

**Uploads are caught in Discord's `promptToUpload`, not at paste or drop.** Every way of
adding a file goes through it, and it refuses more than ten files before anything is queued,
so the hook sits at its start. Pictures go to the editor and any other files are handed back
to it. An interceptor on `UPLOAD_ATTACHMENT_ADD_FILES` stays as a fallback for code that adds
files to the tray directly.

**Sending goes through `sendMessage` with its own uploads,** so it never adds files back to the
tray and never re-triggers the interceptor.

**Crops and strokes are stored in the picture's own pixels.** The canvas only ever draws at
display size, so a large picture stays cheap to edit, and export draws once at full size.

**The caption is sent as plain text.** `@name` and `:emoji:` are not converted the way the
message box converts them.
