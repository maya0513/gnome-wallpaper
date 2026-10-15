# Local GNOME smoke testing

[日本語](GNOME.ja.md)

Run the built production ZIP in a separate GNOME Shell 50 session without installing it into your everyday desktop. Use the nested desktop for manual checks and the headless session for an AI agent to inspect screenshots and results. Both are local smoke tests using live Bing/NASA images or test images in a private self folder.

## Prerequisites

- The repository's Node/pnpm versions and installed development dependencies.
- GNOME Shell **50**, GJS, Gio/GdkPixbuf/Soup 3/GTK 4/Adwaita 1 introspection, and GNOME GSettings schemas.
- A GdkPixbuf WebP loader: on Ubuntu 26.04, `webp-pixbuf-loader` with `gir1.2-gdkpixbuf-2.0` introspection.
- `dbus-run-session`, `gsettings`, `glib-compile-schemas`, `zip`, `unzip`, and `fusermount3` (`fuse3` on Ubuntu, for Document Portal/GVfs mount cleanup).
- `just` for the manual launcher, or use the Vite task below directly. The AI command does not require `just`.
- Nested mode also needs a Wayland desktop session, a running PipeWire server, and `/usr/libexec/mutter-devkit`. On Ubuntu 26.04, Devkit is provided by `mutter-dev-bin`.

The launcher does not install system packages. It reports missing prerequisites with instructions. Headless mode still needs a working EGL/Mesa rendering environment; an arbitrary container without GNOME is insufficient.

`mutter-dev-bin` is Ubuntu's package of development tools for Mutter, GNOME's compositor and window manager. Its `mutter-devkit` viewer displays the test GNOME inside a window on your everyday desktop. This repository needs it for manual nested testing, but not for normal extension use or AI headless testing. Mutter itself is part of GNOME; this additional package is for development and testing.

## Manual testing: nested desktop

```sh
just gnome
# Without just
pnpm exec vp run gnome
```

Each run rebuilds and validates the ZIP, extracts it into a temporary extension directory, and enables it with the default `ja-JP` market and UHD resolution. After confirming image retrieval, the terminal prints `bing image ready` and the desktop stays open. Press Super to dismiss the overview if it appears at startup.

Check manually:

1. The photograph appears as the wallpaper.
2. The wallpaper panel icon shows a readable title, credit, and next check time.
3. **Refresh now** updates the image.
4. **Preferences** opens, and changing Market/Resolution refreshes the image.

5. Choose **My images** in Source and check the folder path, instructions, and **Open folder** button. Open the private folder, add images, and choose **Refresh now**. The first filename should appear and a second refresh on the same day should keep it.

`GNOME_WALLPAPER_TEST_SOURCE=self just gnome` starts with JPEG/PNG/WebP and broken-image fixtures in the private self folder; it never touches your usual self folder.

Close the Devkit window or press Ctrl+C in the launching terminal to exit. Ctrl+C records exit code 130 and `Interrupted`. A successful JSON result covers startup and image retrieval; it does not certify completion of all manual checks.

## AI testing: headless screenshots

```sh
pnpm exec vp run gnome-headless
# Verify live NASA images
GNOME_WALLPAPER_TEST_SOURCE=nasa-iotd pnpm exec vp run gnome-headless
# Verify the private self folder without network access
GNOME_WALLPAPER_TEST_SOURCE=self pnpm exec vp run gnome-headless
```

The launcher creates a 1280×720 virtual monitor and checks the enabled extension, image decoding, both light/dark wallpaper URIs, GNOME's background image loading, and panel photo information. For self, it also checks the direct file URI and unchanged original files/folder contents. It captures the desktop and open panel menu, checks for extension errors, and exits.

Agents should check the exit code and `result.json`, then **open `desktop.png` and `menu.png` as images for visual inspection**. Successful screenshot creation alone does not establish visual correctness.

## Artifacts and failures

On exit, the launcher prints the absolute path to `artifacts/gnome/<nested|headless>/<run-id>/`.

| File                       | Contents                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `result.json`              | Outcome, performed checks, timestamps, image/log paths, and failure reason |
| `shell.log`                | Dedicated session and GNOME Shell output                                   |
| `wallpaper.jpg`            | Copy of the displayed image, when loading succeeds                         |
| `desktop.png` / `menu.png` | Headless desktop and open panel menu screenshots                           |

Extension startup is limited to 30 seconds. The headless launcher, including prerequisite checks, is limited to 120 seconds; the preceding build and cleanup take additional time. Nested mode also limits initial image retrieval, then waits for manual exit.

Bing/NASA connection errors, extension errors, image decoding/screenshot failures, and timeouts produce a nonzero exit code. They are not silently skipped. Available logs and images are retained. Shell and surrounding services may log warnings; inspect them together with the JSON failure reason.

## Isolation and limits

A private D-Bus session and temporary XDG config/data/cache/state/runtime directories separate the test from your everyday settings and files. GSettings uses a private keyfile backend. The normal extension directory, wallpaper settings, and image storage are not used. On exit, the dedicated process group is terminated and temporary directories are deleted; artifacts remain.

Nested mode uses the host Wayland/PipeWire sockets for display and streaming. It separates settings and files, rather than isolating the entire OS as a virtual machine would. The `--unsafe-mode` needed for headless Shell inspection and screenshots is applied only to the dedicated test session.

These network-dependent tests are not added to the existing unit tests, GJS integration tests, or CI. Preferences interaction is covered by the manual checklist. OS reboot/login/lock-unlock behavior and conflicts with other extensions are outside this smoke test.

Select **NASA Image of the Day** in Preferences, confirm that Bing controls become insensitive and a wide NASA image loads, then switch back to Bing. `GNOME_WALLPAPER_TEST_SOURCE=nasa-iotd just gnome` also starts the nested test with NASA selected. The variable only configures the isolated test session; `result.json` records the selected source. A remaining Document Portal or GVfs FUSE mount inside that session is unmounted before its temporary directories are removed.

The private session uses `GIO_USE_VFS=local`. Open folder still uses the regular file manager, while avoiding GVfs network-share discovery helpers during the test.
