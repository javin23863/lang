#!/usr/bin/env python3
"""run_room.py — start the room and print the link to share.

    python run_room.py            # server + cloudflared public link
    python run_room.py --local    # server only (same-machine testing)

The public link must be HTTPS or the browser refuses camera and microphone
access on the other person's phone, which is why this uses a tunnel rather than
just handing out a LAN address.
"""

import argparse
import re
import subprocess
import sys
import threading
import time

import translation_server

PORT = 8765
URL_RE = re.compile(rb"https://[-a-z0-9]+\.trycloudflare\.com")


def start_tunnel(port=PORT, timeout=30):
    """Launch cloudflared and return (process, public_url)."""
    try:
        proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except FileNotFoundError:
        print("[tunnel] cloudflared not on PATH — running local only")
        return None, None

    url = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stderr.readline()
        if not line:
            break
        m = URL_RE.search(line)
        if m:
            url = m.group(0).decode()
            break
    if url is None:
        print("[tunnel] cloudflared gave no URL in time; killing it")
        proc.terminate()
        return None, None

    # Keep draining stderr, else cloudflared blocks on a full pipe once its
    # log buffer fills — which strands the tunnel mid-call.
    threading.Thread(target=lambda: [None for _ in iter(proc.stderr.readline, b"")],
                     daemon=True).start()
    return proc, url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="no public tunnel")
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()

    tunnel = None
    if not args.local:
        tunnel, url = start_tunnel(args.port)
        if url:
            print("\n" + "=" * 58)
            print("  Share this link:")
            print(f"    {url}")
            print("  Both of you open it, tap Start, and pick your language.")
            print("=" * 58 + "\n")

    print(f"[room] local:  http://localhost:{args.port}")
    print(f"[room] mic/cam test: http://localhost:{args.port}/test")
    try:
        translation_server.run_server(port=args.port)
    except KeyboardInterrupt:
        pass
    finally:
        if tunnel:
            tunnel.terminate()
            print("[tunnel] closed")


if __name__ == "__main__":
    sys.exit(main())
