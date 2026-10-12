# CI と依存更新

[English](CI.md)

CI はコミット済みの依存グラフと拡張のパッケージを検証します。依存更新には登録済みの Mend Renovate App と共通 GitHub App を使います。リリース、インストール、デプロイはこれらのワークフローに含めません。

## ローカル検証

リポジトリのルートで実行します。

```sh
mise install --locked node pnpm
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm exec vp run format
mise exec -- pnpm exec vp run ci
```

Node と pnpm は `mise.toml` で選択し、チェックサムと対象プラットフォームを `mise.lock` に記録します。Renovate の依存生成でも同じツールを使うよう、`package.json` の `engines.node` と `packageManager` にそれぞれ完全バージョンを記載し、CI で一致を検証します。`pmOnFail: error` により、pnpm が別バージョンを自動取得したり不一致のまま実行したりすることを防ぎます。記録する環境は Linux x64・ARM64、受理判定ジョブが実行される環境は現在 Linux x64 です。

タスクの主な入口は Vite tasks です。package scripts と mise tasks は置きません。ネイティブ検証には GJS、Soup 3 の introspection、デスクトップの GSettings schema、`glib-compile-schemas`、`zip`、`unzip` が必要です。アプリは GJS 向け ESM とし、minify せずパッケージ化します。

主なタスク：

| タスク            | 検証・出力                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `configuration`   | ワークフロー構文、ShellCheck、セキュリティ監査、CI ポリシーテスト               |
| `toolchain`       | coverage・override の完全指定と、同一 Vitest 実体の単一解決。読み取り専用       |
| `static`          | 厳格な lint、フォーマット、型を使う検査、アプリ専用の型検査                     |
| `coverage`        | 実行可能な全アプリファイルで、行・文・関数・分岐のそれぞれをファイル単位で 100% |
| `native`          | ビルド、実 GJS 結合テスト、ZIP 検証、サイズ計測                                 |
| `size`            | 再ビルドとパッケージのサイズ計測                                                |
| `align-toolchain` | Vite+ 由来の宣言・lockfile を明示的に同期し、検証                               |
| `ci`              | ローカルの受理判定全体                                                          |

ワークフローの検査には actionlint、ShellCheck、zizmor を使います。インストーラーは公式 release の SHA-256 digest を照合し、宣言したメジャー内のツールだけを受け入れます。zizmor は pinning の例外を設けず `--pedantic --offline` で実行します。GitHub のリモート情報を必要とする監査は対象外です。

## GitHub の受理判定

[CI](../.github/workflows/ci.yml) は main への push、main 向け PR、merge group、手動実行に対応します。作成者や変更パスによる除外はなく、人・Renovate・共通 App のすべてのコミットを同じ条件で検証します。

| ジョブ                 | 役割                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `dependency-artifacts` | 共通ワークフローの検証モード。mise lock の再生成と Vite+ 生成物の整合性を検証し、差分があれば失敗 |
| `configuration`        | ワークフロー構文・セキュリティ・方針の検証と、PR の moderate 以上の依存脆弱性検査                 |
| `static`               | ツールチェーン、厳格な lint、フォーマット、型検査                                                 |
| `tests`                | 単体・境界テストとファイル単位 100% のアプリカバレッジ                                            |
| `native`               | ビルド、実 GJS テスト、ZIP・schema 検証、サイズ計測                                               |
| `quality`              | 常に実行し、先行する 5 ジョブすべての成功を要求                                                   |

受理判定のリポジトリトークンはすべて読み取り専用です。Node／pnpm は `--locked`、依存は `--frozen-lockfile` でインストールします。コミット済みファイルの修復はしません。共通の検証ジョブは古い生成物を検出するため使い捨て checkout 内で再生成することがありますが、変更を公開せず失敗します。`verify-only: true` のため App 認証情報は不要です。

