#!/usr/bin/env node
/**
 * geo-score.js — 온페이지 GEO(생성형 엔진 최적화) 채점기 (Phase 1)
 *
 * 빌드/의존성 없이 node 만으로 동작합니다.
 * 각 글의 HTML을 정적 분석해 0~100점으로 채점하고,
 * 항목별 진단과 개선 제안을 출력합니다.
 *
 * 사용법:
 *   node tools/geo-score.js                      # posts/*.html 전체 채점
 *   node tools/geo-score.js posts/jachi-summer.html
 *   node tools/geo-score.js --json posts/*.html  # 기계용 JSON 출력
 *
 * "GEO score"는 'AI 답변 엔진(ChatGPT/Perplexity/구글 AI 개요 등)이
 * 이 페이지를 인용하기 좋게 만들어졌는가'를 가중치로 평가한 점수입니다.
 * 실제 인용 여부는 Phase 2(geo-cite-test.js)에서 측정합니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// HTML 추출 헬퍼 (우리가 만든 통제된 HTML이라 정규식 파싱으로 충분)
// ─────────────────────────────────────────────────────────────
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

function countMatches(html, re) {
  const m = html.match(re);
  return m ? m.length : 0;
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

function parseJsonLd(head) {
  const blocks = [...head.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const types = [];
  for (const b of blocks) {
    try {
      const json = JSON.parse(b[1].trim());
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (node && node['@type']) types.push(String(node['@type']));
      }
    } catch (_) { /* 깨진 JSON-LD는 타입 미인정 */ }
  }
  return { count: blocks.length, types };
}

