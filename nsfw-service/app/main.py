from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from .config import settings
from .schemas import BatchPredictRequest, BatchPredictResponse, HealthResponse, UploadPredictResponse
from .service import service

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif", ".tiff"}

app = FastAPI(
    title="Open NSFW 2 Service",
    version="1.0.0",
    description="Yahoo open_nsfw 계열 모델을 opennsfw2 기반으로 감싼 간단한 API",
)


def _validate_image_path(path_str: str) -> Path:
    path = Path(path_str)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if not path.is_file():
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension: {path.suffix}")
    return path


@app.get("/", response_model=HealthResponse)
def root() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=service.is_loaded(),
        weights_home=str(settings.open_nsfw2_home),
    )


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=service.is_loaded(),
        weights_home=str(settings.open_nsfw2_home),
    )


@app.post("/predict/path", response_model=UploadPredictResponse)
def predict_path(path: str) -> UploadPredictResponse:
    validated_path = _validate_image_path(path)
    result = service.predict_path(validated_path)
    return UploadPredictResponse(
        filename=validated_path.name,
        score=result["score"],
        label=result["label"],
        saved_temp_path=None,
    )


@app.post("/predict/paths", response_model=BatchPredictResponse)
def predict_paths(request: BatchPredictRequest) -> BatchPredictResponse:
    validated_paths = [_validate_image_path(path) for path in request.paths]
    results = service.predict_paths(validated_paths)
    return BatchPredictResponse(count=len(results), results=results)


@app.post("/predict/upload", response_model=UploadPredictResponse)
async def predict_upload(file: UploadFile = File(...)) -> UploadPredictResponse:
    suffix = Path(file.filename or "upload.jpg").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension: {suffix}")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max upload size is {settings.max_upload_mb} MB.",
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        result = service.predict_path(tmp_path)
        return UploadPredictResponse(
            filename=file.filename or tmp_path.name,
            score=result["score"],
            label=result["label"],
            saved_temp_path=None,
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
