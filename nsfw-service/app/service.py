from __future__ import annotations

import os
from pathlib import Path
from threading import Lock
from typing import Iterable, List

import numpy as np
import opennsfw2 as n2
from PIL import Image

from .config import settings


class NSFWService:
    def __init__(self) -> None:
        self._model = None
        self._lock = Lock()
        os.environ.setdefault("OPENNSFW2_HOME", str(settings.open_nsfw2_home))
        settings.open_nsfw2_home.mkdir(parents=True, exist_ok=True)

    def is_loaded(self) -> bool:
        return self._model is not None

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is None:
                self._model = n2.make_open_nsfw_model()
        return self._model

    def classify_label(self, score: float) -> str:
        if score < settings.safe_threshold:
            return "safe"
        if score > settings.nsfw_threshold:
            return "nsfw"
        return "review"

    def _predict_with_model(self, image_paths: List[str]) -> List[float]:
        model = self._ensure_model()
        processed = []
        for image_path in image_paths:
            with Image.open(image_path) as img:
                processed.append(n2.preprocess_image(img, n2.Preprocessing.YAHOO))
        inputs = np.stack(processed, axis=0)
        predictions = model.predict(inputs, verbose=0)
        return [float(row[1]) for row in predictions]

    def predict_path(self, image_path: str | Path) -> dict:
        path = str(Path(image_path))
        score = self._predict_with_model([path])[0]
        return {
            "path": path,
            "score": score,
            "label": self.classify_label(score),
        }

    def predict_paths(self, image_paths: Iterable[str | Path]) -> List[dict]:
        paths = [str(Path(p)) for p in image_paths]
        scores = self._predict_with_model(paths)
        results: List[dict] = []
        for path, score in zip(paths, scores):
            results.append(
                {
                    "path": path,
                    "score": score,
                    "label": self.classify_label(score),
                }
            )
        return results


service = NSFWService()
