# nsfw-service

`opennsfw2` 기반의 내부 서브서비스입니다.

- `nsfw-api`: 업로드된 이미지를 분류하는 FastAPI 서비스
- `nsfw-cli`: 로컬 파일 일괄 분류용 CLI

루트 `docker-compose.yml`에서 함께 실행하도록 구성되어 있으므로, 보통은 이 폴더 안의 개별 compose를 직접 사용할 필요가 없습니다.
