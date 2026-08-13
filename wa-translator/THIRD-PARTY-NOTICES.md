# Third-party notices

Verified for the cloud-room lock and model revisions on 2026-08-13. This file
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
- **Helsinki-NLP OPUS-MT Spanish-to-English model**, Apache-2.0, revision
  `c96e2c5399ebfae4fc43d9669556b9afa74bb69d`.
  Source: <https://huggingface.co/Helsinki-NLP/opus-mt-es-en>.

## Other production licenses

- **Helsinki-NLP OPUS-MT Tatoeba English-to-Spanish model**, CC BY 4.0,
  revision `8f4d4924189681076e9c642b2fd85278d793fd4d`. Attribution: Helsinki-NLP and
  OPUS contributors. Source:
  <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-es>. License:
  <https://creativecommons.org/licenses/by/4.0/>.
- **faster-whisper** and **CTranslate2** are MIT licensed. The deployed
  `mobiuslabsgmbh/faster-whisper-large-v3-turbo` model is pinned to revision
  `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` and declares MIT.

Voice labels in the product are controlled synthesis styles. They are not a
claim about a participant and are never selected through biometric inference.
