#!/usr/bin/env python3
"""cuda_dlls.py — make the pip-installed CUDA runtime visible to CTranslate2.

The ctranslate2 wheel bundles cudnn64_9.dll but not cublas64_12.dll, so a GPU
load dies with "Library cublas64_12.dll is not found or cannot be loaded" unless
the nvidia-cublas-cu12 package's bin directory is on the DLL search path.

Both asr_whisper and mt_ct2 call ensure() before importing ctranslate2, so
neither depends on the other being imported first.
"""

import os
import sys
from pathlib import Path

_done = False


def ensure():
    """Add every nvidia/*/bin directory in site-packages to the DLL search path.

    Both mechanisms are needed: add_dll_directory only helps callers that pass
    LOAD_LIBRARY_SEARCH_* flags, and CTranslate2 loads cublas with a bare
    LoadLibrary — which searches PATH instead.
    """
    global _done
    if _done or sys.platform != "win32":
        _done = True
        return
    _done = True
    found = []
    for site in sys.path:
        nvidia = Path(site) / "nvidia"
        if not nvidia.is_dir():
            continue
        for bindir in sorted(nvidia.glob("*/bin")):
            os.add_dll_directory(str(bindir))
            found.append(str(bindir))
    if found:
        os.environ["PATH"] = os.pathsep.join(found) + os.pathsep + os.environ.get("PATH", "")
    return found


if __name__ == "__main__":
    print("dll dirs:", ensure())
    import ctranslate2
    print("cuda devices:", ctranslate2.get_cuda_device_count())
