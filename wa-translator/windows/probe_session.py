"""Session cookie for probes that create rooms.

Room creation is session-gated. Against a deployed worker, sign in once and
paste the ``lr_s`` cookie value into ``LINGUA_SESSION``. Against a local
worker (wrangler dev / the adapter), set ``ROOM_SIGNING_KEY`` to the dev
secret and a session is minted here — the same shape cloudflare/test/session.ts
mints for vitest.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time


def session_cookie() -> str | None:
    """Return a ``Cookie`` header value for /api/rooms, or None."""
    token = os.environ.get("LINGUA_SESSION")
    if not token:
        secret = os.environ.get("ROOM_SIGNING_KEY")
        if not secret:
            return None
        user_id = "TestHostUser0123456789"
        expires_at = int(time.time()) + 3600
        signature = hmac.new(
            secret.encode(), f"session.v1.{user_id}.{expires_at}".encode(),
            hashlib.sha256).digest()
        digest = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
        token = f"s1.{user_id}.{expires_at}.{digest}"
    return f"lr_s={token}"


if __name__ == "__main__":
    os.environ.pop("LINGUA_SESSION", None)
    os.environ["ROOM_SIGNING_KEY"] = "dev-secret"
    cookie = session_cookie()
    assert cookie is not None and cookie.startswith("lr_s=s1.TestHostUser0123456789."), cookie
    assert len(cookie.split(".")) == 4, cookie
    os.environ["LINGUA_SESSION"] = "s1.pasted.0.sig"
    assert session_cookie() == "lr_s=s1.pasted.0.sig"
    del os.environ["ROOM_SIGNING_KEY"], os.environ["LINGUA_SESSION"]
    assert session_cookie() is None
    print("ok")
