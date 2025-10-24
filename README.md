# GitHub Actions note.com 自動投稿システム（MdtoNote-MVP）

Markdown形式で記事を書くと、GitHub Actions + Playwright + Claude APIで自動的にnote.comに投稿するシステムです。

## 🎯 主な機能

- **Markdown → note.com**: Markdownファイルから直接note.comに投稿
- **AI スタイル最適化**: Claude API で記事を note 向けに最適化
- **手動・自動実行**: GitHub Actions の手動実行、または `articles/` への push で自動実行
- **下書き/公開選択**: 手動実行時は公開/下書きを選択可能、自動実行時は常に下書き保存
- **ステルス投稿**: bot検出を回避する高度な Playwright 設定

---

## 📋 ワークフロー概要

`.github/workflows/note-from-md.yml` が以下の処理を実行します：

1. **スタイル最適化**: Claude API で記事を note 向けに最適化（句読点統一、冗長表現の簡潔化など）
2. **自動投稿**: Playwright で note.com のエディタを操作して投稿
3. **自動保存対応**: note.com の自動保存機能を活用

---

## 🔧 事前準備（リポジトリ Secrets）

以下の環境変数を GitHub Actions の Repository Secrets に設定してください：

| Secret名 | 説明 |
|---------|------|
| `ANTHROPIC_API_KEY` | Claude API キー（必須） |
| `NOTE_STORAGE_STATE_JSON` | note.com ログイン状態（必須・後述） |

**設定場所**: `Settings` > `Secrets and variables` > `Actions` > `New repository secret`

---

## 🚀 実行方法

### 方法1: 手動実行（推奨）

1. GitHub リポジトリの `Actions` タブに移動
2. 左サイドバーから **"Note: Post from Markdown"** を選択
3. `Run workflow` ボタンをクリック
4. パラメータを入力：
   - **markdown_path**: 投稿する .md ファイルのパス（例: `articles/sample.md`）
   - **is_public**: `false` = 下書き保存 / `true` = 公開
5. `Run workflow` で実行

### 方法2: 自動実行（プッシュトリガー）

1. `articles/` ディレクトリに .md ファイルを作成または編集
2. `claude/pickup-branch-011CURbcRkWiWUgHxg4ZSi3M` ブランチに push
3. GitHub Actions が自動的に起動し、**下書きとして**note に保存

> **注意**: 自動実行時は常に下書き保存（`is_public=false`）になります。公開したい場合は手動実行を使用してください。

---

## 📝 Markdown ファイルの書き方

`articles/` ディレクトリに以下の形式で .md ファイルを作成してください：

```markdown
---
title: "記事のタイトル"
tags: ["タグ1", "タグ2"]
status: "draft"  # または "public"
---

# 記事のタイトル

本文をここに書きます。Markdown形式で自由に記述できます。

## 見出し

- リスト1
- リスト2

**太字** や *斜体* も使えます。
```

### Front Matter（YAML ヘッダー）

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `title` | 記事タイトル | `"AIで変わる未来"` |
| `tags` | タグのリスト | `["AI", "技術"]` |
| `status` | 公開設定（任意） | `"draft"` or `"public"` |

---

## 🔐 NOTE_STORAGE_STATE_JSON の取得方法

note.com へのログインには Playwright の storageState（Cookie 情報）を使用します。

### 1. ローカル環境の準備

```bash
npm install playwright
npx playwright install chromium
```

### 2. ログインスクリプトの実行

リポジトリに含まれる `login-note.mjs` を実行します：

```bash
node login-note.mjs
```

### 3. 手動ログイン

1. ブラウザが自動起動し、note.com のログインページが開きます
2. **手動で**ログインしてください（メール/Google/Twitter等）
3. ログイン完了後、**editor.note.com のページが開くまで待ちます**（重要！）
4. スクリプトが自動でログイン状態を `note-state.json` に保存します

### 4. Secret に登録

1. 生成された `note-state.json` の内容をコピー
2. GitHub リポジトリの `Settings` > `Secrets and variables` > `Actions`
3. `New repository secret` をクリック
4. Name: `NOTE_STORAGE_STATE_JSON`
5. Secret: JSON の内容全体を貼り付け

