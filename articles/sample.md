---
title: "GitHub Actions で note へ下書きを自動化する（Markdown 取り込み編）"
tags: ["GitHub Actions","note","Playwright"]
status: "draft"
tone: "desu-masu"
---

# GitHub Actions で note へ下書きを自動化する（Markdown 取り込み編）

> Auto-post smoke test: ${DATE}

この記事では、GitHub Actions と Playwright を使って、手元で作成した Markdown 原稿を note に**下書き**として自動送信する流れを紹介します。

## 構成
- 記事はリポジトリの `articles/` 配下で管理
- 文体はワークフロー内で Anthropic API により最適化
- Playwright が note のエディタに貼り付け、下書き保存 or 公開

## 使い方（概要）
1. Secrets に `ANTHROPIC_API_KEY` と `NOTE_STORAGE_STATE_JSON` を設定
2. `articles/` に Markdown を置く（このファイルを雛形に）
3. Actions から「Note: Post from Markdown」を実行（`is_public` を false→最終確認→true）

## まとめ
Markdown 運用に寄せると、「執筆（ローカル/LLM）」「体裁調整（LLM）」「配信（自動化）」が分離でき、運用が楽になります。
