#!/usr/bin/env python3
"""Measure the fixed bilingual translated-voice fixtures through the public room."""

from __future__ import annotations

import argparse
import asyncio
import json
import time
import urllib.request
import wave
from io import BytesIO
from typing import Any

import websockets


PUBLIC_BASE = "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev"
FIXTURES = {
    "en_to_es": {
        "text": "Hola María, ¿cómo estás hoy?",
        "locale": "es-ES", "voice_profile": "es-ef-dora",
    },
    "es_to_en": {
        "text": "Hi David, I'm fine, thank you.",
        "locale": "en-US", "voice_profile": "en-us-af-heart",
    },
    "en_to_fr": {
        "text": "Bonjour Marie, comment allez-vous aujourd’hui ?",
        "locale": "fr-FR", "voice_profile": "fr-ff-siwis",
    },
}
TTS_WARM_TARGET_S = 2.0
VOICE_WARM_TARGET_S = 3.0
# The public Worker correctly rejects generic scripted traffic at Cloudflare's
# edge.  This is a browser-facing room receipt, so use the same browser-shaped
# user agent for both HTTPS and WebSocket handshake probes.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "Chrome/140 Safari/537.36"
)


def assert_warm_targets(records: list[dict[str, Any]]) -> None:
    limits = {"tts": TTS_WARM_TARGET_S, "voice": VOICE_WARM_TARGET_S}
    for record in records:
        if record["phase"] != "warm" or record["stage"] not in limits:
            continue
        limit = limits[record["stage"]]
        assert record["seconds"] <= limit, (
            f'{record["direction"]} warm {record["stage"]} '
            f'{record["seconds"]:.3f}s exceeded {limit:.1f}s')


def measurement_schedule(
    phase: str, directions: tuple[str, ...], samples: int,
) -> list[tuple[str, str, int]]:
    """Keep phase provenance explicit; request order cannot imply coldness."""
    return [
        (phase, direction, sample)
        for sample in range(1, samples + 1)
        for direction in directions
    ]


def _room(base: str) -> tuple[str, str]:
    request = urllib.request.Request(
        f"{base}/api/rooms", method="POST", data=b"",
        headers={"Origin": base, "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=15) as response:
        path = json.load(response)["path"]
    return path.rsplit("/", 1)[-1], path


async def _join(base: str, token: str, locale: str, voice_profile: str):
    websocket_base = base.replace("https://", "wss://").replace("http://", "ws://")
    socket = await websockets.connect(
        f"{websocket_base}/ws/{token}", origin=base, max_size=None,
        additional_headers={"User-Agent": USER_AGENT})
    await socket.send(json.dumps({
        "type": "join", "locale": locale, "name": "Latency fixture",
        "voice_profile": voice_profile,
    }))
    while True:
        message = json.loads(await socket.recv())
        if message.get("type") == "welcome":
            return socket, message["id"]


async def prime_stream_for_preload(
    socket: Any, wait_s: float, *, sleep: Any = asyncio.sleep,
) -> None:
    """Open the real compute stream with silence, then allow preload to overlap setup."""
    await socket.send(b"\0" * 3200)
    await sleep(wait_s)


async def send_heartbeat(socket: Any) -> None:
    await socket.send('{"type":"heartbeat"}')


def tts_payload(direction: str) -> dict[str, str]:
    """Build the current fail-closed Worker request for one fixed route."""
    fixture = FIXTURES[direction]
    return {
        "text": fixture["text"],
        "locale": fixture["locale"],
        "voice_profile": fixture["voice_profile"],
    }


def join_selection(direction: str) -> tuple[str, str]:
    """Return the listener identity the Worker will authorize for this route."""
    fixture = FIXTURES[direction]
    return fixture["locale"], fixture["voice_profile"]


async def _heartbeats(socket: Any) -> None:
    while True:
        await asyncio.sleep(8)
        await send_heartbeat(socket)


def _request(base: str, token: str, participant_id: str,
             direction: str, phase: str, sample: int) -> dict[str, Any]:
    fixture = FIXTURES[direction]
    body = json.dumps(tts_payload(direction), ensure_ascii=False).encode()
    request = urllib.request.Request(
        f"{base}/tts", method="POST", data=body,
        headers={
            "Origin": base, "User-Agent": USER_AGENT,
            "Authorization": f"Bearer {token}",
            "X-Participant-ID": participant_id,
            "Content-Type": "application/json; charset=utf-8",
        })
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=90) as response:
        audio = response.read()
        content_type = response.headers.get_content_type()
    seconds = time.monotonic() - started
    assert content_type == "audio/wav" and audio.startswith(b"RIFF")
    with wave.open(BytesIO(audio), "rb") as wav_file:
        assert wav_file.getnchannels() == 1 and wav_file.getsampwidth() == 2
        metadata = {
            "bytes": len(audio), "sample_rate": wav_file.getframerate(),
            "frames": wav_file.getnframes(),
        }
    return {
        "stage": "tts", "phase": phase, "direction": direction,
        "sample": sample, "seconds": round(seconds, 3), **metadata,
    }


async def run(
    base: str, phase: str, directions: tuple[str, ...], samples: int,
    preload_wait_s: float | None = None,
) -> list[dict[str, Any]]:
    token, _path = await asyncio.to_thread(_room, base)
    records = []
    preloaded = False
    for record_phase, direction, sample in measurement_schedule(
            phase, directions, samples):
        locale, voice_profile = join_selection(direction)
        socket, participant_id = await _join(base, token, locale, voice_profile)
        heartbeat = asyncio.create_task(_heartbeats(socket))
        try:
            if preload_wait_s is not None and not preloaded:
                await prime_stream_for_preload(socket, preload_wait_s)
                print(json.dumps({
                    "event": "stream_preload_probe", "wait_s": preload_wait_s,
                }, sort_keys=True), flush=True)
                preloaded = True
            record = await asyncio.to_thread(
                _request, base, token, participant_id,
                direction, record_phase, sample)
            records.append(record)
            print(json.dumps(record, sort_keys=True), flush=True)
        finally:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            await socket.close(1000, "latency fixture complete")
    assert_warm_targets(records)
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=PUBLIC_BASE)
    parser.add_argument("--phase", choices=("cold", "warm"), required=True,
                        help="phase established outside this process; never inferred from order")
    parser.add_argument("--direction", choices=tuple(FIXTURES), action="append",
                        dest="directions",
                        help="repeat to select directions (default: both)")
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--stream-preload-wait", type=float,
                        help="send one silent frame, then wait this many seconds")
    args = parser.parse_args()
    if not 1 <= args.samples <= 10:
        parser.error("--samples must be between 1 and 10")
    if args.stream_preload_wait is not None \
            and not 0 <= args.stream_preload_wait <= 80:
        parser.error("--stream-preload-wait must be between 0 and 80 seconds")
    directions = tuple(args.directions or FIXTURES)
    asyncio.run(run(
        args.base.rstrip("/"), args.phase, directions, args.samples,
        args.stream_preload_wait,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
