// caption_filter.h — portable C++ caption filter (iOS + Windows shared).
// Tested against real repetition loops captured in Gates 1, 1b, 1c.
// Single header, no deps. Same logic as caption_filter_test.py.
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <cctype>

namespace wa {

inline std::string strip(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char)s[a])) ++a;
    while (b > a && std::isspace((unsigned char)s[b-1])) --b;
    return s.substr(a, b - a);
}

inline std::vector<std::string> split(const std::string& s) {
    std::vector<std::string> out; std::string cur;
    for (char c : s) {
        if (std::isspace((unsigned char)c)) { if (!cur.empty()) { out.push_back(cur); cur.clear(); } }
        else cur.push_back(c);
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

inline bool is_blank_token(const std::string& s) {
    // [BLANK_AUDIO], [ Laughter ], [ Laughter ], etc.
    auto t = strip(s);
    if (t.size() < 2 || t.front() != '[' || t.back() != ']') return false;
    return true;
}

inline bool has_repetition_loop(const std::string& s, int min_repeats = 3) {
    auto words = split(s);
    if ((int)words.size() < min_repeats) return false;
    for (int n = 1; n <= 3; ++n) {
        if ((int)words.size() < n * min_repeats) continue;
        std::unordered_map<std::string,int> counts;
        for (size_t i = 0; i + n <= words.size(); ++i) {
            std::string g;
            for (int k = 0; k < n; ++k) { if (k) g += ' '; g += words[i+k]; }
            if (++counts[g] >= min_repeats) return true;
        }
    }
    return false;
}

inline double similarity(const std::string& a, const std::string& b) {
    // crude ratio: 1 - edit_distance/max_len (good enough for dedup)
    if (a.empty() && b.empty()) return 1.0;
    size_t m = a.size(), n = b.size();
    std::vector<size_t> prev(n+1), cur(n+1);
    for (size_t j = 0; j <= n; ++j) prev[j] = j;
    for (size_t i = 1; i <= m; ++i) {
        cur[0] = i;
        for (size_t j = 1; j <= n; ++j) {
            size_t cost = (a[i-1] == b[j-1]) ? 0 : 1;
            cur[j] = std::min({prev[j]+1, cur[j-1]+1, prev[j-1]+cost});
        }
        prev = cur;
    }
    return 1.0 - (double)prev[n] / std::max(m, n);
}

struct FilterResult {
    std::string text;   // empty if suppressed
    std::string reason;  // ok | empty | blank_token | runaway_length | repetition_loop | duplicate_of_prev
};

inline FilterResult filter_caption(const std::string& prev, const std::string& raw) {
    auto t = strip(raw);
    if (t.empty())            return {"", "empty"};
    if (is_blank_token(t))    return {"", "blank_token"};
    if (t.size() > 200)       return {"", "runaway_length"};
    if (has_repetition_loop(t)) return {"", "repetition_loop"};
    if (!prev.empty() && similarity(prev, t) >= 0.8) return {"", "duplicate_of_prev"};
    return {t, "ok"};
}

} // namespace wa