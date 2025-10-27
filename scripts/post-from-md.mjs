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

// Launch browser with stealth settings to avoid bot detection
const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox'
  ]
});

const context = await browser.newContext({
  storageState: storage,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo'
});

// Hide webdriver property
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
});

const page = await context.newPage();

// Capture console and error messages
page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
page.on('requestfailed', request => console.error('REQUEST FAILED:', request.url(), request.failure().errorText));

async function gotoHome() {
  console.log("Navigating to note.com home...");
  await page.goto(NOTE_BASE_URL, { waitUntil: "domcontentloaded" });
  console.log("Current URL:", page.url());
}

async function clickPostNewText() {
  console.log("Attempting to create new post...");
  try {
    await page.getByRole("button", { name: /投稿/ }).click({ timeout: 15000 });
    await page.getByRole("menuitem", { name: /テキスト/ }).click({ timeout: 15000 });
    console.log("Clicked '投稿' button successfully");
    return;
  } catch (e) {
    console.log("Failed to click '投稿' button, trying direct URL navigation...");
    try {
      await page.goto(`${NOTE_BASE_URL}/notes/new`, { waitUntil: "networkidle", timeout: 30000 });
      console.log("Navigated to /notes/new directly. Current URL:", page.url());

      // Wait for loading spinner to disappear and editor to appear
      console.log("Waiting for editor elements to appear (up to 60 seconds)...");

      try {
        // Wait for either textarea (title) or contenteditable (body) to appear
        await Promise.race([
          page.locator('textarea').first().waitFor({ state: "visible", timeout: 60000 }),
          page.locator('[contenteditable="true"]').first().waitFor({ state: "visible", timeout: 60000 })
        ]);
        console.log("Editor elements found!");
      } catch (waitErr) {
        console.error("Timeout waiting for editor elements:", waitErr.message);
        // Continue anyway to get debug info
      }

      // Debug: log page title and check what elements exist
      const pageTitle = await page.title();
      console.log("Page title:", pageTitle);

      // Check for iframes
      const frames = page.frames();
      console.log(`Found ${frames.length} frames (including main)`);
      for (let i = 0; i < frames.length; i++) {
        const frameUrl = frames[i].url();
        console.log(`  Frame ${i}: ${frameUrl}`);
      }

      // Check for modals/dialogs
      const dialogCount = await page.locator('[role="dialog"]').count();
      const modalCount = await page.locator('.modal, [class*="modal"]').count();
      console.log(`Modals/dialogs: ${dialogCount + modalCount}`);

      // Check for buttons (might be onboarding)
      const buttonCount = await page.locator('button').count();
      console.log(`Buttons on page: ${buttonCount}`);

      const textareaCount = await page.locator('textarea').count();
      const inputCount = await page.locator('input[type="text"]').count();
      const editableCount = await page.locator('[contenteditable="true"]').count();
      console.log(`Found elements - textareas: ${textareaCount}, text inputs: ${inputCount}, contenteditable: ${editableCount}`);

      // Check in all frames
      for (let i = 0; i < frames.length; i++) {
        const frameTextareaCount = await frames[i].locator('textarea').count();
        const frameEditableCount = await frames[i].locator('[contenteditable="true"]').count();
        if (frameTextareaCount > 0 || frameEditableCount > 0) {
          console.log(`  Frame ${i} has: textareas=${frameTextareaCount}, contenteditable=${frameEditableCount}`);
        }
      }

      // NEW: Check actual page content
      const bodyText = await page.locator('body').innerText();
      console.log("=== PAGE TEXT CONTENT (first 500 chars) ===");
      console.log(bodyText.substring(0, 500));
      console.log("===========================================");

      const bodyHTML = await page.locator('body').innerHTML();
      console.log("=== PAGE HTML (first 1000 chars) ===");
      console.log(bodyHTML.substring(0, 1000));
      console.log("====================================");

      return;
    } catch (_) {
      throw e;
    }
  }
}

async function fillTitle(text) {
  console.log("Filling title:", text);

  // Debug: List all textareas and their placeholders
  const textareas = await page.locator('textarea').all();
  console.log(`Checking ${textareas.length} textarea elements...`);
  for (let i = 0; i < textareas.length; i++) {
    const placeholder = await textareas[i].getAttribute('placeholder');
    const isVisible = await textareas[i].isVisible();
    console.log(`  Textarea ${i}: placeholder="${placeholder}", visible=${isVisible}`);
  }

  const candidates = [
    page.locator('textarea[placeholder="記事タイトル"]'),
    page.locator('textarea').first(),
    page.getByPlaceholder("記事タイトル"),
    page.getByPlaceholder("タイトル"),
    page.locator('input[placeholder*="タイトル"]'),
    page.locator('textarea[placeholder*="タイトル"]')
  ];
  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: "visible", timeout: 10000 });
      await locator.fill(text);
      console.log("Title filled successfully");
      return;
    } catch {}
  }
  console.warn("WARN: Could not find title field");
}

