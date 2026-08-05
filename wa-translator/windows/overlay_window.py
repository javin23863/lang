#!/usr/bin/env python3
"""overlay_window.py — Always-on-top caption overlay window (Windows).

The Windows analog of the iOS PiP caption-video overlay — and much easier:
WS_EX_LAYERED + WS_EX_TRANSPARENT + WS_EX_TOPMOST + GDI text. No PiP hack.
One transparent window floats over WhatsApp Desktop showing bilingual
captions.

Uses pywin32 (win32gui, win32con, win32api). Click-through so it doesn't
interfere with WhatsApp interaction.

Usage:
    overlay = CaptionOverlay()
    overlay.create()
    overlay.set_caption("Hello", "你好")
    # ... later ...
    overlay.set_caption("Goodbye", "再见")
    overlay.destroy()

The overlay runs its own message loop in a background thread. set_caption
is thread-safe (posts a message to the overlay thread).
"""

import threading
import ctypes
from ctypes import wintypes
import win32gui
import win32con
import win32api

# GDI functions via ctypes (win32gui doesn't expose CreateFont)
gdi32 = ctypes.windll.gdi32
user32 = ctypes.windll.user32

# Custom message for updating caption text
WM_SET_CAPTION = win32con.WM_USER + 1

# Window class name
CLASS_NAME = "WACaptionOverlay"

# Font creation via ctypes
gdi32.CreateFontW.restype = wintypes.HFONT
gdi32.CreateFontW.argtypes = [
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
    wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
    wintypes.DWORD, wintypes.LPCWSTR]
gdi32.DeleteObject.argtypes = [wintypes.HANDLE]

# BeginPaint / EndPaint
user32.BeginPaint.restype = wintypes.HDC
user32.BeginPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]
user32.EndPaint.restype = wintypes.BOOL
user32.EndPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]


