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

# Line-buffer the whole process, not just this module's print. Redirected to a
# file, Python block-buffers stdout: the share link never appears, and neither
# does anything translation_server logs — including the signal trace you need
# when someone reports that video will not connect.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Not 8765: another app on this machine listens there. Windows lets a second
# process bind an already-bound port instead of refusing, so both servers sit on
# it and whichever the OS picks answers the request — the room appears to start
# fine and then serves someone else's 404s.
PORT = translation_server.DEFAULT_PORT
CF_URL_RE = re.compile(rb"https://[-a-z0-9]+\.trycloudflare\.com")
LHR_URL_RE = re.compile(rb"https://[-a-z0-9]+\.lhr\.life")


def port_is_taken(port):
    """True when something already answers HTTP on this port.

    Checked because binding is not proof of ownership here: uvicorn will start
    happily alongside another listener, and the failure then looks like a bug in
    the room rather than a port collision.
    """
    import urllib.error
    import urllib.request
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
        return True
    except urllib.error.HTTPError:
        return True          # answered, just not with 200 — still occupied
    except Exception:
        return False


def _url_answers(url, timeout=20):
    """Can this machine reach the tunnel hostname yet?

    The server is not up at this point, so any HTTP response — including a 502
    from the edge — counts: what is being tested is whether the name is live.
    """
    import urllib.error
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=5)
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(2)
    return False


def _resolves_publicly(url):
    """Second opinion from a public resolver.

    This machine's ISP resolver does not return records for freshly-created
    trycloudflare and lhr.life hostnames, while 8.8.8.8 returns them
    immediately. Treating the local lookup as the verdict killed three working
    tunnels: a name this host cannot resolve may be perfectly reachable from the
    phone on the other end of the link.
    """
    host = url.split("://", 1)[-1].split("/", 1)[0]
    try:
        out = subprocess.run(["nslookup", host, "8.8.8.8"],
                             capture_output=True, timeout=15, text=True).stdout
    except Exception:
        return None                      # no second opinion available
    tail = out.split(host, 1)[-1] if host in out else out
    return "Address" in tail or "answer" in out.lower()


# Two providers, because quick tunnels are best-effort on both. cloudflared has
# been the more reliable of the pair here, and localhost.run needs no install —
# ssh ships with Git for Windows.
PROVIDERS = [
    ("cloudflared", ["cloudflared", "tunnel", "--url", "http://127.0.0.1:{port}"],
     CF_URL_RE, "stderr"),
    ("localhost.run", ["ssh", "-o", "StrictHostKeyChecking=accept-new",
                       "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
                       "-R", "80:127.0.0.1:{port}", "nokey@localhost.run"],
     LHR_URL_RE, "stdout"),
]


def _try_provider(name, argv, url_re, stream_name, port, timeout):
    """Start one tunnel provider; return (proc, url) or (None, None)."""
    argv = [a.format(port=port) for a in argv]
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE if stream_name == "stdout" else subprocess.DEVNULL,
            stderr=subprocess.PIPE)
    except FileNotFoundError:
        print(f"[tunnel] {name}: not installed, skipping")
        return None, None

    stream = proc.stdout if stream_name == "stdout" else proc.stderr
    url = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = stream.readline()
        if not line:
            break
        m = url_re.search(line)
        if m:
            url = m.group(0).decode()
            break

    if url is None:
        print(f"[tunnel] {name}: no URL within {timeout}s")
        proc.terminate()
        return None, None

    # These services print the hostname before it is resolvable, so give it a
    # moment. Do not treat a local lookup failure as proof the tunnel is dead —
    # this machine's ISP resolver misses fresh tunnel hostnames that 8.8.8.8
    # returns straight away, and killing on that signal throws away working
    # tunnels. Warn, keep it, and say who to blame.
    if not _url_answers(url):
        public = _resolves_publicly(url)
        if public:
            print(f"[tunnel] {name}: {url} does not resolve from this machine, but "
                  f"8.8.8.8 sees it — your DNS is behind, the link should still "
                  f"work for the other person.")
        elif public is None:
            print(f"[tunnel] {name}: {url} not reachable from here yet and no "
                  f"second opinion available — try the link before trusting this.")
        else:
            print(f"[tunnel] {name}: {url} does not resolve anywhere yet. It may "
                  f"still come up; if the link fails, restart.")

    # Keep reading the pipe, else the provider blocks once its buffer fills and
    # the tunnel strands mid-call. Surface what matters rather than discarding
    # it: a tunnel can die or re-register minutes after printing its first URL.
    def drain():
        for line in iter(stream.readline, b""):
            text = line.decode(errors="replace").rstrip()
            found = url_re.search(line)
            if found and found.group(0).decode() != url:
                print(f"[tunnel] URL CHANGED to {found.group(0).decode()} — "
                      f"the shared link is dead")
            elif any(w in text for w in ("ERR", "error", "failed", "Unauthorized")):
                print(f"[tunnel] {name}: {text}")
        print(f"[tunnel] {name} exited — the share link is dead")

    threading.Thread(target=drain, daemon=True).start()
    print(f"[tunnel] {name}: up")
    return proc, url


def start_tunnel(port=PORT, timeout=30):
    """Bring up a public HTTPS tunnel, trying each provider in turn."""
    for name, argv, url_re, stream_name in PROVIDERS:
        proc, url = _try_provider(name, argv, url_re, stream_name, port, timeout)
        if url:
            return proc, url
    print("[tunnel] no provider produced a working URL — running local only")
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="no public tunnel")
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()

    if port_is_taken(args.port):
        print(f"[room] port {args.port} is already answering HTTP — another server "
              f"owns it.\n[room] Windows will let this process bind it anyway and "
              f"then serve the wrong app.\n[room] Stop that server or pass --port.")
        return 1

    room_id = translation_server.create_room()
    tunnel = None
    if not args.local:
        tunnel, url = start_tunnel(args.port)
        if url:
            invite = f"{url}/room/{room_id}"
            print("\n" + "=" * 58)
            print("  Private WhatsApp invitation:")
            print(f"    {invite}")
            print("  Both of you open it, tap Start, and pick your language.")
            print("=" * 58 + "\n")

    print(f"[room] local:  http://localhost:{args.port}/room/{room_id}")
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
