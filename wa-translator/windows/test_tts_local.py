"""Integrity and resource-bound checks for first-run local TTS downloads."""

import io
import pathlib
import tarfile
import tempfile
import unittest
from unittest import mock

import tts_local


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, content_length: int | None = None):
        super().__init__(body)
        self.headers = ({"Content-Length": str(content_length)}
                        if content_length is not None else {})

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class LocalTTSDownloadTests(unittest.TestCase):
    def test_two_archives_have_exact_pinned_hashes_and_sizes(self):
        self.assertEqual(tts_local.MODEL_ARCHIVES["en"], {
            "size": 67169893,
            "sha256": "3dfb4b759d8be032a4903a9538d128b0fda2a06ab1de6cbc2d93a97e2dd83dba",
        })
        self.assertEqual(tts_local.MODEL_ARCHIVES["es"], {
            "size": 26520563,
            "sha256": "15585c5add2ab1915ce69e8c966c7c9fb0b6afb21f9b92f18110fda5a4787f99",
        })

    def test_download_rejects_oversize_and_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as folder:
            target = pathlib.Path(folder) / "voice.tar.bz2"
            with mock.patch.object(tts_local.urllib.request, "urlopen",
                                   return_value=FakeResponse(b"x", tts_local.MAX_ARCHIVE_BYTES + 1)):
                with self.assertRaises(ValueError):
                    tts_local._download_verified("https://example.test/model", target,
                                                 expected_size=1, expected_sha256="0" * 64)
            with mock.patch.object(tts_local.urllib.request, "urlopen",
                                   return_value=FakeResponse(b"not pinned", 10)):
                with self.assertRaises(ValueError):
                    tts_local._download_verified("https://example.test/model", target,
                                                 expected_size=10, expected_sha256="0" * 64)

    def test_extract_rejects_traversal_links_and_expansion_bombs(self):
        cases = []
        traversal = tarfile.TarInfo("../escape")
        traversal.size = 1
        cases.append((traversal, b"x"))
        link = tarfile.TarInfo("voice/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "outside"
        cases.append((link, None))
        for member, payload in cases:
            with self.subTest(member=member.name), tempfile.TemporaryDirectory() as folder:
                archive = pathlib.Path(folder) / "bad.tar.bz2"
                with tarfile.open(archive, "w:bz2") as bundle:
                    bundle.addfile(member, io.BytesIO(payload) if payload is not None else None)
                with self.assertRaises(ValueError):
                    tts_local._safe_extract(archive, pathlib.Path(folder) / "out")

        bomb = tarfile.TarInfo("voice/big")
        bomb.size = tts_local.MAX_EXTRACTED_BYTES + 1
        bundle = mock.MagicMock()
        bundle.__enter__.return_value = bundle
        bundle.__iter__.return_value = iter([bomb])
        with mock.patch.object(tts_local.tarfile, "open", return_value=bundle):
            with self.assertRaises(ValueError):
                tts_local._safe_extract(pathlib.Path("unused"), pathlib.Path("out"))
        bundle.extractall.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
