import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { createSource } from "./sources";
import { createController } from "./controller";
import { createBackground, createCancellation, createHttp, createStorage, schedule } from "./gjs";
import { createMenu } from "./ui";
import * as LoginManager from "resource:///org/gnome/shell/misc/loginManager.js";
import { createSelfSource } from "./self";
import { createSelfFiles, createSelfSelection, selfPath } from "./self-gjs";

export default class WallpaperExtension extends Extension {
  private teardown: (() => void) | null = null;

  override enable(): void {
    this.disable();
    const settings = this.getSettings();
    const http = createHttp();
    const selfSelection = createSelfSelection(settings);
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
        source: createSource(
          http.fetch,
          createSelfSource(createSelfFiles(selfPath()), selfSelection, () => Date.now()),
        ),
        selfSelection,
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
        source:
          settings.get_string("source") === "nasa-iotd"
            ? "nasa-iotd"
            : settings.get_string("source") === "self"
              ? "self"
              : "bing",
        market: settings.get_string("market"),
        resolution: settings.get_string("resolution") === "UHD" ? "UHD" : "1920x1080",
      }),
    );
    const changed = settings.connect("changed", (_settings, key: string) => {
      if (key !== "self-selection") {
        void controller.reconfigure();
      }
    });
    const login = LoginManager.getLoginManager();
    const resumed = login.connect("prepare-for-sleep", (_manager, sleeping: boolean) => {
      if (!sleeping && settings.get_string("source") === "self") {
        void controller.reconfigure();
      }
    });
    this.teardown = () => {
      settings.disconnect(changed);
      login.disconnect(resumed);
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