> **重要**: login-note.mjs は note.com と editor.note.com の両方にアクセスして、クロスドメインの認証Cookieを確立します。これにより CORS エラーを防ぎます。

---

## 🛡️ Bot 検出回避の仕組み

note.com は Playwright などの自動化ツールを検出してブロックすることがあります。このシステムでは以下の対策を実装しています：

### ステルス設定（`scripts/post-from-md.mjs`）

```javascript
// Chrome フラグ
args: [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox'
]

// ブラウザ情報の偽装
userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
viewport: { width: 1920, height: 1080 },
locale: 'ja-JP',
timezoneId: 'Asia/Tokyo'

// navigator.webdriver の非表示化
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
});
```

---

## 📊 ワークフローの詳細

### スクリプト

| スクリプト | 説明 |
|-----------|------|
| `login-note.mjs` | note.com ログイン状態の取得 |
| `md-style-optimize.mjs` | Claude API で記事を note 向けに最適化 |
| `post-from-md.mjs` | Playwright で note.com に投稿 |

### ワークフローのステップ

1. **Resolve inputs**: 手動実行または push イベントを検出
   - Push イベント時: 変更された `.md` ファイルを自動検出
   - 手動実行時: ユーザーが指定したパラメータを使用
2. **Install deps**: Node.js 依存関係と Playwright のインストール
3. **Restore note login state**: Secret から storageState を復元
4. **Optimize markdown style**: Claude API でスタイル最適化
5. **Post to note**: Playwright で投稿（自動実行時は常に下書き保存）
6. **Upload debug screenshots**: エラー時のスクリーンショット保存

---

## 🎨 note.com エディタの仕様

### 新エディタの特徴

- **ドメイン**: `editor.note.com`（note.com とは別ドメイン）
- **フレームワーク**: ProseMirror（リッチテキストエディタ）
- **自動保存**: タイトル・本文入力後、自動的に下書き保存
- **SPA**: Single Page Application のため、要素のロードに時間がかかる

### セレクタ

```javascript
// タイトル
'textarea[placeholder="記事タイトル"]'

// 本文エディタ
'.ProseMirror[contenteditable="true"]'
'[role="textbox"][contenteditable="true"]'
```

---

## 🔧 トラブルシューティング

### ログインが切れた場合

`NOTE_STORAGE_STATE_JSON` の有効期限が切れた可能性があります。`login-note.mjs` を再実行して新しい storageState を取得してください。

### CORS エラー

`editor.note.com` から `note.com/api` へのアクセスが CORS でブロックされている場合：
1. `login-note.mjs` で editor.note.com にもアクセスしているか確認
2. 新しい storageState を再取得

### 保存ボタンが見つからない

note.com は自動保存機能があるため、下書きモードでは保存ボタンが見つからなくても問題ありません。スクリプトは自動保存を信頼して成功とみなします。

### UI 変更への対応

note.com の UI が変更された場合、`scripts/post-from-md.mjs` 内のセレクタを調整してください。

---

## 🔒 セキュリティ注意事項

- **機密情報の管理**: `note-state.json` は `.gitignore` に含まれており、リポジトリにコミットされません
- **Secret の保護**: GitHub Actions Secrets は暗号化されており、ログに出力されません
- **手動ログイン**: パスワードを環境変数に保存せず、手動ログイン方式を採用

---

## 💡 技術スタック

- **GitHub Actions**: CI/CD パイプライン
- **Playwright**: ブラウザ自動化（Chromium）
- **Claude API (Anthropic SDK)**: 文体最適化
- **Node.js**: スクリプト実行環境
- **gray-matter**: Markdown front matter パース

---

## 📚 参考リンク

- [Playwright 公式ドキュメント](https://playwright.dev/)
- [Anthropic API ドキュメント](https://docs.anthropic.com/)
- [note.com](https://note.com/)
- [GitHub Actions ドキュメント](https://docs.github.com/actions)

---

## 📄 ライセンス

MIT License

---

## 🤝 コントリビューション

Issue や Pull Request を歓迎します！

---

**Created with [Claude Code](https://claude.com/claude-code)**