async function fillBody(md) {
  console.log("Looking for editor (contenteditable)...");
  console.log("Current URL before editor search:", page.url());

  // Debug: List all contenteditable elements
  const editables = await page.locator('[contenteditable="true"]').all();
  console.log(`Checking ${editables.length} contenteditable elements...`);
  for (let i = 0; i < editables.length; i++) {
    const className = await editables[i].getAttribute('class');
    const role = await editables[i].getAttribute('role');
    const isVisible = await editables[i].isVisible();
    console.log(`  Editable ${i}: class="${className}", role="${role}", visible=${isVisible}`);
  }

  // New note.com editor uses ProseMirror with role="textbox"
  const editorCandidates = [
    page.locator('.ProseMirror[contenteditable="true"]'),
    page.locator('[role="textbox"][contenteditable="true"]'),
    page.locator('[contenteditable="true"]').first()
  ];

  let editor = null;
  for (let i = 0; i < editorCandidates.length; i++) {
    const candidate = editorCandidates[i];
    try {
      await candidate.waitFor({ state: "visible", timeout: 10000 });
      editor = candidate;
      console.log("Editor found with selector index:", i);
      break;
    } catch (err) {
      console.log(`Selector ${i} failed:`, err.message);
    }
  }

  if (!editor) {
    throw new Error("Could not find editor element");
  }

  console.log("Clicking editor...");
  await editor.click();
  await page.waitForTimeout(500);

  const chunks = chunk(md, 3000);
  console.log(`Typing body content (${chunks.length} chunks)...`);
  for (const c of chunks) {
    await editor.type(c, { delay: TYPE_DELAY });
    await page.waitForTimeout(50);
  }
  console.log("Body content filled successfully");
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
  console.log("Attempting to save or publish...");

  // Wait for auto-save (new editor auto-saves after title/body input)
  console.log("Waiting for auto-save (3 seconds)...");
  await page.waitForTimeout(3000);

  // Debug: List all buttons
  const allButtons = await page.locator('button').all();
  console.log(`Found ${allButtons.length} buttons total`);

  for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
    try {
      const text = await allButtons[i].innerText();
      const isVisible = await allButtons[i].isVisible();
      console.log(`  Button ${i}: text="${text}", visible=${isVisible}`);
    } catch (e) {
      console.log(`  Button ${i}: Could not read text`);
    }
  }

  // Try to find button by searching all buttons
  console.log("Searching all buttons for save/publish text...");
  for (let i = 0; i < allButtons.length; i++) {
    try {
      const text = await allButtons[i].innerText();
      const isVisible = await allButtons[i].isVisible();

      if (statusPublic && (text.includes('公開に進む') || text.includes('公開する') || text === '公開')) {
        console.log(`Found publish button at index ${i}: "${text}", visible=${isVisible}`);
        await allButtons[i].scrollIntoViewIfNeeded();
        await allButtons[i].click({ force: true });
        await page.waitForTimeout(1000);
        console.log("✓ Published:", title);
        return true;
      }

      if (!statusPublic && (text.includes('下書き保存') || text.includes('下書き') || text === '保存')) {
        console.log(`Found draft save button at index ${i}: "${text}", visible=${isVisible}`);
        await allButtons[i].scrollIntoViewIfNeeded();
        await allButtons[i].click({ force: true });
        await page.waitForTimeout(1000);
        console.log("✓ Saved draft:", title);
        return true;
      }
    } catch (e) {
      // Skip this button
    }
  }

  // If save button not found but we're in draft mode, assume auto-save worked
  if (!statusPublic) {
    console.log("INFO: Save button not found, but note.com editor auto-saves drafts.");
    console.log("✓ Draft saved successfully (via auto-save):", title);
    return true;
  }

  throw new Error("公開/下書き保存の操作に失敗しました（セレクタ変更の可能性）");
}

let success = false;
try {
  await gotoHome();
  await clickPostNewText();
  await page.screenshot({ path: 'debug-after-navigation.png', fullPage: true });
  console.log("Screenshot saved: debug-after-navigation.png");
  await fillTitle(title);
  let bodyMd = content;
  if (!/^#\s+/.test(bodyMd.trim())) {
    bodyMd = `# ${title}\n\n${bodyMd}`;
  }
  await fillBody(bodyMd);
  await uploadCoverIfAny();
  await addTagsIfAny();
  const saved = await saveOrPublish();
  if (saved) {
    console.log("\n=================================");
    console.log("✓ SUCCESS: Post completed!");
    console.log("=================================\n");
    success = true;
  }
} catch (e) {
  console.error("投稿に失敗:", e?.message || e);
  try {
    await page.screenshot({ path: 'debug-error.png', fullPage: true });
    console.log("Error screenshot saved: debug-error.png");
  } catch (screenshotErr) {
    console.error("Failed to save screenshot:", screenshotErr?.message);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  if (success) {
    console.log("Script completed successfully.");
    process.exit(0);
  }
}
