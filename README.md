# Seedance 2.0 Local

개인용 BytePlus ModelArk Seedance 2.0 영상 생성 웹 UI.
다중 레퍼런스(이미지 9 + 영상 3) 모드와 First/Last Frame 모드를 모두 지원한다.

## 셋업

전제: **Python 3.10+** 가 설치돼 있어야 한다. python.org 인스톨러 사용 시 "Add python.exe to PATH" 와 "py launcher" 체크.

1) **최초 1회** — 가상환경 생성 + 의존성 설치
```
setup.bat
```
`.venv\` 폴더가 만들어지고 `requirements.txt` 의 패키지들이 그 안에 설치된다. 시스템 파이썬은 건드리지 않는다.
`.env` 도 자동으로 `.env.example` 에서 복사된다.

2) `.env` 의 `ARK_API_KEY` 를 발급받은 BytePlus ModelArk API 키로 채운다.

3) **실행** — 그 다음부터는 이거만 더블클릭
```
run.bat
```
브라우저가 자동으로 http://127.0.0.1:8000 을 연다.

> 의존성이 추가되거나 `.venv` 가 망가졌으면 `setup.bat` 을 다시 돌리면 된다 (기존 .venv 를 재사용해 추가 설치만 수행).

> **다른 PC 로 복사할 때 주의**: `.venv\` 는 폴더 안에 원본 파이썬 경로가 박혀있어서 그대로 옮기면 동작하지 않는다. 복사 전 `.venv\`, `__pycache__\`, `uploads\` 를 빼고 옮기는 게 깔끔하다. 만약 `.venv\` 가 같이 따라왔어도, 새 PC 에서 `setup.bat` 이 깨진 걸 감지해 자동으로 지우고 새로 만든다.

## 업로드 모드 두 가지

API 는 `image_url` / `video_url` 필드에 **URL 만** 받는다. 로컬 파일을 쓰려면 두 가지 옵션이 있다.

### A. Base64 Data URI (기본값)
파일을 `data:image/png;base64,...` 형태로 인라인 임베드해서 그대로 전송.
- **장점**: 추가 셋업 0. 작은 이미지에는 가장 편함.
- **단점**: BytePlus 가 data URI 를 받아들이는지 모델/엔드포인트에 따라 다를 수 있음. 영상 같은 큰 파일은 비효율적.
- 먼저 이 모드로 시도해보고, 거부 응답이 오면 B로 전환.

### B. Public URL (터널링)
`/uploads/` 에 저장하고 로컬 URL 을 BytePlus 가 가져가게 한다.
BytePlus 서버가 내 PC 에 접근 가능해야 하므로 **터널이 필요**하다.

```
# cloudflared (권장)
cloudflared tunnel --url http://localhost:8000
# 또는 ngrok
ngrok http 8000
```
출력에 나온 공개 URL 을 `.env` 의 `PUBLIC_BASE_URL` 에 넣고 서버 재시작.

## 사용 흐름

1. 상단에서 **모드 선택**
   - **다중 레퍼런스**: 이미지/영상을 여러 개 추가. 프롬프트에서 `@image1`, `@video1` 형태로 참조.
   - **First / Last Frame**: 시작/끝 프레임 이미지를 지정. 끝 프레임은 선택.
2. 프롬프트 입력, 해상도/비율/길이 등 조정.
3. **영상 생성 요청** 클릭. 작업 ID 가 나오고 자동 폴링이 시작됨.
4. 완료 시 영상 플레이어와 URL 이 표시됨. **24시간 후 만료**되므로 다운로드 권장.

## API 제약 (BytePlus 기준)

- First/Last Frame 모드와 다중 레퍼런스 모드는 **동시 사용 불가**.
- 이미지 최대 9개, 영상 최대 3개.
- 생성된 영상 URL 은 24시간 후 만료.
- 모델 ID
  - Standard: `dreamina-seedance-2-0-260128`
  - Fast: `dreamina-seedance-2-0-fast-260128`

## 파일 구조

```
seedance-web/
  setup.bat            최초 1회: .venv 생성 + 의존성 설치
  run.bat              평소 실행: .venv 의 uvicorn 으로 서버 기동
  main.py              FastAPI 엔드포인트
  seedance_client.py   ModelArk REST 래퍼
  static/              프론트엔드 (단일 페이지)
  uploads/             public_url 모드일 때 임시 저장
  .env                 ARK_API_KEY 등 (gitignore)
  .venv/               가상환경 (gitignore, setup.bat 가 생성)
```
