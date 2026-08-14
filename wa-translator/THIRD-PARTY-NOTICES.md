# Third-party notices

Verified for the cloud-room lock and model revisions on 2026-08-14. This file
records the production components most directly redistributed or downloaded;
the full hashed Python dependency set is in `modal-runtime-requirements.txt`.

## Apache License 2.0 components

The complete license text is in `licenses/Apache-2.0.txt`.

- **Kokoro Python runtime 0.9.4**, Hexgrad contributors, Apache-2.0.
  PyPI wheel `kokoro-0.9.4-py3-none-any.whl` SHA-256
  `a129dc6364a286bd6a92c396e9862459d3d3e45f2c15596ed5a94dcee5789efd`.
  Source: <https://github.com/hexgrad/kokoro>.
- **Kokoro-82M model and selected voices**, Hexgrad contributors, Apache-2.0.
  Hugging Face revision `f3ff3571791e39611d31c381e3a41a3af07b4987`;
  `kokoro-v1_0.pth` SHA-256
  `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4`.
  Source: <https://huggingface.co/hexgrad/Kokoro-82M>.
- **Modal Python SDK 1.5.4**, Modal Labs, Inc., Apache-2.0. Wheel SHA-256
  `3e54e26037c445af42f9a9ef9862b66bdd2e0b1faeced5fcc7adf3e5f59e44ed`.
  Source: <https://github.com/modal-labs/modal-client>.
- **Meta M2M100 418M multilingual translation model**, MIT. The production
  adapter pins Hugging Face revision
  `55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`, validates the source snapshot,
  then converts only that local snapshot with CTranslate2. Source:
  <https://huggingface.co/facebook/m2m100_418M>.

## Other production licenses

- **faster-whisper** and **CTranslate2** are MIT licensed. The deployed
  `mobiuslabsgmbh/faster-whisper-large-v3-turbo` model is pinned to revision
  `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` and declares MIT.
- **NVIDIA CUDA 12 runtime libraries**, pinned as
  `nvidia-cublas-cu12==12.9.2.10` and `nvidia-cudnn-cu12==9.20.0.48`, are
  redistributed in the Modal image under the NVIDIA SDK license. Source and
  license: <https://developer.nvidia.com/cuda-toolkit> and
  <https://docs.nvidia.com/cuda/eula/index.html>.

Voice labels in the product are controlled synthesis styles. They are not a
claim about a participant and are never selected through biometric inference.
Locale profiles use a base-language model mapping and do not imply
locale-specific MT, ASR, or voice quality.
