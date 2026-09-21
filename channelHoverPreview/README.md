# ChannelHoverPreview

Rest on a DM or a server channel in the sidebar and a window opens beside it with that
channel's recent messages. Read it, scroll it, click a message to jump there, move away and
it closes. Nothing is marked read.

## Settings

| Setting | What it does |
|---|---|
| Message count | How many messages to load |
| Hover delay | How long to rest on a channel before it opens |
| Key / Only open while held | Which modifier, and whether it skips the delay or is required to open at all |
| Scrollbar | Thin, or Wide for a bigger grab target |
| Height, Width, Message gap | Size of the window and the spacing inside it |
| Animation | Fade, pop, slide or none |
| Display style | Follow your chat setting, or force compact or cozy |
| Click to jump | Whether clicking a message opens the channel at it |
| DMs / Server channels | Which of the two to preview |

## Notes for anyone reading the source

These are the decisions that are not obvious from the code.

**Which channel you are hovering comes from a patch, not from the DOM.** The two row
components are patched to pass their own `channel` object into `onRowOver`. The earlier
version listened for `mouseover` on `document`, walked up to the nearest
`a[href^="/channels/"]` and parsed the id out of the href, which is guessing at state
Discord already holds.

**The anchors deliberately avoid the ones `dragify` uses.** Vencord applies every patch to
one accumulating string rather than to Discord's original source, so a plugin that patches
first changes what the rest see. Dragify patches both of these rows, runs first, and inserts
about a hundred characters. Anything anchored on a `.{0,N}` window spanning that insertion
fails. These anchor on adjacent text instead: after `onMouseEnter:...void 0,` on channel rows,
and after `innerRef:` on DM rows. Both sit outside the windows dragify's own patches measure,
so neither plugin breaks the other. That was checked by applying these replacements to the
live source and re-testing dragify's regexes against the result.

Note that a failing anchor still tests `true` against `wreq.m[id].toString()`, because the
module proxy redirects `toString` to the unpatched original. The console cannot confirm an
anchor this way; only the absence of a "had no effect" warning can.

**The injected handlers are `onMouseOver`/`onMouseOut`, not enter/leave.** Discord's row
already carries both, and a later key in the same props object would silently replace them,
taking Discord's own hover state with it. Over/out are free, and `onRowOut` filters out moves
between children by checking `relatedTarget` against `currentTarget`, which is what enter and
leave do anyway.

**The window anchors to the sidebar's edge, not the hovered row's.** The row's own right edge
falls short of the sidebar's, so anchoring there put the window on top of the × that closes a
DM. Anchoring to the column means it lands in the same place for every channel regardless of
how long the name is.

**Keyboard scrolling only takes over while the pointer is inside the window.** Discord keeps
the message box focused nearly all the time, so a version that yielded to focused text fields
would never fire once. Pointing at the window is the signal instead, which leaves the arrow
keys alone everywhere else.

**Menus and popouts count as being inside the window.** Discord renders them into its own
layer container, outside ours, so without this a right-click on a message closed the thing you
opened the menu from. The check is on the leave event's `relatedTarget`, so it costs nothing
until the pointer actually leaves.

**The sidebar hook is `[class*="sidebarList"]`.** It is only read once per open, to measure
where the column's right edge is. A looser match on "sidebar" also catches the profile
popout's columns.

**Channels you cannot read are checked before opening**, otherwise the fetch 403s and the
window opens showing the error.

**Messages in the preview are read-only, and reactions show Discord's `not-allowed` cursor.**
That is Discord's own doing: a message component rendered on its own is read-only, and only
its full channel view makes one live. Mounting that view does fix reactions, replies and the
hover toolbar — it also brings a message box with it and costs a great deal more to open, so
this plugin does not.

**Previewing never marks a channel read.** It only fetches history; verified against a channel
that kept its unread pill and its bold name afterwards.

**No `:has()` anywhere.** Style recalculation is the expensive part of a Discord client and
`:has()` is the most expensive thing in a stylesheet; a class hook does the same jobs here.
