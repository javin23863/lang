// windows/capture/WASAPILoopback.cpp
// Capture default audio output (WhatsApp call speaker) via WASAPI loopback.
// This is the Windows analog of ReplayKit .audioApp. Unlike iOS, this
// actually works reliably on Windows — WASAPI loopback is a documented,
// stable API for capturing system audio. Makes Windows the lower-risk
// v1 platform for capture.
//
// Build (MSVC, link ole32 mmdevapi): cl /EHsc /std:c++17 WASAPILoopback.cpp /link ole32 mmdevapi
// Output: 16kHz mono f32 PCM chunks fed to a sink callback.
//
// Reference: Microsoft "Capture a Loopback Audio Stream" sample
// (https://learn.microsoft.com/en-us/windows/win32/coreaudio/capturing-a-stream)

#pragma once
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <atomic>
#include <thread>
#include <functional>
#include <vector>

namespace wa {

class WASAPILoopback {
public:
    using Sink = std::function<void(const float* pcm, size_t n, int sampleRate)>;
    // 16kHz mono float32 chunks to sink.
    void start(Sink sink) {
        running_ = true;
        thread_ = std::thread([this, sink]{ loop(sink); });
    }
    void stop() { running_ = false; if (thread_.joinable()) thread_.join(); }
private:
    std::atomic<bool> running_{false};
    std::thread thread_;
    void loop(Sink sink) {
        // 1. CoInitialize, get IMMDeviceEnumerator, default render endpoint
        // 2. Activate IAudioClient, set AUDCLNT_STREAMFLAGS_LOOPBACK
        // 3. Get mix format (likely 48k stereo f32); init resampler to 16k mono
        // 4. Loop: GetBuffer -> convert to 16k mono f32 -> sink -> ReleaseBuffer
        // Pseudocode — full impl is ~200 lines; see MS sample link above.
        // Key point: AUDCLNT_STREAMFLAGS_LOOPBACK gives us the speaker output
        // without any driver hacks. This is why Windows capture is solved.
        (void)sink;
    }
};

} // namespace wa