共通ワークフローの更新側・検証側は、いずれも `sync-vite-plus` と `sync-declarations` を有効にします。同一の `lock-groups` で `mise.lock`、Node／pnpm、Linux x64・ARM64、`verify: regenerate` を指定します。両方とも[共通ワークフロー](https://github.com/maya0513/renovate-config/blob/1070616046be77fce7b54ff3d1eb36d7f3f2732e/.github/workflows/dependency-artifacts.yml)の同じ完全 SHA を参照し、Renovate がこれらと外部 Actions の SHA を更新します。

ローカルの `ci` は依存グラフとリポジトリ方針を検証します。再利用ワークフローは加えてクリーンな GitHub checkout で生成物を再生成するため、ローカル成功だけではこのリモートジョブの成功を確認できません。

## 依存更新

[Renovate 設定](../renovate.json) は共通 preset と選択式の Vite+ preset を継承します。共通方針では、通常の更新は日本時間の火曜日、リリースから 7 日後以降に行います。SHA 更新や lockfile maintenance を含む非メジャー更新は必須検査後に自動マージでき、メジャー更新は手動レビューです。利用側の追加ルールで runner と共通ワークフロー参照の変更も手動レビューにし、共通ワークフロー参照にはリリース待機を適用しません。セキュリティ修正はスケジュール・リリース待機の対象外ですが、メジャー更新は引き続きレビューが必要です。脆弱性修正には Dependency graph と Dependabot alerts を使い、Dependabot のバージョン更新ワークフローは削除します。

通常の npm 宣言は、現在ロック済みの安定版を下限とするキャレット指定です。`rangeStrategy: update-lockfile` により範囲内は lockfile、範囲外は宣言も更新します。Node と pnpm は npm／mise をまたぐツール別グループで宣言を一緒に更新します。Node 型定義も、実行環境のメジャー変更をレビューするまで Node 24 系を維持します。通常 CI は新しいバージョンを探しません。

Renovate 自身の mise 生成物更新・mise lock maintenance は無効にし、共通ワークフローへ委ねます。Node 単独グループも生成を省略します。一方、pnpm グループは Renovate による npm 生成を残します。`packageManager` を変えて pnpm の別 document の管理ツール lock を更新しないと、共通ワークフローの初回 frozen install が失敗するためです。この再現済みの例外と選択式の共通 preset 案は [renovate-config #3](https://github.com/maya0513/renovate-config/issues/3) に記録しています。共通側の変更をレビューして導入した後に、同等の利用側ルールを削除できます。

Vitest と Vite core の完全バージョンは Vite+ が選択します。coverage はその Vitest と完全一致させ、workspace override も Vitest と Vite core alias の完全指定にします。選択式 preset は coverage・Vitest・Vite core の npm による独立更新を止めます。同梱 Vitest のメジャー変更は互換性を明示的に確認するまで同期を失敗させます。関連パッケージの脆弱性に対して Vite+ が互換修正を提供していない場合も、手動判断が必要です。

[依存生成物の更新](../.github/workflows/update-dependencies.yml)は、パスを限定せず `renovate/**` への push で同じ共通ワークフローの更新モードを呼びます。共通側がこのブランチ接頭辞と Mend Renovate sender（ID `29139614`）を検証します。

1. 読み取り専用の準備ジョブが mise lock を再生成し、選択済み Vite+ の依存グラフを同期します。同期中は依存 script、pnpm hook、パッケージマネージャーの自動切り替えを無効にします。無関係な依存変更、Vitest の重複、alias や宣言の不一致は失敗させます。
2. 準備時の SHA と正確な binary patch を、同じ run の保持期間 1 日の artifact で受け渡します。
3. 別の公開ジョブが許可パスと通常ファイルであることを確認し、1 コミットを作り、Contents write のリポジトリ限定 App token を取得します。候補依存のインストール・実行はしません。
4. 準備時の正確な SHA を lease にして既存の Renovate ブランチへ push します。ブランチが進んでいたら、新しい変更を上書きせず失敗します。
5. App の push が修正後コミットの PR CI を起動します。sender が Renovate ではなくなるため、修復を繰り返しません。

統合により mise／Vite+ の修復 push の競合を避けます。変更対象は `mise.lock` と sidecar、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` で、アプリソースやワークフロー定義は変更しません。post-update の mise task は指定しません。人や他の bot の変更では自分で生成物を揃えますが、その PR も検証対象です。

## 認証とマージ保護

登録済みの Renovate App と共通 GitHub App を使います。修復側の caller は次を参照します。

- Actions 変数 `DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`。
- Actions Secret `DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`。

リポジトリ設定、またはこのリポジトリに利用を許可した組織設定で提供できます。App のインストールと Actions からの認証情報の利用可否は別の条件です。共通 App はこのリポジトリへの Contents write が必要です。新しい App、PAT、承認 bot、書き込み権限での PR コード実行は導入しません。秘密鍵をコミットやチャットへ記載しないでください。修復 push から通常の CI を起動するため App 認証を使います。`GITHUB_TOKEN` の push では通常の push ワークフローが起動しません。

**Allow auto-merge** を有効にし、main では GitHub Actions の `quality` を必須にして、**Require branches to be up to date before merging** を設定します。無人更新で管理者 bypass を許可しません。`quality` に生成物検証を含めるため、古い生成物では通過できません。`renovate/artifacts` は Renovate 自身の生成失敗時の status で、すべての PR にある検査ではないため、全 PR 共通の必須項目にしません。

公開後は通常 CI・共通の検証ジョブに加え、実際の Renovate 修復コミットとその後の CI を確認します。App 登録、ローカルのモック、変更なしの同期実行だけでは自動更新・マージ全体の動作確認にはなりません。公開済みコミットの結果は最新の [Actions 実行](https://github.com/maya0513/gnome-wallpaper/actions/workflows/ci.yml)で確認します。App の修復動作とマージ保護は別途確認が必要です。

## 手動変更と失敗時の対応

実行環境を更新するときは `mise.toml` と対応する `package.json` のフィールドを一緒に変更し、`mise lock --platform linux-x64,linux-arm64 node pnpm` を実行します。選択したツールで pnpm lockfile も再生成します。Vite+ を選び直して lockfile を更新したら、次を実行します。

```sh
mise exec -- pnpm exec vp run align-toolchain
mise exec -- pnpm exec vp run format
mise exec -- pnpm exec vp run ci
```

同期タスクは coverage 宣言と override を完全指定へ書き換え、non-frozen install の後に frozen install を行います。新しい Node プロセスで、Vite+ と無関係な直接・間接依存が変わっていないことを検証します。失敗後にファイル変更が残ることがあるため、差分を確認して原因を直してからコミットします。競合を lockfile の全削除や検証の無効化で解消しないでください。

| 失敗                                        | 対応                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| locked／frozen install 失敗                 | ツールバージョンと宣言を確認し、対応する生成物を再生成           |
| 生成物検証で差分                            | 同じ入力で生成し、足りない変更をコミット                         |
| Vitest／coverage／core 不一致やメジャー変更 | 互換性を確認し、選択済みグラフを同期。検査は維持                 |
| App 認証情報を利用できない                  | Actions 変数・Secret の利用範囲と App 登録を確認。鍵は公開しない |
| push の lease 違反                          | 最新の Renovate ブランチを確認し、その SHA から再生成            |
| 修復コミットの CI が起動しない              | App 認証とイベント条件を確認し、未検証の head をマージしない     |

## レポートと検証の限界

Actions は coverage／JUnit、ネイティブ／サイズレポート、検証済み拡張 ZIP を 14 日保持します。run summary にもサイズ表を表示します。ローカルでは `artifacts/build-size.json`、`artifacts/gjs-integration.json`、`coverage/` を確認し、新しく測るときは `vp run size` を実行します。サイズは出力 JavaScript、展開後ファイル、ZIP のバイト数で、メモリ使用量やダウンロード画像は含みません。ZIP 内のコードは minify せず可読性を保ちます。

単体テストは GNOME 境界モックを使います。結合テストは実 GJS、ローカル HTTP サーバー、一時ディレクトリ、メモリ GSettings を使います。外部 Bing に依存せず、実際の壁紙設定を変更しません。実 GNOME のパネル・設定画面・画像表示・ロック中の動作は検証しません。インストール、実画面確認、配布、デプロイは後続作業です。
