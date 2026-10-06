import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import type { View } from "./model";

export const createMenu = (
  refresh: () => void,
  preferences: () => void,
): Readonly<{ render: (view: View) => void; destroy: () => void }> => {
  const button = new PanelMenu.Button(0, "Daily Wallpaper");
  button.add_child(
    new St.Icon({
      icon_name: "preferences-desktop-wallpaper-symbolic",
      style_class: "system-status-icon",
    }),
  );
  const title = new PopupMenu.PopupMenuItem("No image yet", { reactive: false });
  const credit = new PopupMenu.PopupMenuItem("Bing", { reactive: false });
  const status = new PopupMenu.PopupMenuItem("Waiting for an update", { reactive: false });
  const manual = new PopupMenu.PopupMenuItem("Refresh now");
  const prefs = new PopupMenu.PopupMenuItem("Preferences");
  const { menu } = button;
  if (!("addMenuItem" in menu)) {
    throw new Error("Unable to create the menu");
  }
  for (const item of [title, credit, status, manual, prefs]) {
    menu.addMenuItem(item);
  }
  manual.connect("activate", refresh);
  prefs.connect("activate", preferences);
  Main.panel.addToStatusArea("gnome-wallpaper", button);
  return {
    render: (view: View) => {
      title.label.text = view.image?.title ?? "No image yet";
      credit.label.text = view.image?.copyright ?? "Bing";
      status.label.text = view.busy
        ? "Updating…"
        : (view.error ??
          (view.nextAt === null
            ? "Waiting for an update"
            : `Next check: ${new Date(view.nextAt).toLocaleString("en-US")}`));
      manual.setSensitive(!view.busy);
    },
    destroy: () => {
      button.destroy();
    },
  };
};
