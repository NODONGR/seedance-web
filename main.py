"""FastAPI server for personal Seedance 2.0 video generation."""
from __future__ import annotations

import base64
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from seedance_client import (
    MODEL_FAST,
    MODEL_STANDARD,
    SeedanceClient,
    SeedanceError,
    build_content_image,
    build_content_text,
    build_content_video,
)

load_dotenv()

ROOT = Path(__file__).parent
UPLOAD_DIR = ROOT / "uploads"
STATIC_DIR = ROOT / "static"
UPLOAD_DIR.mkdir(exist_ok=True)

ARK_API_KEY = os.getenv("ARK_API_KEY", "")
ARK_BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

app = FastAPI(title="Seedance 2.0 Local")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


def get_client() -> SeedanceClient:
    if not ARK_API_KEY:
        raise HTTPException(status_code=500, detail="ARK_API_KEY is not configured in .env")
    return SeedanceClient(api_key=ARK_API_KEY, base_url=ARK_BASE_URL)


# ----- File upload: returns either a data URI (default) or a public URL -----

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    mode: Literal["data_uri", "public_url"] = Form("data_uri"),
) -> dict[str, Any]:
    """Accept an image or video upload.

    mode=data_uri  → return base64 data URI (works only if BytePlus accepts it,
                     and only practical for small files like images)
    mode=public_url → save to /uploads/ and return a URL. Requires the server
                      to be reachable from BytePlus (use ngrok / cloudflared
                      tunnel and set PUBLIC_BASE_URL accordingly)
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    if mode == "data_uri":
        b64 = base64.b64encode(data).decode("ascii")
        uri = f"data:{content_type};base64,{b64}"
        return {"mode": "data_uri", "url": uri, "size": len(data), "content_type": content_type}

    suffix = Path(file.filename or "").suffix or mimetypes.guess_extension(content_type) or ""
    name = f"{uuid.uuid4().hex}{suffix}"
    out = UPLOAD_DIR / name
    out.write_bytes(data)
    return {
        "mode": "public_url",
        "url": f"{PUBLIC_BASE_URL}/uploads/{name}",
        "size": len(data),
        "content_type": content_type,
    }


# ----- Generation request schema -----

class ReferenceItem(BaseModel):
    kind: Literal["image", "video"]
    url: str
    role: Literal[
        "first_frame", "last_frame", "reference_image", "reference_video"
    ]


class GenerateRequest(BaseModel):
    model: Literal["standard", "fast"] = "standard"
    prompt: str = Field(default="", description="text prompt; may be empty if references suffice")
    references: list[ReferenceItem] = Field(default_factory=list)
    ratio: str = "16:9"
    resolution: str = "720p"
    duration: int = Field(default=5, ge=4, le=15)
    seed: int | None = None
    watermark: bool = False
    generate_audio: bool = False
    return_last_frame: bool = False
    negative_prompt: str | None = None


def _validate_mode(refs: list[ReferenceItem]) -> None:
    """API constraint: first/last frame mode cannot mix with multimodal reference mode."""
    has_frame = any(r.role in ("first_frame", "last_frame") for r in refs)
    has_multi = any(r.role in ("reference_image", "reference_video") for r in refs)
    if has_frame and has_multi:
        raise HTTPException(
            status_code=400,
            detail="Cannot mix first/last-frame mode with multimodal reference mode.",
        )
    image_count = sum(1 for r in refs if r.kind == "image" and r.role.startswith("reference"))
    video_count = sum(1 for r in refs if r.kind == "video" and r.role.startswith("reference"))
    if image_count > 9:
        raise HTTPException(status_code=400, detail="Up to 9 reference images allowed")
    if video_count > 3:
        raise HTTPException(status_code=400, detail="Up to 3 reference videos allowed")
    first_frames = sum(1 for r in refs if r.role == "first_frame")
    last_frames = sum(1 for r in refs if r.role == "last_frame")
    if first_frames > 1 or last_frames > 1:
        raise HTTPException(status_code=400, detail="Only one first_frame and one last_frame allowed")


def _build_payload(req: GenerateRequest) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    if req.prompt.strip():
        content.append(build_content_text(req.prompt.strip()))
    for ref in req.references:
        if ref.kind == "image":
            content.append(build_content_image(ref.url, role=ref.role))
        else:
            content.append(build_content_video(ref.url, role=ref.role))

    payload: dict[str, Any] = {
        "model": MODEL_FAST if req.model == "fast" else MODEL_STANDARD,
        "content": content,
        "ratio": req.ratio,
        "resolution": req.resolution,
        "duration": req.duration,
        "generate_audio": req.generate_audio,
        "return_last_frame": req.return_last_frame,
        "watermark": req.watermark,
    }
    if req.seed is not None:
        payload["seed"] = req.seed
    if req.negative_prompt:
        payload["negative_prompt"] = req.negative_prompt
    return payload


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> dict[str, Any]:
    _validate_mode(req.references)
    if not req.prompt.strip() and not req.references:
        raise HTTPException(status_code=400, detail="prompt or references required")

    client = get_client()
    payload = _build_payload(req)
    try:
        resp = await client.create_task(payload)
    except SeedanceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    task_id = resp.get("id") or resp.get("task_id") or resp.get("data", {}).get("id")
    return {"task_id": task_id, "raw": resp, "payload_sent": payload}


@app.get("/api/task/{task_id}")
async def task_status(task_id: str) -> dict[str, Any]:
    client = get_client()
    try:
        resp = await client.get_task(task_id)
    except SeedanceError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return resp


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "api_key_configured": bool(ARK_API_KEY),
        "base_url": ARK_BASE_URL,
        "public_base_url": PUBLIC_BASE_URL,
    }


# ----- Static frontend -----

@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
