# 숫자섬 수학 탐험대

초등 1~6학년을 위한 만화 스토리형 수학 학습 웹앱입니다. 학년이 곧 레벨(Lv.1~Lv.6)이고, 학년마다 지역(과정) → 화(만화·해 보기·문제 5개) → 대장 문제로 구성됩니다.

- 1·2·4·5·6학년: 지역 2개 × 3화
- 3학년: 지역 3개(곱셈 숲·나눗셈 동굴·분수 성), 12화
- 전체 42화, 대장 문제 13개(크리스탈 13개)

- `index.html` — 앱 전체(외부 라이브러리 없음, 단일 파일)
- `manifest.webmanifest`, `sw.js`, `icon*` — 홈 화면 설치·오프라인용 PWA 파일
- `RESEARCH.md` — 학습지 리서치와 설계 노트

## 운영 주소 (GitHub Pages)

`main` 브랜치에 반영되면 GitHub Actions가 자동으로 테스트하고 배포합니다.

- 주소: https://limchaekuk-zzz0903.github.io/servicemap/
- 워크플로: `.github/workflows/math-adventure-pages.yml`
  - `math-adventure/` 아래가 바뀐 push·PR마다 `tests/e2e.js` 실행(문제 생성기 검사, 12화+대장 문제 전체 풀이, 오답 흐름, 질의응답, 모바일 레이아웃)
  - `main`에서 테스트를 통과하면 앱 파일만 모아 Pages로 배포
  - 배포마다 서비스 워커 캐시 이름이 커밋 SHA로 바뀌어, 설치된 앱도 새 버전을 받습니다
- **처음 한 번만**: 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 설정해야 합니다.
- 수동 재배포: Actions 탭 → "math-adventure → GitHub Pages" → Run workflow

배포된 주소에서는 질의응답이 **기본 도움말 모드**로 동작합니다(AI 셈이는 Claude 아티팩트 안에서만 동작).

## 테스트

```bash
cd math-adventure/tests
npm install && npx playwright install chromium
npm test
```

## 로컬 실행

```bash
cd math-adventure
python3 -m http.server 8000
# http://localhost:8000 접속
```

`index.html`을 바로 열어도 동작합니다(이 경우 오프라인 캐시는 꺼집니다).
진도는 브라우저 localStorage에 저장됩니다.

## 셈이에게 물어보기 (질의응답)

화면 오른쪽 아래 버튼이나 문제 카드의 "셈이에게 물어보기"로 질문할 수 있습니다.

- **AI 모드**: Claude 아티팩트로 열면 `sample` 기능으로 Claude가 대답합니다(첫 질문 때 사용 허락을 묻고, 보는 사람의 Claude 계정을 씁니다). 지금 보는 문제·상태·힌트를 함께 보내고, 풀이가 끝나기 전에는 정답을 말하지 않도록 지시합니다.
- **기본 도움말 모드**: 그 외 환경(로컬 실행, 허락 거절)에서는 낱말(분모, 나머지, 올림, 힌트 등)에 맞춰 내장 설명으로 대답합니다. 대화는 저장하지 않습니다.
