# 고른픽 — 제품 추천 정적 사이트

쿠팡 파트너스 채널이자 GEO(생성형 엔진 최적화) 테스트 대상이 될 정적 웹사이트입니다.
빌드 없이 그대로 배포됩니다.

## 구성
```
index.html          홈 (글 목록)
about.html          소개 + 쿠팡 파트너스 제휴 고지
posts/template.html GEO 최적화 추천 글 템플릿 (제품 정하면 채우기)
style.css           스타일
robots.txt          크롤러 허용
sitemap.xml         사이트맵
```

## 1) 먼저 바꿀 것 (커스터마이징)
- **브랜드명**: `고른픽` → 원하는 이름으로 전체 찾아바꾸기
- **도메인**: `https://example.com` → 실제 배포 주소로 전체 찾아바꾸기
  (canonical, og:url, sitemap, robots 안의 주소)
- **이메일**: `hello@example.com` → 실제 연락처
- **글 내용**: `posts/template.html` 의 `OO`, `제품 A` 등 자리표시자를 실제 제품으로

## 2) 무료 배포 (GitHub Pages 예시)
```bash
cd recommend-site
git init && git add -A && git commit -m "init recommend site"
# GitHub에서 빈 저장소 생성 후:
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
# GitHub 저장소 → Settings → Pages → Source: main / root → 저장
# 몇 분 뒤 https://<계정>.github.io/<저장소>/ 로 공개됨
```
대안: **Netlify**(폴더 드래그&드롭) · **Vercel**(import) · **Cloudflare Pages**.
커스텀 도메인을 연결하면 GEO·신뢰도에 더 좋습니다.

## 3) 쿠팡 파트너스 가입 체크리스트
- [ ] 위 사이트를 **배포**해 공개 URL 확보
- [ ] **제휴 고지**(about.html#disclosure) 페이지 확인 — 승인·정책 준수에 필요
- [ ] 실제 추천 글 **1~2개** 작성 (빈 채널은 승인 거절될 수 있음)
- [ ] 쿠팡 파트너스 가입 → **채널 URL 등록**
- [ ] 승인 후 발급된 **제휴 링크**를 글의 `최저가 보기` 버튼(`href="#"`)에 삽입
  - 링크에는 `rel="nofollow sponsored"` 유지 권장

## 4) GEO 테스트 연결 (geo-test 도구)
배포해서 URL이 생기면:
1. **노출 테스트**: 그 질문(예: "OO 추천")에 AI가 내 페이지를 인용하나? (인용율 = 성공)
2. **경쟁 비교(갭 진단)**: 실제 인용되는 승자 페이지 대비 뭘 보완할지
3. 페이지 개선 → 며칠 뒤 재측정 → 인용율 0% → ?%

> ⚠️ 쿠팡 파트너스 정책·가입 요건은 변경될 수 있으니 가입 화면에서 현재 기준을 확인하세요.
