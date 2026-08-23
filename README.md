# Zen Sidebar Auto Width

A small [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser on Windows.

It automatically sets the expanded sidebar's minimum width so the complete top row remains visible. On Windows, it also prevents the minimize/maximize/close group from being compressed and spaces those controls with Zen's own toolbar variables.

## Install

1. In Zen, open **Settings → Sine Mods → Sine Settings** and enable downloading JavaScript from unofficial sources.
2. Install this GitHub repository in Sine:

   ```text
   Haerbin23456/zen-sidebar-auto-width
   ```

3. Keep `zen.view.experimental-force-window-controls-left` set to `true` in `about:config`.
4. Restart Zen.

## What it changes

- Uses Zen's own toolbar padding variables for the three Windows controls instead of Firefox's full-titlebar `18px` side padding.
- Keeps the window-control container at its intrinsic width so the three glyphs cannot overlap or become unevenly compressed.
- Restores protected navigation buttons through Firefox's overflow manager if they were already moved into `>>` before the mod loaded.
- Measures the full top row and expands the sidebar just enough to keep it visible.
- Recalculates after customization, sidebar expansion, window resizing, and display-scale changes.

## Compatibility

This mod targets Zen Browser on Windows and relies on Zen's current browser-chrome element IDs. Changes to Zen's chrome markup may require an update.
