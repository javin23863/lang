#!/usr/bin/env python3
# caption_filter_test.py
# Tests the CaptionFilter stage against REAL repetition loops captured
# in Gates 1, 1b, 1c. These loops are the actual failure mode of the
# free stack; the filter must catch them all.

import re
from difflib import SequenceMatcher

# ---- the filter (portable C++ equivalent) ----

BLANK_RE = re.compile(r'^\s*\[.*\]\s*$')   # [BLANK_AUDIO], [ Laughter ], [BLANK_AUDIO]

def has_repetition_loop(text, min_repeats=3):
    """Detect any 1/2/3-gram appearing >= min_repeats times. Catches:
       'compa compa compa...' (1-gram), 'Ask! Ask! Ask!' (1-gram),
       'por un momento, por un momento, por un momento' (3-gram, non-adjacent).
       Non-adjacent matters: real MT loops interleave with other words."""
    words = text.split()
    if len(words) < min_repeats:
        return False
    for n in (1, 2, 3):
        if len(words) < n * min_repeats:
            continue
        counts = {}
        for i in range(0, len(words) - n + 1):
            gram = tuple(words[i:i+n])
            counts[gram] = counts.get(gram, 0) + 1
            if counts[gram] >= min_repeats:
                return True
    return False

def is_duplicate(prev, cur, threshold=0.8):
    if not prev: return False
    return SequenceMatcher(None, prev.lower(), cur.lower()).ratio() >= threshold

def filter_caption(prev_caption, raw):
    """Return (show, reason). show=None means suppress."""
    if not raw or not raw.strip():
        return None, "empty"
    if BLANK_RE.match(raw):
        return None, "blank_token"
    if len(raw) > 200:
        return None, "runaway_length"
    if has_repetition_loop(raw):
        return None, "repetition_loop"
    if is_duplicate(prev_caption, raw):
        return None, "duplicate_of_prev"
    return raw, "ok"

# ---- the real failure data from the benchmarks ----

TESTS = [
    # (name, prev, raw, expected_show, expected_reason)
    ("whisper_blank",          "",  "[BLANK_AUDIO]",                     None, "blank_token"),
    ("whisper_laughter",       "",  "[ Laughter ]",                      None, "blank_token"),
    ("mt_en_es_manana",        "",  "La conexión fue mala por un momento, por un momento, la conexión fue mala durante un momento, por un momento, la conexión fue mala durante un momento, durante un momento", None, "repetition_loop"),
    ("mt_en_es_compa",         "",  "compa compa compa compa compa compa compa compa",  None, "repetition_loop"),
    ("whisper_tiny_loop",      "",  "my fellow Americans. Ask! my fellow Americans. Ask! my fellow Americans. Ask!", None, "repetition_loop"),
    ("whisper_3gram_loop",     "",  "Ask not what your country can do for you, ask not what your country can do for you, ask not what your country can do for you", None, "repetition_loop"),
    ("good_caption",          "",  "And so my fellow Americans, ask not what your country can do for you.", "And so my fellow Americans, ask not what your country can do for you.", "ok"),
    ("good_short",            "",  "Ask not.",                          "Ask not.", "ok"),
    ("moonshine_partial",      "Ask not.", "Ask not what your country can do for you.", "Ask not what your country can do for you.", "ok"),
    ("whisper_dedup",          "Ask not what your country can do for you.", "Ask not what your country can do for you", None, "duplicate_of_prev"),
    ("runaway",                "",  "x " * 150,                         None, "runaway_length"),
    ("empty",                  "",  "",                                 None, "empty"),
    ("whitespace",            "",  "   ",                              None, "empty"),
    ("good_translation_zh",    "",  "故我的美国同胞同胞们, 请不要问贵国能为你做些什么",  "故我的美国同胞同胞们, 请不要问贵国能为你做些什么", "ok"),
]

def main():
    passed = 0
    for name, prev, raw, exp_show, exp_reason in TESTS:
        show, reason = filter_caption(prev, raw)
        ok = (show == exp_show) and (reason == exp_reason)
        mark = "PASS" if ok else "FAIL"
        if ok: passed += 1
        show_repr = repr(show[:50]) if show else "None"
        print(f"  {mark} {name:30s} -> show={show_repr:55s} reason={reason}  (expected {exp_reason})")
    print(f"\n{passed}/{len(TESTS)} passed")
    return 0 if passed == len(TESTS) else 1

if __name__ == "__main__":
    raise SystemExit(main())