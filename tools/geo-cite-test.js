#!/usr/bin/env node
/**
 * geo-cite-test.js — 실제 인용 측정 (Phase 2)
 *
 * AI 답변 엔진이 특정 질문에 답할 때 내 페이지를 실제로 인용/참조하는지 측정합니다.
 * Anthropic API의 웹 검색 도구(web_search)를 켜고 질문을 던진 뒤,
 * 응답에 등장한 출처 URL 중 내 도메인이 있는지 확인합니다.
 * (= "이 질문에 대해 AI가 내 글을 근거로 쓰는가"의 대리 지표)
 *
 * 의존성 없이 Node 18+ 내장 fetch로 동작합니다.
 *
 * 준비:
 *   export ANTHROPIC_API_KEY=sk-ant-...      # 필수
 *   export GEO_SITE=tomttoms.github.io/recommend-site   # 선택(기본값 있음)
 *   export GEO_MODEL=claude-opus-4-8         # 선택(기본 opus-4-8)
 *
 * 사용:
 *   node tools/geo-cite-test.js "자취방 여름 더위템 추천"
 *   node tools/geo-cite-test.js "자취 필수 가전 추천" "원룸 첫 살림 가전"   # 여러 질문
 */
'use strict';

const SITE = process.env.GEO_SITE || 'tomttoms.github.io/recommend-site';
const MODEL = process.env.GEO_MODEL || 'claude-opus-4-8';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', yellow: '\x1b[33m' };
const tty = process.stdout.isTTY;
const col = (c, s) => (tty ? c + s + C.reset : s);

function usageAndExit() {
  console.log(`
${col(C.bold, 'geo-cite-test.js — 실제 인용 측정 (Phase 2)')}

이 도구는 Anthropic API 키가 필요합니다(호출당 과금: 웹 검색 + 모델 토큰).

  1) 키 발급:  https://console.anthropic.com  →  API Keys
  2) 키 설정:  ${col(C.cyan, 'export ANTHROPIC_API_KEY=sk-ant-...')}
  3) 실행:     ${col(C.cyan, 'node tools/geo-cite-test.js "자취방 여름 더위템 추천"')}

측정 대상 도메인(GEO_SITE): ${col(C.bold, SITE)}
  (다른 사이트면  export GEO_SITE=your.domain/path  로 변경)
`);
  process.exit(API_KEY ? 0 : 1);
}

// 응답 JSON 전체에서 http(s) URL을 긁어모은다(블록 구조 변화에 견고)
function collectUrls(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    const m = node.match(/https?:\/\/[^\s"'<>)\]]+/g);
    if (m) m.forEach((u) => out.add(u));
    return;
  }
  if (Array.isArray(node)) { node.forEach((n) => collectUrls(n, out)); return; }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) collectUrls(node[k], out);
  }
}

function domainOf(url) {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
}

async function askEngine(query) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages: [{ role: 'user', content: query }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();

  const urls = new Set();
  collectUrls(data.content, urls);
  const domains = [...new Set([...urls].map(domainOf))]
    .filter((d) => d && !d.includes('anthropic.com'));

  const siteHost = SITE.split('/')[0];
  const sitePath = SITE.includes('/') ? SITE.slice(siteHost.length) : '';
  const cited = [...urls].some((u) => {
    const noScheme = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return noScheme.startsWith(siteHost) && (!sitePath || noScheme.includes(sitePath));
  });

  return { cited, domains, urlCount: urls.size };
}

async function main() {
  const queries = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!API_KEY || !queries.length) return usageAndExit();

  console.log(col(C.bold, `\nGEO 인용 측정  ·  대상: ${SITE}  ·  모델: ${MODEL}`));
  console.log('─'.repeat(56));

  let hits = 0;
  for (const q of queries) {
    process.stdout.write(`질문: ${col(C.bold, q)}\n`);
    try {
      const { cited, domains, urlCount } = await askEngine(q);
      if (cited) hits++;
      const mark = cited ? col(C.green, '✓ 인용됨') : col(C.red, '✗ 미인용');
      console.log(`  결과: ${mark}  ${col(C.dim, `(출처 ${urlCount}개 검토)`)}`);
      const others = domains.filter((d) => !d.startsWith(SITE.split('/')[0])).slice(0, 6);
      if (others.length) {
        console.log(col(C.dim, `  실제 인용 도메인: ${others.join(', ')}`));
      }
    } catch (e) {
      console.log(col(C.yellow, `  오류: ${e.message}`));
    }
    console.log('');
  }

  const rate = queries.length ? Math.round((hits / queries.length) * 100) : 0;
  const rc = rate > 0 ? C.green : C.red;
  console.log(col(C.bold, `인용율: ${col(rc, `${hits}/${queries.length} (${rate}%)`)}`));
  console.log(col(C.dim, '※ 페이지 개선 후 며칠 뒤 재측정해 인용율 변화를 추적하세요.\n'));
}

main().catch((e) => { console.error(col(C.red, String(e))); process.exit(1); });
