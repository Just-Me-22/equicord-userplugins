# UploadEditor

Paste, drop or attach a picture, GIF or video and it opens in an editor before anything uploads,
the way Telegram does it. Edit it, write a caption, and send it straight from there.

- **Crop** with corner and edge handles, free or locked to Original, 1:1, 4:3 or 16:9, plus profile
  sizes (avatar and server icon with a circle guide, banner 680×240, emoji 128, sticker 320)
- **Trim GIFs and videos** on a timeline, change the speed (0.5× to 2×), and play GIFs reversed or
  as a boomerang
- **Draw** in seven colours, or **blur** and **pixelate** with the same brush
- **Find text** marks text in a screenshot so you can blur it in one click
- **Text and stickers** you can drag around, with five fonts, colours and an outline
- **Adjust** brightness, contrast, saturation and warmth, or pick a look (Vivid, Warm, Cool, Fade,
  Mono, Noir)
- **Save a frame** from a GIF or video as a picture in the same album
- **Hold the eye button** to see the original, and **undo** any step (Ctrl+Z)
- **Spoiler and alt text** for each file, in the editor or on the album tiles
- **Too big?** Before sending it checks your upload limit and offers to shrink the file to fit
- **Several files** open as an album grid; more than ten go out as several messages in order
- **Add to message** puts the edited files in Discord's upload tray instead of sending
- **Replies** still work

Hold **Shift** while pasting or dropping to skip the editor and upload the normal way.

A file you leave untouched is sent as the original. Edited pictures keep their format, edited GIFs
are re-encoded as GIFs, and edited videos are saved as WebM (VP9 or VP8 with Opus sound). Sound is
kept when the video plays forward at 1×.

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

**GIFs and videos are re-encoded inside the plugin.** GIF frames are read with `ImageDecoder` and written by a small encoder in `media/gif.ts` (median-cut palette per frame, LZW). Videos are stepped frame by frame through a `<video>` element, encoded with WebCodecs, and packed by the WebM writer in `media/webm.ts`; audio comes from `decodeAudioData` and goes through `AudioEncoder` as Opus.

**The caption is sent as plain text.** `@name` and `:emoji:` are not converted the way the
message box converts them.
