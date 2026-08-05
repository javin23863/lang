#!/usr/bin/env python3
"""
translator_app.py — WhatsApp Call Translator (Windows Host)

iTour-style architecture:
  1. Person A runs this app on Windows.
  2. App starts a local WebSocket server (translation_server.py).
  3. App (optionally) starts ngrok to expose the server to the internet.
  4. Person A shares the public URL via WhatsApp to Person B.
  5. Person B opens the URL on their phone -> web page with mic + captions.
  6. Both people talk; ASR + MT run on Person A's Windows machine (free, on-device).

This is the host-side controller GUI. It:
  - Starts/stops the translation server
  - Shows the share link (local + ngrok URL)
  - Selects the language pair
  - Captures Person A's audio (WASAPI loopback + mic)
  - Displays bilingual captions locally
  - Runs Moonshine ASR + CTranslate2 MT on all audio
"""

import sys
import os
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audio_capture import AudioCapture
from mt_ct2 import CTranslate2MT, filter_caption, PAIR_STATUS
from overlay_window import CaptionOverlay

# Check ASR availability
try:
    from moonshine_asr import MoonshineASR, MOONSHINE_AVAILABLE
except ImportError:
    MOONSHINE_AVAILABLE = False
    MoonshineASR = None


class TranslatorApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("WhatsApp Call Translator — Host")
        self.root.geometry("500x680")
        self.root.resizable(False, False)

        self.capture = None
        self.asr = None
        self.mt = None
        self.overlay = None
        self.server_proc = None
        self.ngrok_proc = None
        self.running = False
        self.pair = "en-zh"
        self._lock = threading.Lock()

        self._build_ui()

    def _build_ui(self):
        tk.Label(self.root, text="WhatsApp Call Translator",
                 font=("Segoe UI", 16, "bold")).pack(pady=(15, 5))
        tk.Label(self.root, text="Host — share a link, talk through WhatsApp",
                 font=("Segoe UI", 9), fg="gray").pack()

        # --- Link section ---
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

        # --- Language pair ---
        pair_frame = tk.LabelFrame(self.root, text="Language Pair", padx=10, pady=8)
        pair_frame.pack(fill="x", padx=20, pady=(0, 10))

        self.pair_var = tk.StringVar(value="en-zh")
        for p in list(PAIR_STATUS.keys()):
            status, note = PAIR_STATUS[p]
            rb = tk.Radiobutton(pair_frame, text=f"{p}  ({status})",
                                variable=self.pair_var, value=p,
                                font=("Consolas", 10))
            rb.pack(anchor="w")

        # --- Control buttons ---
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

        # --- Status log ---
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
            # 1. Start MT
            self.mt = CTranslate2MT(pair=self.pair)
            self.mt.start()
            self.log(f"MT ready ({self.pair})")

            # 2. Start ASR (if available)
            if MOONSHINE_AVAILABLE and MoonshineASR:
                self.asr = MoonshineASR()
                self.asr.start(
                    on_remote_line=lambda text, t, lat: self._on_asr_line("remote", text, t, lat),
                    on_local_line=lambda text, t, lat: self._on_asr_line("local", text, t, lat),
                )
                self.log("ASR ready (Moonshine)")
            else:
                self.log("ASR: moonshine-voice not available (install to enable)")

            # 3. Start overlay
            self.overlay = CaptionOverlay()
            self.overlay.create()
            self.log("Overlay window ready")

            # 4. Start audio capture (Person A's local audio)
            self.capture = AudioCapture()
            self.capture.start(
                on_remote=self._on_remote_audio,
                on_local=self._on_local_audio,
            )
            self.log("Audio capture started (loopback + mic)")

            # 5. Start translation server
            self._start_server()
            self.link_var.set(f"http://localhost:8765")
            self.copy_btn.config(state="normal")
            self.ngrok_btn.config(state="normal")
            self.log("Server running on http://localhost:8765")
            self.log("Click 'Start ngrok' to get a public link for WhatsApp sharing")

        except Exception as e:
            self.log(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            self.stop()
            return

        self.running = True
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")

    def _start_server(self):
        """Start translation_server.py as a subprocess."""
        here = os.path.dirname(os.path.abspath(__file__))
        server_path = os.path.join(here, "translation_server.py")
        self.server_proc = subprocess.Popen(
            [sys.executable, server_path],
            cwd=here, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.log(f"Server PID: {self.server_proc.pid}")

    def start_ngrok(self):
        """Start ngrok to expose the local server publicly."""
        try:
            result = subprocess.run(
                ["ngrok", "http", "8765"], capture_output=False,
                start_new_session=True)
        except FileNotFoundError:
            self.log("ngrok not found. Install: https://ngrok.com/download")
            self.log("Then place ngrok.exe in your PATH")
            return

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
        if self.asr:
            self.asr.stop()
            self.asr = None
        if self.mt:
            self.mt.stop()
            self.mt = None
        if self.overlay:
            self.overlay.destroy()
            self.overlay = None
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
        if self.asr:
            self.asr.feed_remote(pcm, sr)

    def _on_local_audio(self, pcm, n, sr):
        if self.asr:
            self.asr.feed_local(pcm, sr)

    def _on_asr_line(self, stream, text, start_time, latency):
        self.log(f"[{stream}] ASR ({latency:.0f}ms): {text[:60]}")
        if self.mt and self.running:
            if stream == "remote":
                self.root.after(0, lambda: self.overlay.set_caption(text, "", translating=True))

            def do_mt():
                translated, reason = self.mt.translate(text)
                if translated:
                    self.log(f"[{stream}] MT: {translated[:60]}")
                    self.root.after(0, lambda: self.overlay.set_caption(
                        text, translated, translating=False))
                else:
                    self.root.after(0, lambda: self.overlay.set_caption(
                        text, "", translating=False))

            threading.Thread(target=do_mt, daemon=True).start()

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