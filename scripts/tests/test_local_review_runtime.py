import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("local_review", Path(__file__).resolve().parents[1] / "local-review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class RuntimeSecurityTests(unittest.TestCase):
    def check_version(self, version):
        with patch.object(review.shutil, "which", return_value="/synthetic/node"), patch.object(review.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=version)):
            review.check_node_runtime()

    def test_unpatched_and_unsupported_runtimes_fail_before_startup(self):
        for version in ["v18.18.0", "v22.13.0", "v22.23.2", "v22.23.3", "v24.22.1", "v22.23.4-rc.1", "invalid"]:
            with self.subTest(version=version), self.assertRaises(review.ReviewError):
                self.check_version(version)

    def test_patched_runtime_and_future_22_patches_are_allowed(self):
        for version in ["v22.23.4", "v22.23.5", "v22.24.0"]:
            with self.subTest(version=version):
                self.check_version(version)


if __name__ == "__main__":
    unittest.main()
