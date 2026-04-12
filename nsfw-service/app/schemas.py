from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PredictionItem(BaseModel):
    path: str
    score: float = Field(..., ge=0.0, le=1.0)
    label: str


class BatchPredictRequest(BaseModel):
    paths: List[str] = Field(..., min_length=1)


class BatchPredictResponse(BaseModel):
    count: int
    results: List[PredictionItem]


class UploadPredictResponse(BaseModel):
    filename: str
    score: float = Field(..., ge=0.0, le=1.0)
    label: str
    saved_temp_path: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    weights_home: str
