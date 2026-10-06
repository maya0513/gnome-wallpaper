import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk?version=4.0";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

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
      return false;
    });
    group.add(marketRow);
    group.add(resolution);
    page.add(group);
    window.add(page);
  }
}
