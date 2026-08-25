"""Pure configuration tests for Modal capacity/deployment settings."""

import os
import unittest
from unittest import mock

import modal_app


class ModalCapacitySettingTests(unittest.TestCase):
    def test_bounded_integer_setting_defaults_parses_and_rejects_unsafe_values(self):
        name = "LINGUA_TEST_BOUNDED_INT"
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(name, None)
            self.assertEqual(modal_app._bounded_int_setting(name, 4, 2, 16), 4)
        with mock.patch.dict(os.environ, {name: " 8 "}, clear=False):
            self.assertEqual(modal_app._bounded_int_setting(name, 4, 2, 16), 8)
        for value in ("one", "1", "17"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {name: value}, clear=False):
                with self.assertRaises(RuntimeError):
                    modal_app._bounded_int_setting(name, 4, 2, 16)

    def test_routing_region_setting_is_normalized_and_fail_closed(self):
        name = "LINGUA_TEST_ROUTING_REGION"
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(name, None)
            self.assertEqual(modal_app._routing_region_setting(name, "ap-south"), "ap-south")
        with mock.patch.dict(os.environ, {name: " US-EAST "}, clear=False):
            self.assertEqual(modal_app._routing_region_setting(name, "ap-south"), "us-east")
        for value in ("", "us east", "https://region.test", "../ap-south"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {name: value}, clear=False):
                if value == "":
                    # Empty means use the explicit default rather than inventing
                    # a second "unset" behavior.
                    self.assertEqual(modal_app._routing_region_setting(name, "ap-south"), "ap-south")
                else:
                    with self.assertRaises(RuntimeError):
                        modal_app._routing_region_setting(name, "ap-south")

    def test_resolved_capacity_keeps_short_job_headroom_and_safe_bounds(self):
        self.assertGreaterEqual(modal_app.MAX_STREAM_INPUTS, 2)
        self.assertLessEqual(modal_app.MAX_STREAM_INPUTS, 16)
        self.assertGreaterEqual(modal_app.MAX_TTS_INPUTS, 1)
        self.assertLessEqual(modal_app.MAX_TTS_INPUTS, 4)
        self.assertEqual(
            modal_app.MODAL_MAX_INPUTS,
            modal_app.MAX_STREAM_INPUTS + modal_app.MAX_TTS_INPUTS,
        )
        self.assertEqual(modal_app.MODAL_TARGET_INPUTS, modal_app.MAX_STREAM_INPUTS)
        self.assertGreaterEqual(modal_app.MODAL_MAX_CONTAINERS, 1)
        self.assertLessEqual(modal_app.MODAL_MIN_CONTAINERS, modal_app.MODAL_MAX_CONTAINERS)
        self.assertGreaterEqual(modal_app.MODAL_SCALEDOWN_WINDOW_S, 30)


if __name__ == "__main__":
    unittest.main(verbosity=2)
