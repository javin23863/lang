// caption_filter_test.cpp — C++ port of caption_filter_test.py.
// Same 14 real-world cases from Gates 1, 1b, 1c. Verifies the portable
// C++ filter matches the Python reference before shipping it to iOS/Windows.

#include "caption_filter.h"
#include <cstdio>
#include <string>

struct Case {
    const char* name;
    std::string prev, raw;
    bool expect_show;
    const char* expect_reason;
};

int main() {
    Case cases[] = {
        {"whisper_blank",       "",  "[BLANK_AUDIO]",                    false, "blank_token"},
        {"whisper_laughter",    "",  "[ Laughter ]",                     false, "blank_token"},
        {"mt_en_es_manana",     "",  "La conexion fue mala por un momento, por un momento, la conexion fue mala durante un momento, por un momento, la conexion fue mala durante un momento, durante un momento", false, "repetition_loop"},
        {"mt_en_es_compa",      "",  "compa compa compa compa compa compa compa compa",  false, "repetition_loop"},
        {"whisper_tiny_loop",   "",  "my fellow Americans. Ask! my fellow Americans. Ask! my fellow Americans. Ask!", false, "repetition_loop"},
        {"whisper_3gram_loop",  "",  "Ask not what your country can do for you, ask not what your country can do for you, ask not what your country can do for you", false, "repetition_loop"},
        {"good_caption",        "",  "And so my fellow Americans, ask not what your country can do for you.", true, "ok"},
        {"good_short",          "",  "Ask not.",                          true, "ok"},
        {"moonshine_partial",   "Ask not.", "Ask not what your country can do for you.", true, "ok"},
        {"whisper_dedup",       "Ask not what your country can do for you.", "Ask not what your country can do for you", false, "duplicate_of_prev"},
        {"runaway",             "",  std::string(250, 'x') + " word", false, "runaway_length"},
        {"empty",               "",  "",                                 false, "empty"},
        {"whitespace",          "",  "   ",                              false, "empty"},
        {"good_translation_zh", "",  "gu wo de mei guo tong bao tong bao men, qing bu yao wen gui guo neng wei ni zuo xie shen me", true, "ok"},
    };
    int passed = 0;
    for (const auto& c : cases) {
        auto r = wa::filter_caption(c.prev, c.raw);
        bool ok = (r.text.empty() == !c.expect_show) && (r.reason == c.expect_reason);
        if (ok) ++passed;
        std::printf("  %s %-30s -> reason=%-20s (expected %s)\n",
                    ok ? "PASS" : "FAIL", c.name, r.reason.c_str(), c.expect_reason);
    }
    std::printf("\n%d/%zu passed\n", passed, sizeof(cases)/sizeof(cases[0]));
    return passed == (int)(sizeof(cases)/sizeof(cases[0])) ? 0 : 1;
}