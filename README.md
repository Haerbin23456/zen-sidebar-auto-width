# Zen Sidebar Auto Width

A small [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser on Windows.

It automatically forces the expanded sidebar to the exact measured width needed for the complete top row. On Windows, it also prevents the minimize/maximize/close group from being compressed and spaces those controls with Zen's own toolbar variables.

## Install

1. In Zen, open **Settings → Sine Mods → Sine Settings** and enable downloading JavaScript from unofficial sources.
2. Install this GitHub repository in Sine:

   ```text
   Haerbin23456/zen-sidebar-auto-width
   ```

3. Keep `zen.view.experimental-force-window-controls-left` set to `true` in `about:config`.
4. Restart Zen.

> [!IMPORTANT]
> Sine does not load JavaScript from GitHub mods unless the setting in step 1 is enabled. Without it, only this mod's CSS runs, so the reload button can still be moved into `>>`.

## What it changes

- Uses Zen's own toolbar padding variables for the three Windows controls instead of Firefox's full-titlebar `18px` side padding.
- Keeps the window-control container at its intrinsic width so the three glyphs cannot overlap or become unevenly compressed.
- Gives the Windows controls Zen's exact square toolbar-button geometry, theme classes, hover and pressed treatment; the close button differs only by retaining its warning color.
- Uses a theme-colored loading ring for the stop action so a loading page does not add a second window-close glyph.
- Measures a real neighboring navigation button so themes that target button IDs directly can also synchronize control size, radius, spacing, color tokens, and vertical alignment.
- Marks the navigation buttons with Firefox's official non-overflowing attribute and measures the row at its uncompressed intrinsic width without temporarily widening the sidebar.
- If a button was already inside `>>` before the mod loaded, briefly pauses Firefox's overflow manager so its own underflow path returns the button before measurement.
- Writes the result through the same inline `width` and `width` attribute path used by Zen's sidebar splitter, then forces that exact width while the sidebar is expanded.
- Recalculates after customization, sidebar expansion, window resizing, and display-scale changes.

## Compatibility

This mod targets Zen Browser on Windows and relies on Zen's current browser-chrome element IDs. Changes to Zen's chrome markup may require an update.
