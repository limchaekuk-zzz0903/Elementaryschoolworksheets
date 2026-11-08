# 숫자섬 수학 탐험대

초등 3학년을 위한 만화 스토리형 수학 학습 웹앱입니다. 곱셈·나눗셈은 복습, 분수는 개념부터 배웁니다.

- `index.html` — 앱 전체(외부 라이브러리 없음, 단일 파일)
- `manifest.webmanifest`, `sw.js`, `icon*` — 홈 화면 설치·오프라인용 PWA 파일
- `RESEARCH.md` — 학습지 리서치와 설계 노트

## 실행

```bash
cd math-adventure
python3 -m http.server 8000
# http://localhost:8000 접속
```

`index.html`을 바로 열어도 동작합니다(이 경우 오프라인 캐시는 꺼집니다).
진도는 브라우저 localStorage에 저장됩니다.
