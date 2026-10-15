import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk?version=4.0";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { SOURCE_IDS, SOURCE_NAMES } from "./model";
import { selfPath, openSelfFolder } from "./self-gjs";
import { createCancellation } from "./gjs";
import { errorMessage } from "./core";

export default class WallpaperPreferences extends ExtensionPreferences {
  override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage({
      title: "Daily Wallpaper",
      icon_name: "preferences-desktop-wallpaper-symbolic",
    });
    const group = new Adw.PreferencesGroup({
      title: "Bing images",
      description: "Choose a market and image resolution. Changes refresh the image.",
    });
    const sources = new Adw.PreferencesGroup({
      title: "Image source",
      description:
        "NASA uses original wide Full HD images from its latest 20 entries. The photo may stay the same until a suitable image is published.",
    });
    const images = new Adw.PreferencesGroup({
      title: "My images",
      description:
        "Place JPEG, PNG or WebP files directly in this folder. Images cycle in filename order once per local day. Refresh now rescans without advancing the day's image.",
    });
    const path = selfPath();
    const folder = new Adw.ActionRow({ title: "Image folder", subtitle: path });
    const open = new Gtk.Button({ label: "Open folder", valign: Gtk.Align.CENTER });
    const cancellation = createCancellation();
    const openFolder = async () => {
      try {
        await openSelfFolder(path, cancellation);
      } catch (error) {
        if (!cancellation.cancelled()) {
          const dialog = new Adw.AlertDialog({
            heading: "Unable to open image folder",
            body: errorMessage(error),
          });
          dialog.add_response("close", "Close");
          dialog.present(window);
        }
      }
    };
    open.connect("clicked", () => {
      void openFolder();
    });
    folder.add_suffix(open);
    images.add(folder);
    const index = () => {
      const value = settings.get_string("source");
      return Math.max(0, (SOURCE_IDS as readonly string[]).indexOf(value));
    };
    const source = new Adw.ComboRow({
      title: "Source",
      model: Gtk.StringList.new(SOURCE_IDS.map((id) => SOURCE_NAMES[id])),
      selected: index(),
    });
    const synchronize = () => {
      source.selected = index();
      group.sensitive = source.selected === 0;
      images.visible = source.selected === 2;
    };
    const sourceChanged = source.connect("notify::selected", () => {
      settings.set_string("source", SOURCE_IDS[source.selected] ?? "bing");
      group.sensitive = source.selected === 0;
      images.visible = source.selected === 2;
    });
    const settingsChanged = settings.connect("changed::source", synchronize);
    synchronize();
    sources.add(source);
    const market = new Gtk.Entry({ valign: Gtk.Align.CENTER });
    const marketRow = new Adw.ActionRow({ title: "Market", subtitle: "Examples: ja-JP, en-US" });
    marketRow.add_suffix(market);
    settings.bind("market", market, "text", Gio.SettingsBindFlags.DEFAULT);
    const resolution = new Adw.ComboRow({
      title: "Resolution",
      model: Gtk.StringList.new(["UHD", "1920×1080"]),
      selected: settings.get_string("resolution") === "UHD" ? 0 : 1,
    });
    const changed = resolution.connect("notify::selected", () => {
      settings.set_string("resolution", resolution.selected === 0 ? "UHD" : "1920x1080");
    });
    window.connect("close-request", () => {
      resolution.disconnect(changed);
      source.disconnect(sourceChanged);
      settings.disconnect(settingsChanged);
      cancellation.cancel();
      return false;
    });
    group.add(marketRow);
    group.add(resolution);
    page.add(sources);
    page.add(group);
    page.add(images);
    window.add(page);
  }
}
