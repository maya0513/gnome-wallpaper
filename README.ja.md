# GNOME Wallpaper

[English](README.md)

Bing、NASA Image of the Day、自分で用意した画像を壁紙にできる GNOME 拡張です。壁紙を自動で切り替え、写真の名前と出典を上部パネルから確認できます。

**GNOME Shell 50** に対応し、ライト・ダークの両テーマで同じ写真を使います。

![Bing の写真を壁紙に表示し、パネルメニューから写真の名前・出典・更新時刻を確認している画面](images/daily-wallpaper-menu.png)

実際の GNOME Shell 50 での表示例です。上部パネルの壁紙アイコンを開くと写真の情報が表示され、**Refresh now** で更新、**Preferences** で取得元や Bing の地域・解像度を変更できます。出典もメニューに表示します。

## できること

- 毎日の更新はおまかせ。好きなときに **Refresh now** で更新することもできます。
- Bing／NASA Image of the Day／My images を選べます。Bing では日本や米国などの地域と UHD／1920×1080 の画像を指定できます。
- ダウンロードに失敗しても、今の壁紙を保って自動で再試行します。
- 無効にすると元の壁紙に戻ります。自分で壁紙を変更していた場合は、その設定を保ちます。

## 使い始めるには

現在は開発初期の版です。自動テストに加え、別の GNOME Shell 50 セッションで実際の Bing／NASA 画像の取得・壁紙表示・パネル表示を確認できます。リリースと通常のインストール手順は今後整備します。

開発環境では `just gnome` で画面付きの試用環境を開けます。前提条件と操作手順は[ローカル GNOME 動作確認](docs/GNOME.ja.md)を参照してください。

インストール後、拡張の管理画面で **Daily Wallpaper** を有効にすると、最新の写真を自動で取得します。

上部パネルの壁紙アイコンを開くと、写真の名前、出典、更新状況が見られます。**Refresh now** ですぐに更新し、**Preferences** から次の設定を変更できます。

- **Source**：Bing（初期設定）／NASA Image of the Day／My images。API キーは不要です。
- **Market**：Bing の地域。初期設定は日本の `ja-JP` です。米国なら `en-US` を指定します。
- **Resolution**：初期設定は UHD。1920×1080 も選べます。UHD が取得できないときは、Bing の通常画像を使います。

Market／Resolution は Bing 専用です。NASA は最新20件から、JPEG／PNG・1920×1080以上・幅÷高さが1.45〜2.4の最新画像を選び、元画像を使います。適合画像が出るまで同じ写真が続くことがあり、取得に失敗しても別の取得元には切り替えません。表示には GNOME の既存設定を使います。

![NASA の Crew-12 帰還写真を壁紙に表示し、パネルから取得元と撮影者を確認している画面](images/daily-wallpaper-nasa.png)

NASA の表示例：[Crew-12 Returns to Earth](https://www.nasa.gov/image-detail/nasas-spacex-crew-12-splashdown-2/)、NASA/Keegan Barber。拡張が条件に従って選んだ写真であり、必ずしも当日の配信画像ではありません。

操作画面は英語です。Bing の写真情報は選んだ地域に応じた言語、NASA は英語になります。Bing／NASA の画像取得にはインターネット接続が必要です。My images はオフラインで使えます。更新に失敗したときは、次の再試行を待つか **Refresh now** を選んでください。

## 自分の画像を使う

**Preferences → Source → My images** を選び、表示された保存先へ JPEG・PNG・WebP を直接置いてください。通常の配置先は **`~/.local/share/gnome-wallpaper/self/`** です。`XDG_DATA_HOME` が設定されている場合は `$XDG_DATA_HOME/gnome-wallpaper/self/` を使います。**Open folder** で開け、存在しなければ空のフォルダーを作成します。

直下の画像を、数字を考慮した名前順（例：`image1.jpg` → `image2.png` → `image10.webp`）に1日1枚表示し、最後まで進むと先頭へ戻ります。初回は先頭、次回以降は現地時刻の午前0時に切り替えます。同日の再起動や取得元の切り替えでは同じ画像を使い、数日空いても1枚だけ進めます。スリープ復帰時にも日付を確認します。

追加・削除後は **Refresh now** で再読込できます。同日の画像は進まず、現在のファイルがなくなれば残りの先頭から選び直します。サブフォルダーは読みません。サイズや縦横比に制限はなく、表示には GNOME の設定を使います。破損・読み込み不能の画像は飛ばし、使える画像がなければ壁紙設定を維持してエラーと再試行を表示します。

拡張は画像を直接参照し、コピー・変更・削除しません。画像の管理はファイルマネージャーで行ってください。

## 保存した写真

Bing／NASA の写真は通常 `~/.local/share/gnome-wallpaper` に保存し、再利用します。古い写真は自動で整理しますが、壁紙に必要な写真は残します。拡張を無効にしても保存した写真は残ります。

## ライセンスと参考

コードとドキュメントは [MIT ライセンス](LICENSE) です。写真には、それぞれの権利と出典があります。同梱ライブラリには各ライセンスが適用され、ZIP に `THIRD_PARTY_LICENSES.txt` を含めます。

[Bing Wallpaper GNOME Extension](https://github.com/neffo/bing-wallpaper-gnome-extension) を参考に、独立した実装を作成しています。
