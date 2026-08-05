#!/usr/bin/env python3
"""
translator_app.py — WhatsApp Call Translator (Windows Host)

iTour-style architecture:
  1. Person A runs this app on Windows.
  2. App starts translation_server.py (FastAPI + WebSocket).
  3. App captures Person A's mic audio and sends it to the server via HTTP.
  4. App starts ngrok (background) and captures the public URL.
  5. Person A shares the URL via WhatsApp to Person B.
  6. Person B opens the URL → browser page → talks → captions on both sides.

This is the host-side controller GUI. It does NOT run ASR/MT directly —
that all happens inside translation_server.py. This app just:
  - Starts/stops the server subprocess
  - Starts/stops ngrok and shows the public URL
  - Captures Person A's mic audio and POSTs it to the server
  - Displays the local overlay (mirror of what the browser sees)
"""

import sys
import os
import threading
import time
import tkinter as tk
import subprocess
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audio_capture import AudioCapture
from mt_ct2 import PAIR_STATUS
from overlay_window import CaptionOverlay

SERVER_PORT = 8765
SERVER_URL = f"http://localhost:{SERVER_PORT}"


class TranslatorApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("WhatsApp Call Translator — Host")
        self.root.geometry("500x680")
        self.root.resizable(False, False)

        self.capture = None
        self.overlay = None
        self.server_proc = None
        self.ngrok_proc = None
        self.running = False
        self.pair = "en-zh"
        self._audio_buffer = []
        self._buffer_lock = threading.Lock()

        self._build_ui()

    def _build_ui(self):
        tk.Label(self.root, text="WhatsApp Call Translator",
                 font=("Segoe UI", 16, "bold")).pack(pady=(15, 5))
        tk.Label(self.root, text="Host — share a link, talk through WhatsApp",
                 font=("Segoe UI", 9), fg="gray").pack()

        # ── Link section ──
        link_frame = tk.LabelFrame(self.root, text="Share Link", padx=10, pady=10)
        link_frame.pack(fill="x", padx=20, pady=10)

        self.link_var = tk.StringVar(value="Server not started")
        tk.Label(link_frame, textvariable=self.link_var,
                 font=("Consolas", 10), fg="blue", cursor="hand2",
                 wraplength=440).pack()
        tk.Label(link_frame, text="Send this link to the other person via WhatsApp.",
                 font=("Segoe UI", 8), fg="gray").pack(pady=(5, 0))

        btn_row = tk.Frame(link_frame)
        btn_row.pack(fill="x", pady=(8, 0))
        self.copy_btn = tk.Button(btn_row, text="Copy Link", command=self.copy_link,
                                  width=10, state="disabled")
        self.copy_btn.pack(side="left", padx=(0, 5))
        self.ngrok_btn = tk.Button(btn_row, text="Start ngrok", command=self.start_ngrok,
                                   width=10, state="disabled")
        self.ngrok_btn.pack(side="left")

        # ── Language pair ──
        pair_frame = tk.LabelFrame(self.root, text="Language Pair", padx=10, pady=8)
        pair_frame.pack(fill="x", padx=20, pady=(0, 10))

        self.pair_var = tk.StringVar(value="en-zh")
        for p in list(PAIR_STATUS.keys()):
            status, note = PAIR_STATUS[p]
            rb = tk.Radiobutton(pair_frame, text=f"{p}  ({status})",
                                variable=self.pair_var, value=p,
                                font=("Consolas", 10))
            rb.pack(anchor="w")

        # ── Control buttons ──
        ctrl = tk.Frame(self.root)
        ctrl.pack(fill="x", padx=20, pady=5)
        self.start_btn = tk.Button(ctrl, text="▶  Start", command=self.start,
                                    width=14, height=2, font=("Segoe UI", 11, "bold"),
                                    bg="#4CAF50", fg="white")
        self.start_btn.pack(side="left", expand=True, fill="x", padx=(0, 5))
        self.stop_btn = tk.Button(ctrl, text="■  Stop", command=self.stop,
                                   width=8, height=2, font=("Segoe UI", 11, "bold"),
                                   bg="#f44336", fg="white", state="disabled")
        self.stop_btn.pack(side="right", fill="x", padx=(5, 0))

        # ── Status log ──
        log_frame = tk.LabelFrame(self.root, text="Status Log", padx=10, pady=5)
        log_frame.pack(fill="both", expand=True, padx=20, pady=(5, 10))
        self.log_text = tk.Text(log_frame, height=10, font=("Consolas", 9),
                                state="disabled", wrap="word")
        self.log_text.pack(fill="both", expand=True)

        tk.Label(self.root, text="Free · On-device ASR+MT · No backend",
                 font=("Segoe UI", 8), fg="gray").pack(side="bottom", pady=5)

        self.log("Ready. Select language pair and click Start.")

    def log(self, msg):
        def _log():
            self.log_text.config(state="normal")
            self.log_text.insert("end", f"[{time.strftime('%H:%M:%S')}] {msg}\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")
        if threading.current_thread() is not threading.main_thread():
            self.root.after(0, _log)
        else:
            _log()

    def start(self):
        if self.running:
            return
        self.pair = self.pair_var.get()
        self.log(f"Starting translator (pair={self.pair})...")

        try:
            # 1. Start server subprocess
            here = os.path.dirname(os.path.abspath(__file__))
            server_path = os.path.join(here, "translation_server.py")
            self.server_proc = subprocess.Popen(
                [sys.executable, server_path],
                cwd=here, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            self.log(f"Server PID: {self.server_proc.pid}")

            # Wait for server to be ready
            for _ in range(20):
                time.sleep(0.2)
                try:
                    r = requests.get(f"{SERVER_URL}/health", timeout=1)
                    if r.status_code == 200:
                        self.log("Server running ✓")
                        break
                except Exception:
                    pass
            else:
                raise RuntimeError("Server did not start")

            # 2. Initialize MT on the server
            r = requests.post(f"{SERVER_URL}/api/init_mt",
                              json={"pair": self.pair}, timeout=30)
            if r.status_code == 200:
                self.log(f"MT ready ({self.pair}) ✓")
            else:
                self.log(f"MT init failed: {r.text}")

            # 3. Start overlay
            self.overlay = CaptionOverlay()
            self.overlay.create()
            self.log("Overlay window ready ✓")

            # 4. Start audio capture (Person A's mic → server)
            self.capture = AudioCapture()
            self.capture.start(
                on_remote=self._on_remote_audio,
                on_local=self._on_local_audio,
            )
            self.log("Audio capture started ✓")

            # 5. Show local link, enable ngrok
            self.link_var.set(f"http://localhost:{SERVER_PORT}")
            self.copy_btn.config(state="normal")
            self.ngrok_btn.config(state="normal")
            self.log(f"Local: http://localhost:{SERVER_PORT}")
            self.log("Click 'Start ngrok' for a public link to share via WhatsApp")

        except Exception as e:
            self.log(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            self.stop()
            return

        self.running = True
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")

    def start_ngrok(self):
        """Start ngrok in background and capture the public URL."""
        try:
            self.log("Starting ngrok tunnel...")
            self.ngrok_proc = subprocess.Popen(
                ["ngrok", "http", str(SERVER_PORT)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            # Query ngrok's local API for the public URL
            time.sleep(2)
            try:
                r = requests.get("http://localhost:4040/api/tunnels", timeout=5)
                tunnels = r.json().get("tunnels", [])
                if tunnels:
                    public_url = tunnels[0]["public_url"]
                    self.link_var.set(public_url)
                    self.log(f"Public link: {public_url}")
                    self.log("Share this via WhatsApp!")
                else:
                    self.log("ngrok running but no tunnel URL found")
            except Exception as e:
                self.log(f"ngrok API error: {e}")
                self.log("Check ngrok web UI at http://localhost:4040")
        except FileNotFoundError:
            self.log("ngrok not found. Install from https://ngrok.com/download")
        except Exception as e:
            self.log(f"ngrok error: {e}")

    def copy_link(self):
        link = self.link_var.get()
        self.root.clipboard_clear()
        self.root.clipboard_append(link)
        self.log(f"Link copied: {link}")

    def stop(self):
        if not self.running:
            return
        self.log("Stopping...")
        self.running = False

        if self.capture:
            self.capture.stop()
            self.capture = None
        if self.overlay:
            self.overlay.destroy()
            self.overlay = None
        if self.ngrok_proc:
            self.ngrok_proc.terminate()
            self.ngrok_proc = None
        if self.server_proc:
            self.server_proc.terminate()
            self.server_proc.wait(timeout=5)
            self.server_proc = None
            self.log("Server stopped")

        self.link_var.set("Server not started")
        self.copy_btn.config(state="disabled")
        self.ngrok_btn.config(state="disabled")
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.log("Stopped.")

    def _on_remote_audio(self, pcm, n, sr):
        """Remote (loopback) audio → server."""
        self._send_audio_to_server("host", pcm)

    def _on_local_audio(self, pcm, n, sr):
        """Local (mic) audio → server."""
        self._send_audio_to_server("host", pcm)

    def _send_audio_to_server(self, stream_id, pcm):
        """POST audio chunk to the server. Called from audio thread."""
        if not self.running:
            return
        try:
            # Send raw float32 bytes
            requests.post(
                f"{SERVER_URL}/api/host_audio",
                data=pcm.tobytes(),
                headers={"Content-Type": "application/octet-stream"},
                timeout=2)
        except Exception:
            pass  # Don't crash audio thread on network errors

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        self.stop()
        self.root.destroy()


def main():
    app = TranslatorApp()
    app.run()


if __name__ == "__main__":
    main()