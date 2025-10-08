#!/usr/bin/env node
/**
 * Markdown 文体最適化（Anthropic）
 *  - 見出し/リンク/コードブロックの構造を壊さずに note 向けに整形
 *  - tone: desu-masu | da-dearu
 */
import fs from "fs/promises";
import path from "path";
import process from "process";
import matter from "gray-matter";

const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.split("=");
  return k.startsWith("--") ? [k.slice(2), v] : [k, v];
}));
const inPath  = args.in || args.i;
const outPath = args.out || ".out/optimized.md";
const toneRaw = (args.tone || "desu-masu").toLowerCase();
const tone    = toneRaw === "da-dearu" ? "da-dearu" : "desu-masu";

if (!inPath) {
  console.error("Usage: node scripts/md-style-optimize.mjs --in articles/xxx.md [--out .out/optimized.md] [--tone desu-masu|da-dearu]");
  process.exit(1);
}

const src = await fs.readFile(inPath, "utf8");
const { content, data } = matter(src);

async function optimizeWithAnthropic(md) {
  const { Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("WARN: ANTHROPIC_API_KEY が未設定のため最適化をスキップします（元の原稿を使用）。");
    return md;
  }

  const system = [
    "あなたは日本語の編集者です。以下のMarkdown原稿を note 掲載向けに最適化してください。",
    "厳守事項：",
    "- 見出し階層、コードブロック、リンク、引用、リストは壊さない。",
    "- 事実関係は改変しない。根拠が薄い断定は避け、読者に誤解を与えない。",
    "- 句読点・記号のゆれ（。、！？」など）を正し、冗長表現を簡潔化する。",
    "- 箇条書きは各項目1〜2文を目安に簡潔にする。",
    "- 適切な位置に改行を挿入し、可読性を高める。",
    `- 文体は「${tone === "da-dearu" ? "だ・である調" : "です・ます調"}」で統一する。`,
    "- 出力は **Markdown の本文のみ** とし、余計な前置きや解説は付けない。"
  ].join("\n");

  const user = ["【原稿】", md].join("\n\n");

  const msg = await client.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4000,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }]
  });

  const blocks = msg.content || [];
  const text = blocks.map(b => b.text).join("");
  return text && text.trim().length > 0 ? text : md;
}

let optimized = content;
try {
  optimized = await optimizeWithAnthropic(content);
} catch (e) {
  console.warn("WARN: LLM最適化で例外が発生したため元の原稿を使用します:", e?.message || e);
}

// フロントマター補完：title が無ければ先頭 H1 を採用
const fm = { ...data };
if (!fm.title) {
  const m = optimized.match(/^#\s+(.+)$/m);
  if (m) fm.title = m[1].trim();
}
const out = matter.stringify(optimized, fm);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, out, "utf8");
console.log("Wrote", outPath);
