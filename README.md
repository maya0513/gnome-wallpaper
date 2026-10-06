# GNOME Wallpaper

[日本語](README.ja.md)

A fresh wallpaper every day, from Bing. GNOME Wallpaper changes your background automatically and shows the photo's title and credit in the top panel.

It works with **GNOME Shell 50**, with the same photo for light and dark themes.

## What you can do

- Let your wallpaper update each day, or choose **Refresh now** whenever you like.
- Choose a region, such as Japan or the US, and UHD or 1920×1080 images.
- Keep your current wallpaper when a download fails. The extension will try again automatically.
- Turn it off to return to your previous wallpaper. If you changed the wallpaper yourself, it keeps your choice.

## Getting started

This is an early development version. Automated checks pass, but it has not yet been tested on a running GNOME desktop. A release and installation guide will follow after that testing.

Once installed, enable **Daily Wallpaper** in your extension manager. It fetches the latest photo automatically.

Open the wallpaper icon in the top panel to see the photo's name, credit, and update status. Choose **Refresh now** for an immediate update, or **Preferences** to change:

- **Market**: the Bing region; the default is `ja-JP` (Japan). Try `en-US` for the US.
- **Resolution**: UHD by default, or 1920×1080. If UHD is unavailable, it uses Bing's regular image.

The controls are in English. Photo information follows the selected region. Downloading requires an internet connection; if an update fails, you can wait for the next attempt or select **Refresh now**.

## Saved photos

Photos are saved in `~/.local/share/gnome-wallpaper` by default and reused when possible. Old photos are cleaned up automatically; photos still needed for your wallpaper are kept. Turning the extension off leaves the saved photos in place.

## License and inspiration

The code and documentation use the [MIT license](LICENSE). Bing's photos have their own rights and credits.

Inspired by [Bing Wallpaper GNOME Extension](https://github.com/neffo/bing-wallpaper-gnome-extension), with an independently written implementation.
