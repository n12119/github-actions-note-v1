#!/usr/bin/env node
/**
 * Playwright で note に投稿/下書き保存
 *   - 入力: Markdown（front matter 付き）
 *   - storageState(JSON) を Secrets 経由で読み込み
 *   - UI 文言/構造変更に合わせてセレクタは適宜調整してください
 */
import fs from "fs/promises";
import path from "path";
import process from "process";
import matter from "gray-matter";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.split("=");
  return k.startsWith("--") ? [k.slice(2), v] : [k, v];
}));
const inPath   = args.in || args.i;
const storage  = args.storage || "./note-state.json";
const isPublic = String(args["is-public"] || "false").toLowerCase() === "true";

if (!inPath) {
  console.error("Usage: node scripts/post-from-md.mjs --in .out/optimized.md --storage note-state.json --is-public true|false");
  process.exit(1);
}

const NOTE_BASE_URL = process.env.NOTE_BASE_URL || "https://note.com";
const TYPE_DELAY = Number(process.env.NOTE_EDITOR_DELAY_MS || "0"); // 必要に応じて入力速度を落とす

const src = await fs.readFile(inPath, "utf8");
const { content, data } = matter(src);
const title = (data.title || "（無題）").toString();
const tags  = Array.isArray(data.tags) ? data.tags.map(String) : [];
const cover = data.cover_image ? path.resolve(path.dirname(inPath), String(data.cover_image)) : null;
const statusPublic = isPublic || String(data.status || "").toLowerCase() === "public";

// 文字列をチャンク分割（エディタ負荷軽減）
function chunk(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i+size));
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: storage });
const page    = await context.newPage();

async function gotoHome() {
  await page.goto(NOTE_BASE_URL, { waitUntil: "domcontentloaded" });
}

async function clickPostNewText() {
  try {
    await page.getByRole("button", { name: /投稿/ }).click({ timeout: 15000 });
    await page.getByRole("menuitem", { name: /テキスト/ }).click({ timeout: 15000 });
    return;
  } catch (e) {
    try {
      await page.goto(`${NOTE_BASE_URL}/notes/new`, { waitUntil: "domcontentloaded" });
      return;
    } catch (_) {
      throw e;
    }
  }
}

async function fillTitle(text) {
  const candidates = [
    page.getByPlaceholder("記事タイトル"),
    page.getByPlaceholder("タイトル"),
    page.locator('input[placeholder*="タイトル"]'),
    page.locator('textarea[placeholder*="タイトル"]')
  ];
  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.fill(text);
      return;
    } catch {}
  }
}

async function fillBody(md) {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor({ state: "visible", timeout: 15000 });
  await editor.click();
  const chunks = chunk(md, 3000);
  for (const c of chunks) {
    await editor.type(c, { delay: TYPE_DELAY });
    await page.waitForTimeout(50);
  }
}

async function uploadCoverIfAny() {
  if (!cover) return;
  const fileInput = page.locator('input[type="file"]').first();
  try {
    await fileInput.setInputFiles(cover, { timeout: 10000 });
  } catch (e) {
    console.warn("WARN: カバー画像のアップロードに失敗しました（スキップ）:", e?.message || e);
  }
}

async function openPublishSettings() {
  const candidates = [
    page.getByRole("button", { name: /公開設定/ }),
    page.getByRole("button", { name: /公開/ }),
    page.getByRole("button", { name: /設定/ })
  ];
  for (const locator of candidates) {
    try {
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      return;
    } catch {}
  }
}

async function addTagsIfAny() {
  if (!tags.length) return;
  try {
    await openPublishSettings();
    const tagInput = page.getByPlaceholder(/タグを追加|タグ/);
    await tagInput.waitFor({ state: "visible", timeout: 8000 });
    for (const t of tags) {
      await tagInput.fill(t);
      await tagInput.press("Enter");
      await page.waitForTimeout(150);
    }
  } catch (e) {
    console.warn("WARN: タグの設定に失敗しました（スキップ）:", e?.message || e);
  }
}

async function saveOrPublish() {
  await openPublishSettings();
  if (statusPublic) {
    const publishCandidates = [
      page.getByRole("button", { name: /^公開$/ }),
      page.getByRole("button", { name: /公開する/ })
    ];
    for (const b of publishCandidates) {
      try {
        await b.click({ timeout: 5000 });
        console.log("Published:", title);
        return;
      } catch {}
    }
  }
  const draftCandidates = [
    page.getByRole("button", { name: /下書き保存/ }),
    page.getByRole("button", { name: /保存/ })
  ];
  for (const b of draftCandidates) {
    try {
      await b.click({ timeout: 5000 });
      console.log("Saved draft:", title);
      return;
    } catch {}
  }
  throw new Error("公開/下書き保存の操作に失敗しました（セレクタ変更の可能性）");
}

try {
  await gotoHome();
  await clickPostNewText();
  await fillTitle(title);
  let bodyMd = content;
  if (!/^#\s+/.test(bodyMd.trim())) {
    bodyMd = `# ${title}\n\n${bodyMd}`;
  }
  await fillBody(bodyMd);
  await uploadCoverIfAny();
  await addTagsIfAny();
  await saveOrPublish();
} catch (e) {
  console.error("投稿に失敗:", e?.message || e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
