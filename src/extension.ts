import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { createBingSource } from "./bing";
import { createController } from "./controller";
import { createBackground, createCancellation, createHttp, createStorage, schedule } from "./gjs";
import { createMenu } from "./ui";

export default class WallpaperExtension extends Extension {
  private teardown: (() => void) | null = null;

  override enable(): void {
    this.disable();
    const settings = this.getSettings();
    const http = createHttp();
    const menu = createMenu(
      () => {
        void controller.refresh();
      },
      () => {
        this.openPreferences();
      },
    );
    const controller = createController(
      {
        source: createBingSource(http.fetch),
        download: http.fetch,
        storage: createStorage(GLib.build_filenamev([GLib.get_user_data_dir(), "gnome-wallpaper"])),
        background: createBackground(),
        now: () => Date.now(),
        schedule,
        cancellation: createCancellation,
        render: menu.render,
        log: (message) => {
          console.error(message);
        },
      },
      () => ({
        market: settings.get_string("market"),
        resolution: settings.get_string("resolution") === "UHD" ? "UHD" : "1920x1080",
      }),
    );
    const changed = settings.connect("changed", () => {
      void controller.reconfigure();
    });
    this.teardown = () => {
      settings.disconnect(changed);
      controller.disable();
      http.close();
      menu.destroy();
    };
    void controller.refresh();
  }

  override disable(): void {
    this.teardown?.();
    this.teardown = null;
  }
}
