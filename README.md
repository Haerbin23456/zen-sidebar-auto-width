# Zen Sidebar Auto Width

A small [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser on Windows.

It measures Zen's navigation buttons at runtime, gives the minimize/maximize/close buttons the same width, and automatically sets the expanded sidebar's minimum width so the complete top row remains visible.

## Install

1. In Zen, open **Settings → Sine Mods → Sine Settings** and enable downloading JavaScript from unofficial sources.
2. Install this GitHub repository in Sine:

   ```text
   Haerbin23456/zen-sidebar-auto-width
   ```

3. Keep `zen.view.experimental-force-window-controls-left` set to `true` in `about:config`.
4. Restart Zen.

## What it changes

- Measures Back, Forward, and Reload instead of hard-coding a button width.
- Applies the measured width to the three Windows title-bar buttons.
- Measures the full top row and expands the sidebar just enough to keep it visible.
- Recalculates after customization, sidebar expansion, window resizing, and display-scale changes.

## Compatibility

This mod targets Zen Browser on Windows and relies on Zen's current browser-chrome element IDs. Changes to Zen's chrome markup may require an update.
