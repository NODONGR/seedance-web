"""BytePlus ModelArk Seedance 2.0 API client.

Wraps the async task lifecycle:
  - POST /contents/generations/tasks  → create task, returns task id
  - GET  /contents/generations/tasks/{id}  → poll status until terminal
"""
from __future__ import annotations

from typing import Any, Literal

import httpx

MODEL_STANDARD = "dreamina-seedance-2-0-260128"
MODEL_FAST = "dreamina-seedance-2-0-fast-260128"

Role = Literal[
    "first_frame",
    "last_frame",
    "reference_image",
    "reference_video",
    "reference_audio",
]


class SeedanceError(RuntimeError):
    pass


class SeedanceClient:
    def __init__(self, api_key: str, base_url: str, timeout: float = 60.0) -> None:
        if not api_key:
            raise SeedanceError("ARK_API_KEY is not set")
        self._base = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    async def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base}/contents/generations/tasks"
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.post(url, json=payload, headers=self._headers)
        self._raise_for_status(r)
        return r.json()

    async def get_task(self, task_id: str) -> dict[str, Any]:
        url = f"{self._base}/contents/generations/tasks/{task_id}"
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.get(url, headers=self._headers)
        self._raise_for_status(r)
        return r.json()

    @staticmethod
    def _raise_for_status(r: httpx.Response) -> None:
        if r.is_success:
            return
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text}
        raise SeedanceError(f"HTTP {r.status_code}: {body}")


def build_content_text(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def build_content_image(url: str, role: Role | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"type": "image_url", "image_url": {"url": url}}
    if role:
        item["role"] = role
    return item


def build_content_video(url: str, role: Role | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"type": "video_url", "video_url": {"url": url}}
    if role:
        item["role"] = role
    return item
