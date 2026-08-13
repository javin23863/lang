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
    "en_to_es": {"text": "Hola María, ¿cómo estás hoy?", "lang": "es"},
    "es_to_en": {"text": "Hi David, I'm fine, thank you.", "lang": "en"},
}
TTS_WARM_TARGET_S = 2.0
VOICE_WARM_TARGET_S = 3.0
USER_AGENT = "spoken-translation-latency-acceptance/1.0"


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


async def _join(base: str, token: str, lang: str):
    websocket_base = base.replace("https://", "wss://").replace("http://", "ws://")
    socket = await websockets.connect(
        f"{websocket_base}/ws/{token}", origin=base, max_size=None)
    await socket.send(json.dumps({
        "type": "join", "lang": lang, "name": "Latency fixture",
        "voice_style": "female",
    }))
    while True:
        message = json.loads(await socket.recv())
        if message.get("type") == "welcome":
            return socket, message["id"]


def _request(base: str, token: str, participant_id: str,
             direction: str, phase: str, sample: int) -> dict[str, Any]:
    fixture = FIXTURES[direction]
    body = json.dumps({
        "text": fixture["text"], "lang": fixture["lang"],
        "voice_style": "female",
    }, ensure_ascii=False).encode()
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
) -> list[dict[str, Any]]:
    token, _path = await asyncio.to_thread(_room, base)
    socket, participant_id = await _join(base, token, "en")
    records = []
    try:
        for record_phase, direction, sample in measurement_schedule(
                phase, directions, samples):
            record = await asyncio.to_thread(
                _request, base, token, participant_id,
                direction, record_phase, sample)
            records.append(record)
            print(json.dumps(record, sort_keys=True), flush=True)
    finally:
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
    args = parser.parse_args()
    if not 1 <= args.samples <= 10:
        parser.error("--samples must be between 1 and 10")
    directions = tuple(args.directions or FIXTURES)
    asyncio.run(run(args.base.rstrip("/"), args.phase, directions, args.samples))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