class CaptionOverlay:
    """Always-on-top, click-through, transparent caption overlay."""

    def __init__(self, width=800, height=140, x=None, y=None):
        self.width = width
        self.height = height
        self._x = x
        self._y = y
        self._hwnd = None
        self._thread = None
        self._original_text = ""
        self._translated_text = ""
        self._translating = False
        self._created = threading.Event()
        self._stopped = threading.Event()

    def _wnd_proc(self, hwnd, msg, wparam, lparam):
        if msg == win32con.WM_PAINT:
            self._paint(hwnd)
            return 0
        elif msg == WM_SET_CAPTION:
            # Caption updated from another thread
            self._translating = bool(wparam)
            win32gui.InvalidateRect(hwnd, None, True)
            return 0
        elif msg == win32con.WM_DESTROY:
            win32gui.PostQuitMessage(0)
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)

    def _paint(self, hwnd):
        # Use ctypes for BeginPaint/EndPaint to get a proper PAINTSTRUCT
        class PAINTSTRUCT(ctypes.Structure):
            _fields_ = [
                ("hdc", wintypes.HDC),
                ("fErase", wintypes.BOOL),
                ("rcPaint_left", wintypes.LONG),
                ("rcPaint_top", wintypes.LONG),
                ("rcPaint_right", wintypes.LONG),
                ("rcPaint_bottom", wintypes.LONG),
                ("fRestore", wintypes.BOOL),
                ("fIncUpdate", wintypes.BOOL),
                ("rgbReserved", ctypes.c_byte * 32),
            ]

        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(ctypes.c_void_p(hwnd), ctypes.byref(ps))

        try:
            # Draw semi-transparent black background
            brush = win32gui.CreateSolidBrush(win32api.RGB(0, 0, 0))
            rect = win32gui.GetClientRect(hwnd)
            win32gui.FillRect(hdc, rect, brush)
            win32gui.DeleteObject(brush)

            # Transparent text background
            win32gui.SetBkMode(hdc, win32con.TRANSPARENT)

            # Create fonts via ctypes GDI
            font_orig = gdi32.CreateFontW(
                22, 0, 0, 0, win32con.FW_NORMAL,
                0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI")
            font_trans = gdi32.CreateFontW(
                20, 0, 0, 0, win32con.FW_NORMAL,
                0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI")

            # Draw original text (top half) — white
            old_font = win32gui.SelectObject(hdc, font_orig)
            win32gui.SetTextColor(hdc, win32api.RGB(255, 255, 255))
            r1 = (15, 10, rect[2] - 15, rect[3] // 2)
            text_to_draw = self._original_text if self._original_text else ""
            if self._translating and not self._translated_text and text_to_draw:
                text_to_draw = text_to_draw + " ..."
            if text_to_draw:
                win32gui.DrawText(
                    hdc, text_to_draw, -1, r1,
                    win32con.DT_LEFT | win32con.DT_WORDBREAK | win32con.DT_END_ELLIPSIS)

            # Draw translated text (bottom half) — light blue
            win32gui.SelectObject(hdc, font_trans)
            trans_text = self._translated_text if self._translated_text else (
                "translating..." if self._translating else "")
            if trans_text:
                win32gui.SetTextColor(hdc, win32api.RGB(180, 220, 255))
                r2 = (15, rect[3] // 2 + 5, rect[2] - 15, rect[3] - 10)
                win32gui.DrawText(
                    hdc, trans_text, -1, r2,
                    win32con.DT_LEFT | win32con.DT_WORDBREAK | win32con.DT_END_ELLIPSIS)

            # Cleanup fonts
            win32gui.SelectObject(hdc, old_font)
            gdi32.DeleteObject(ctypes.c_void_p(font_orig))
            gdi32.DeleteObject(ctypes.c_void_p(font_trans))
        finally:
            user32.EndPaint(ctypes.c_void_p(hwnd), ctypes.byref(ps))

    def _create_window(self):
        """Create the overlay window. Runs in the overlay thread."""
        # Register window class
        wc = win32gui.WNDCLASS()
        wc.lpfnWndProc = self._wnd_proc
        wc.hInstance = win32api.GetModuleHandle(None)
        wc.lpszClassName = CLASS_NAME
        wc.hCursor = win32gui.LoadCursor(None, win32con.IDC_ARROW)
        wc.hbrBackground = win32gui.GetStockObject(win32con.BLACK_BRUSH)
        atom = win32gui.RegisterClass(wc)

        # Position: bottom-center of screen by default
        screen_w = win32api.GetSystemMetrics(win32con.SM_CXSCREEN)
        screen_h = win32api.GetSystemMetrics(win32con.SM_CYSCREEN)
        x = self._x if self._x is not None else (screen_w - self.width) // 2
        y = self._y if self._y is not None else screen_h - self.height - 80

        # WS_EX_LAYERED: per-window alpha
        # WS_EX_TRANSPARENT: click-through
        # WS_EX_TOPMOST: float over everything
        # WS_EX_TOOLWINDOW: no taskbar entry
        style_ex = (win32con.WS_EX_LAYERED | win32con.WS_EX_TRANSPARENT |
                    win32con.WS_EX_TOPMOST | win32con.WS_EX_TOOLWINDOW)
        self._hwnd = win32gui.CreateWindowEx(
            style_ex, CLASS_NAME, "", win32con.WS_POPUP,
            x, y, self.width, self.height,
            0, 0, wc.hInstance, None)

        # Set 78% opacity (alpha=200)
        win32gui.SetLayeredWindowAttributes(
            self._hwnd, 0, 200, win32con.LWA_ALPHA)
        win32gui.ShowWindow(self._hwnd, win32con.SW_SHOWNOACTIVATE)
        self._created.set()

        # Message loop
        while not self._stopped.is_set():
            result = win32gui.GetMessage(None, 0, 0)
            if result == 0:  # WM_QUIT
                break
            win32gui.TranslateMessage(result[1])
            win32gui.DispatchMessage(result[1])

    def create(self):
        """Start the overlay (background thread + message loop)."""
        self._thread = threading.Thread(target=self._create_window, daemon=True)
        self._thread.start()
        self._created.wait(timeout=5)
        print("[overlay] caption window created (topmost, click-through)")

    def set_caption(self, original, translated="", translating=False):
        """Update the displayed caption. Thread-safe."""
        self._original_text = original
        self._translated_text = translated
        self._translating = translating
        if self._hwnd:
            win32gui.PostMessage(self._hwnd, WM_SET_CAPTION,
                                 int(translating), 0)

    def destroy(self):
        """Close the overlay."""
        self._stopped.set()
        if self._hwnd:
            win32gui.PostMessage(self._hwnd, win32con.WM_CLOSE, 0, 0)
        if self._thread:
            self._thread.join(timeout=2)
        print("[overlay] destroyed")


if __name__ == "__main__":
    # Demo: show a caption for 5 seconds
    import time
    ov = CaptionOverlay()
    ov.create()
    ov.set_caption("Hello, this is a test of the caption overlay.",
                   "你好，这是字幕叠加的测试。")
    print("Overlay showing for 5 seconds...")
    time.sleep(5)
    ov.set_caption("Second line of text.", "第二行文字。", translating=False)
    time.sleep(3)
    ov.destroy()
    print("Done.")