from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable, List

from .service import service

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif", ".tiff"}


def gather_paths(inputs: List[str], recursive: bool) -> List[Path]:
    paths: List[Path] = []
    for item in inputs:
        path = Path(item)
        if path.is_dir():
            pattern = "**/*" if recursive else "*"
            for candidate in path.glob(pattern):
                if candidate.is_file() and candidate.suffix.lower() in ALLOWED_EXTENSIONS:
                    paths.append(candidate)
        elif path.is_file():
            if path.suffix.lower() in ALLOWED_EXTENSIONS:
                paths.append(path)
        else:
            matches = list(Path().glob(item))
            for candidate in matches:
                if candidate.is_file() and candidate.suffix.lower() in ALLOWED_EXTENSIONS:
                    paths.append(candidate)
    deduped = sorted({p.resolve() for p in paths})
    return deduped


def write_csv(rows: Iterable[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "score", "label"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser(description="opennsfw2 기반 이미지 NSFW 분류기")
    parser.add_argument("inputs", nargs="+", help="파일, 디렉터리 또는 glob 패턴")
    parser.add_argument("--recursive", action="store_true", help="디렉터리 재귀 탐색")
    parser.add_argument("--pretty", action="store_true", help="JSON 예쁘게 출력")
    parser.add_argument("--csv", type=Path, help="CSV 결과 저장 경로")
    args = parser.parse_args()

    paths = gather_paths(args.inputs, recursive=args.recursive)
    if not paths:
        raise SystemExit("처리할 이미지가 없습니다.")

    results = service.predict_paths(paths)

    if args.csv:
        write_csv(results, args.csv)

    indent = 2 if args.pretty else None
    print(json.dumps(results, ensure_ascii=False, indent=indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
