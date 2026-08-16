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

## MIT License components

- **QR Code generator library (Project Nayuki)**, MIT. Vendored verbatim in
  behaviour as `windows/static/qr.js` and served to the browser; it renders the
  room-invite QR code offline, so no link is ever sent to a code-generating
  service. Source: <https://www.nayuki.io/page/qr-code-generator-library>.

  > Copyright (c) Project Nayuki. (MIT License)
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to
  > deal in the Software without restriction, including without limitation the
  > rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
  > sell copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > - The above copyright notice and this permission notice shall be included in
  >   all copies or substantial portions of the Software.
  > - The Software is provided "as is", without warranty of any kind, express or
  >   implied, including but not limited to the warranties of merchantability,
  >   fitness for a particular purpose and noninfringement. In no event shall the
  >   authors or copyright holders be liable for any claim, damages or other
  >   liability, whether in an action of contract, tort or otherwise, arising
  >   from, out of or in connection with the Software or the use or other
  >   dealings in the Software.

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
