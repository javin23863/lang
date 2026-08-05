// two_stream_latency.cpp
// Simulates the v2 pipeline: two whisper contexts (local mic, remote app-audio),
// sliding-window, measures end-to-end caption latency per stream.
//
// Build: g++ -O2 -std=c++17 -I whisper.cpp/include -I whisper.cpp/ggml/include
//        two_stream_latency.cpp whisper.cpp/build/src/libwhisper.a
//        whisper.cpp/build/ggml/src/libggml.a -lpthread -lm
//
// Run:   ./two_stream_latency <local.wav> <remote.wav> [model.bin]

#include "whisper.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <string>
#include <chrono>
#include <thread>
#include <mutex>
#include <cmath>
#include <sndfile.h>

using clk = std::chrono::steady_clock;
static double ms_since(clk::time_point t) {
    return std::chrono::duration<double, std::milli>(clk::now() - t).count();
}

struct StreamCtx {
    std::string name;
    std::vector<float> pcm;       // full audio, 16k mono f32
    size_t pos = 0;               // current read position (samples)
    int sr = 16000;
    // whisper state
    struct whisper_context* ctx = nullptr;
    // results
    int captions = 0;
    double total_latency_ms = 0;
    double max_latency_ms = 0;
};

// read wav via libsndfile -> f32 mono 16k
static std::vector<float> load_wav_f32(const char* path, int& sr_out) {
    SF_INFO info{}; info.format = 0;
    SNDFILE* f = sf_open(path, SFM_READ, &info);
    if (!f) { fprintf(stderr, "open %s failed: %s\n", path, sf_strerror(nullptr)); exit(1); }
    std::vector<float> in(info.frames * info.channels);
    sf_readf_float(f, in.data(), info.frames);
    sf_close(f);
    // to mono
    std::vector<float> mono(info.frames, 0.0f);
    for (sf_count_t i = 0; i < info.frames; ++i) {
        float s = 0;
        for (int c = 0; c < info.channels; ++c) s += in[i*info.channels + c];
        mono[i] = s / info.channels;
    }
    sr_out = info.samplerate;
    // resample to 16k if needed (linear, crude)
    if (sr_out != 16000) {
        double ratio = 16000.0 / sr_out;
        size_t newn = (size_t)(mono.size() * ratio);
        std::vector<float> out(newn);
        for (size_t i = 0; i < newn; ++i) {
            double src = i / ratio;
            size_t i0 = (size_t)src; size_t i1 = std::min(i0+1, mono.size()-1);
            double frac = src - i0;
            out[i] = (float)(mono[i0]*(1-frac) + mono[i1]*frac);
        }
        sr_out = 16000;
        return out;
    }
    return mono;
}

// process one window; returns caption text (empty if silence)
static std::string process_window(StreamCtx& s, const float* buf, int n, double& latency_ms) {
    auto t0 = clk::now();
    whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wp.print_progress = false;
    wp.print_special = false;
    wp.print_realtime = false;
    wp.print_timestamps = false;
    wp.translate = false;
    wp.language = "en";
    wp.n_threads = 8;
    wp.no_context = true;
    wp.single_segment = false;
    if (whisper_full(s.ctx, wp, buf, n) != 0) { latency_ms = ms_since(t0); return ""; }
    latency_ms = ms_since(t0);
    std::string text;
    int nseg = whisper_full_n_segments(s.ctx);
    for (int i = 0; i < nseg; ++i) {
        const char* t = whisper_full_get_segment_text(s.ctx, i);
        if (t) text += t;
    }
    return text;
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s local.wav remote.wav [model.bin]\n", argv[0]); return 1; }
    const char* model = argc > 3 ? argv[3] : "whisper.cpp/models/ggml-base.en.bin";

    StreamCtx A, B;
    A.name = "LOCAL";  A.pcm = load_wav_f32(argv[1], A.sr);
    B.name = "REMOTE"; B.pcm = load_wav_f32(argv[2], B.sr);
    printf("loaded %s: %zu samples (%.1fs @ %dHz)\n", A.name.c_str(), A.pcm.size(), A.pcm.size()/16000.0, A.sr);
    printf("loaded %s: %zu samples (%.1fs @ %dHz)\n", B.name.c_str(), B.pcm.size(), B.pcm.size()/16000.0, B.sr);

    A.ctx = whisper_init_from_file_with_params(model, whisper_context_default_params());
    B.ctx = whisper_init_from_file_with_params(model, whisper_context_default_params());
    if (!A.ctx || !B.ctx) { fprintf(stderr, "model load failed: %s\n", model); return 1; }

    // sliding window: 3s window, 1.5s step
    const int WIN = 3 * 16000;
    const int STEP = 1500;  // ms
    const int STEP_S = STEP * 16; // samples per step

    auto t_start = clk::now();
    int step_no = 0;
    while (A.pos < A.pcm.size() || B.pos < B.pcm.size()) {
        double wall = ms_since(t_start);
        // each stream processes its current window
        auto run = [&](StreamCtx& s) {
            if (s.pos >= s.pcm.size()) return;
            int n = std::min(WIN, (int)(s.pcm.size() - s.pos));
            std::vector<float> win(WIN, 0.0f);
            memcpy(win.data(), s.pcm.data() + s.pos, n * sizeof(float));
            // RMS for silence detect
            double rms = 0; for (int i = 0; i < n; ++i) rms += win[i]*win[i];
            rms = sqrt(rms / n);
            double lat = 0;
            std::string cap;
            if (rms > 0.001) cap = process_window(s, win.data(), WIN, lat);
            else lat = 0.1;
            if (!cap.empty()) {
                s.captions++;
                s.total_latency_ms += lat;
                if (lat > s.max_latency_ms) s.max_latency_ms = lat;
                printf("[%6.0fms wall][%s] lat=%5.0fms rms=%.4f  >> %s\n",
                       wall, s.name.c_str(), lat, rms, cap.c_str());
            }
            s.pos += STEP_S;
        };
        run(A);
        run(B);
        step_no++;
        // simulate realtime: each step is STEP ms of wall time
        std::this_thread::sleep_for(std::chrono::milliseconds(STEP));
    }

    double total_wall = ms_since(t_start);
    printf("\n=== SUMMARY ===\n");
    printf("total wall: %.0f ms (%.1fs simulated audio)\n", total_wall, std::max(A.pcm.size(), B.pcm.size())/16000.0);
    printf("LOCAL : %d captions, avg lat %.0f ms, max %.0f ms\n", A.captions, A.captions?A.total_latency_ms/A.captions:0, A.max_latency_ms);
    printf("REMOTE: %d captions, avg lat %.0f ms, max %.0f ms\n", B.captions, B.captions?B.total_latency_ms/B.captions:0, B.max_latency_ms);
    printf("verdict: ");
    if (A.max_latency_ms < 1500 && B.max_latency_ms < 1500) printf("REALTIME OK (latency < 1.5s per window)\n");
    else printf("NOT REALTIME (max lat > 1.5s) — need smaller model or Metal/CoreML\n");
    whisper_free(A.ctx); whisper_free(B.ctx);
    return 0;
}