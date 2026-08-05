// windows/overlay/TopmostCaptionWindow.cpp
// Always-on-top, layered, click-through window that renders bilingual
// caption text over WhatsApp Desktop. This is the Windows analog of the
// iOS PiP caption-video overlay — and it's MUCH easier on Windows:
// WS_EX_LAYERED + WS_EX_TRANSPARENT + WS_EX_TOPMOST + a normal HWND + GDI
// text draw. No PiP video hack needed. iTour's desktop app does exactly
// this on Windows.
//
// Build (MSVC, link user32 gdi32): cl /EHsc /std:c++17 TopmostCaptionWindow.cpp /link user32 gdi32

#pragma once
#include <windows.h>
#include <string>

namespace wa {

class TopmostCaptionWindow {
public:
    void create() {
        WNDCLASS wc = {};
        wc.lpfnWndProc = WndProc; wc.hInstance = GetModuleHandle(nullptr);
        wc.lpszClassName = "WACaptionOverlay"; wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        RegisterClass(&wc);
        // WS_EX_LAYERED for alpha; WS_EX_TRANSPARENT so clicks pass through;
        // WS_EX_TOPMOST so it floats over WhatsApp; WS_POPUP no chrome.
        hwnd_ = CreateWindowEx(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            "WACaptionOverlay", "", WS_POPUP,
            100, 100, 800, 120, nullptr, nullptr, wc.hInstance, nullptr);
        SetLayeredWindowAttributes(hwnd_, 0, 200, LWA_ALPHA);  // 78% opacity
        ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    }
    void set_caption(const std::wstring& original, const std::wstring& translated) {
        text_ = original + L"\n" + translated;
        InvalidateRect(hwnd_, nullptr, true);
    }
private:
    HWND hwnd_ = nullptr;
    std::wstring text_;
    static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
        auto self = (TopmostCaptionWindow*)GetWindowLongPtr(h, GWLP_USERDATA);
        if (m == WM_PAINT && self) {
            PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps);
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, RGB(255, 255, 255));
            HFONT f = CreateFontW(22, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, L"Segoe UI");
            SelectObject(dc, f);
            RECT r = { 10, 10, 790, 110 };
            DrawTextW(dc, self->text_.c_str(), -1, &r, DT_LEFT | DT_WORDBREAK);
            DeleteObject(f);
            EndPaint(h, &ps);
            return 0;
        }
        return DefWindowProc(h, m, w, l);
    }
};

} // namespace wa