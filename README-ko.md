# Misskey LLM Bot + NSFW Service

Misskey에서 멘션과 답글에 응답하는 LLM 봇에 **ComfyUI 이미지 생성**과 **업로드 전 NSFW 차단**을 함께 묶은 정리본입니다.

이 저장소에는 다음이 포함됩니다.

- `bot.js`: 현재 통합된 메인 봇
- `package.json`: Node.js 의존성 및 실행 스크립트
- `Dockerfile`: 봇 컨테이너 빌드용
- `docker-compose.yml`: 봇 + NSFW API + NSFW CLI 구성
- `nsfw-service/`: `opennsfw2` 기반 서브서비스
- `workflows/`: ComfyUI API workflow 파일 위치

## 포함된 기능

- Misskey **멘션 / 답글 자동 응답**
- **Ollama / OpenAI 호환 API** 사용
- 관계 기반 **접근 제어**
- 선택적 **자동 맞팔**
- 선택적 **자동 포스트**
- **ComfyUI 이미지 생성 명령** 처리
- 생성 이미지의 **Misskey 업로드 전 NSFW 검사**
- 차단된 이미지의 **quarantine 저장**
- Misskey 스트리밍 API **자동 재연결**

## 빠른 시작

```bash
cp .env.example .env
docker compose up -d --build
```

로그 확인:

```bash
docker compose logs -f misskey-llm-bot
docker compose logs -f nsfw-api
```

## 꼭 채워야 하는 값

`.env`에서 최소한 아래 값은 실제 값으로 바꿔야 합니다.

- `MISSKEY_BASE_URL`
- `MISSKEY_TOKEN`
- `LLM_MODEL`

보통 호스트에서 Ollama를 쓰면 `LLM_API_URL=http://host.docker.internal:11434/v1/chat/completions` 그대로 사용하면 됩니다.

## ComfyUI 사용 시

`ENABLE_IMAGE_GENERATION=true`로 바꾸기 전에 아래를 먼저 해주세요.

1. 실제 **ComfyUI API workflow JSON**을 `workflows/comfyui_api_workflow.json`에 배치
2. `COMFYUI_BASE_URL`이 올바른지 확인
3. 모델 이름(`COMFYUI_DIFFUSION_MODEL`, `COMFYUI_TEXT_ENCODER`, `COMFYUI_VAE`)을 현재 환경에 맞게 수정

`workflows/comfyui_api_workflow.json`에는 자리표시자 예제가 들어 있지만, 실제 운영 전에는 네가 쓰는 워크플로로 교체하는 것이 안전합니다.

## NSFW 차단 동작

흐름은 아래와 같습니다.

1. 봇이 ComfyUI에 이미지 생성을 요청
2. 결과 이미지를 다운로드
3. Misskey Drive 업로드 직전에 `nsfw-api`로 검사
4. `safe`면 업로드
5. `review` 또는 `nsfw`면 업로드하지 않고 `quarantine/`에 저장

## 권장 Misskey 토큰 권한

일반적으로 아래 권한이 필요합니다.

- `read:account`
- `read:notifications`
- `write:notes`
- `write:following`
- 이미지 업로드를 쓸 경우 관련 Drive 쓰기 권한

## 프로젝트 구조

```text
.
├─ bot.js
├─ package.json
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
├─ .dockerignore
├─ workflows/
├─ quarantine/
├─ input/
├─ output/
├─ nsfw-cache/
└─ nsfw-service/
```

## Git에 올리기 전 체크

- `.env`가 커밋되지 않았는지 확인
- 실제 토큰, URL, 사용자 ID가 코드나 README에 남아 있지 않은지 확인
- `workflows/` 안의 JSON에 개인 경로나 민감한 값이 없는지 확인
- `quarantine/`, `input/`, `output/`, `nsfw-cache/` 내용물이 비어 있는지 확인