// ─────────────────────────────────────────────────────────────
// 채점 기준 (가중치 합 = 100)
// ─────────────────────────────────────────────────────────────
function score(html, file) {
  const head = section(html, 'head') || html;
  const body = section(html, 'body') || html;
  const main = section(body, 'main') || body;
  const text = stripTags(main);
  const words = text.length; // 한국어라 글자수 기준
  const ld = parseJsonLd(head);

  const checks = [];
  const add = (name, got, max, status, note) =>
    checks.push({ name, got: Math.round(got * 10) / 10, max, status, note });

  // 1) JSON-LD 구조화 데이터 (14): Article 6 + 리스트/HowTo 4 + FAQPage 4
  {
    const has = (t) => ld.types.some((x) => x.toLowerCase().includes(t));
    let s = 0;
    const missing = [];
    if (has('article')) s += 6; else missing.push('Article');
    if (has('itemlist') || has('howto')) s += 4; else missing.push('ItemList/HowTo');
    if (has('faqpage')) s += 4; else missing.push('FAQPage');
    add('JSON-LD 구조화 데이터', s, 14, grade(s, 14),
      missing.length ? `누락 스키마: ${missing.join(', ')}` : '핵심 스키마 모두 존재');
  }

  // 2) 답변 우선(요약/결론) (12)
  {
    // 상단 문단 중 .meta(날짜)·제휴고지를 빼고 첫 '실질 리드'를 찾는다
    const leadLen = [...main.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .slice(0, 4)
      .filter((m) => !/class=["'][^"']*\b(meta|disclosure)/i.test(m[0]))
      .map((m) => stripTags(m[1]).length)
      .find((len) => len >= 40) || 0;
    const hasConclusion = /결론|요약|정리하면|한 줄/i.test(text);
    const hasIntroLead = leadLen >= 40 && leadLen <= 600;
    let s = 0;
    if (hasIntroLead) s += 7;
    if (hasConclusion) s += 5;
    const note = [
      hasIntroLead ? null : '첫 문단을 핵심 답을 먼저 주는 40~600자 리드로',
      hasConclusion ? null : '결론/요약 섹션 추가(AI가 인용하기 쉬움)',
    ].filter(Boolean).join(' · ') || '리드+결론 구조 양호';
    add('답변 우선(리드·결론)', s, 12, grade(s, 12), note);
  }

  // 3) FAQ Q&A (10): 3쌍 이상
  {
    const faq = countMatches(main, /<details/gi) +
      countMatches(main, /<h[23][^>]*>[^<]*\?<\/h[23]>/gi);
    const s = Math.min(10, faq * 3.34);
    add('FAQ(질문·답변)', s, 10, grade(s, 10),
      faq >= 3 ? `Q&A ${faq}개` : `Q&A ${faq}개 → 3개 이상 권장`);
  }

  // 4) 비교표 (8)
  {
    const tables = countMatches(main, /<table/gi);
    const hasHeader = /<th[\s>]/i.test(main);
    const s = tables ? (hasHeader ? 8 : 5) : 0;
    add('비교표', s, 8, grade(s, 8),
      tables ? (hasHeader ? `표 ${tables}개(헤더 있음)` : '표에 <th> 헤더 추가') : '비교표 없음(스펙·가격 표 추가 권장)');
  }

  // 5) 제목 위계·질문형 (10): h1 1개 5 + h2 3개+ 3 + 질문형 헤딩 2
  {
    const h1 = countMatches(main, /<h1[\s>]/gi);
    const h2 = countMatches(main, /<h2[\s>]/gi);
    const qHead = countMatches(main, /<(h2|summary)[^>]*>[^<]*(\?|어떻게|왜|언제|무엇|뭐|얼마)/gi);
    let s = 0;
    if (h1 === 1) s += 5; else s += h1 === 0 ? 0 : 2;
    if (h2 >= 3) s += 3; else s += h2;
    if (qHead >= 1) s += 2;
    const note = [
      h1 === 1 ? null : `h1 ${h1}개(정확히 1개 권장)`,
      h2 >= 3 ? null : `h2 ${h2}개(3개 이상 권장)`,
      qHead >= 1 ? null : '질문형 소제목으로 검색 의도 매칭',
    ].filter(Boolean).join(' · ') || '제목 위계 양호';
    add('제목 위계·질문형', s, 10, grade(s, 10), note);
  }

  // 6) 외부 출처/인용 (12): 제휴·자기 도메인 제외한 권위 있는 외부 링크
  {
    const links = [...main.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
    const ext = links.filter((u) =>
      !/coupang\.com|link\.coupang|github\.io|example\.com/i.test(u));
    const uniq = [...new Set(ext.map((u) => u.replace(/^https?:\/\//, '').split('/')[0]))];
    const s = Math.min(12, uniq.length * 4);
    add('외부 출처·인용', s, 12, grade(s, 12),
      uniq.length ? `권위 도메인 ${uniq.length}개 인용` :
        '외부 근거 0개 → 제조사·기관·리뷰 등 신뢰 출처 링크 추가(GEO 인용율 핵심)');
  }

  // 7) 신선도 (8): datePublished+dateModified 4 + 제목 연도 2 + 본문 시점고지 2
  {
    const dp = /"datePublished"/i.test(head);
    const dm = /"dateModified"/i.test(head);
    const title = attr(head, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const yearInTitle = /20\d{2}/.test(title);
    const asOf = /작성 시점|기준\(|변동/.test(text);
    let s = 0;
    if (dp) s += 2;
    if (dm) s += 2;
    if (yearInTitle) s += 2;
    if (asOf) s += 2;
    add('신선도(날짜)', s, 8, grade(s, 8),
      [dp ? null : 'datePublished', dm ? null : 'dateModified',
       yearInTitle ? null : '제목에 연도', asOf ? null : '시점 고지']
        .filter(Boolean).map((x) => `${x} 추가`).join(' · ') || '신선도 신호 충분');
  }

  // 8) 구체 수치·스펙 (10): 숫자/단위 밀도
  {
    const units = countMatches(text, /\d[\d,.]*\s?(만원|원|cm|mm|mAh|kWh|%|L|kg|등급|인치|W|GB|TB|만)/gi);
    const density = words ? (units / words) * 1000 : 0; // 1000자당 수치 개수
    const s = Math.min(10, Math.round(Math.min(units, 12) / 12 * 10));
    add('구체 수치·스펙', s, 10, grade(s, 10),
      units >= 8 ? `수치 인용 ${units}개(밀도 ${density.toFixed(1)}/1k자)` :
        `수치 ${units}개 → 가격·스펙 등 구체 숫자 더 추가(GEO 인용↑)`);
  }

  // 9) 메타·시맨틱 (8): title 8~60자 2 + desc 50~160자 3 + canonical 1.5 + og 1.5
  {
    const title = attr(head, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const desc = attr(head, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const canonical = /rel=["']canonical["']/i.test(head);
    const og = countMatches(head, /property=["']og:/gi) >= 2;
    let s = 0;
    if (title.length >= 8 && title.length <= 65) s += 2;
    if (desc.length >= 50 && desc.length <= 165) s += 3; else if (desc) s += 1.5;
    if (canonical) s += 1.5;
    if (og) s += 1.5;
    add('메타·시맨틱', s, 8, grade(s, 8),
      [title.length >= 8 && title.length <= 65 ? null : `title ${title.length}자(8~65 권장)`,
       desc.length >= 50 && desc.length <= 165 ? null : `meta description ${desc.length}자(50~160 권장)`,
       canonical ? null : 'canonical', og ? null : 'og:* 태그']
        .filter(Boolean).join(' · ') || '메타 양호');
  }

  // 10) 목록·스캔 용이성 (8)
  {
    const lists = countMatches(main, /<ul[\s>]/gi) + countMatches(main, /<ol[\s>]/gi);
    const li = countMatches(main, /<li[\s>]/gi);
    const s = Math.min(8, lists * 2 + Math.min(li / 6, 2));
    add('목록·스캔 용이성', s, 8, grade(s, 8),
      lists ? `목록 ${lists}개·항목 ${li}개` : '핵심 내용을 불릿 목록으로 정리');
  }

  const total = checks.reduce((a, c) => a + c.got, 0);
  return { file, total: Math.round(total), grade: letter(total), words, checks };
}

function grade(got, max) {
  const r = max ? got / max : 0;
  return r >= 0.8 ? 'pass' : r >= 0.4 ? 'partial' : 'fail';
}
function letter(t) {
  return t >= 90 ? 'A' : t >= 80 ? 'B+' : t >= 70 ? 'B' : t >= 60 ? 'C' : t >= 50 ? 'D' : 'F';
}

// ─────────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────────
const ICON = { pass: '✓', partial: '△', fail: '✗' };
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };
const COLOR = { pass: C.green, partial: C.yellow, fail: C.red };
const useColor = process.stdout.isTTY;
const col = (c, s) => (useColor ? c + s + C.reset : s);

function report(r) {
  const gradeColor = r.total >= 80 ? C.green : r.total >= 60 ? C.yellow : C.red;
  console.log('');
  console.log(col(C.bold, path.relative(process.cwd(), r.file)));
  console.log(col(gradeColor, `GEO Score: ${r.total} / 100  (${r.grade})`) +
    col(C.dim, `   · 본문 ${r.words}자`));
  console.log('─'.repeat(52));
  for (const c of r.checks) {
    const bar = `${c.got}/${c.max}`.padStart(7);
    const line = `${ICON[c.status]} ${c.name.padEnd(16, ' ')} ${bar}`;
    console.log(col(COLOR[c.status], line) + col(C.dim, c.status === 'pass' ? '' : `  ${c.note}`));
  }
  const todos = r.checks.filter((c) => c.status !== 'pass');
  if (todos.length) {
    console.log(col(C.cyan, `\n개선 제안 ${todos.length}건:`));
    todos.sort((a, b) => (b.max - b.got) - (a.max - a.got));
    todos.forEach((c, i) =>
      console.log(`  ${i + 1}. [${c.name}] ${c.note}  ${col(C.dim, `(+${Math.round(c.max - c.got)}점 여력)`)}`));
  }
}

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────
function expand(args) {
  if (!args.length) {
    const dir = path.join(process.cwd(), 'posts');
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'template.html')
          .map((f) => path.join(dir, f))
      : [];
  }
  return args.map((a) => path.resolve(a));
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const files = expand(argv.filter((a) => !a.startsWith('--')));
  if (!files.length) {
    console.error('채점할 HTML이 없습니다. 예: node tools/geo-score.js posts/jachi-summer.html');
    process.exit(1);
  }
  const results = files.map((f) => score(fs.readFileSync(f, 'utf8'), f));

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  results.forEach(report);
  if (results.length > 1) {
    const avg = Math.round(results.reduce((a, r) => a + r.total, 0) / results.length);
    console.log(col(C.bold, `\n평균 GEO Score: ${avg} / 100  (${results.length}개 글)`));
  }
  console.log('');
}

main();
