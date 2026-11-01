"""Local role configuration guards; temporary fixtures only, no services or provider calls."""

import contextlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location("careiq_local_review", Path(__file__).resolve().parents[1] / "local-review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class LocalRoleOverrideTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="careiq-role-guards-")
        self.state = Path(self.directory.name)
        self.state_patch = mock.patch.object(review, "STATE", self.state)
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)
        self.addCleanup(self.directory.cleanup)
        self.api = {"CAREIQ_STAFF_ROLES": "org:previous", "CAREIQ_PRACTICE_CREATOR_USER_IDS": ""}

    def override(self, value):
        path = self.state / "roles.env"
        path.write_text(value)
        return path

    @contextlib.contextmanager
    def environment_fixture(self):
        values = {
            self.state / "runtime.env": {"DATABASE_URL": "postgresql://careiq_review_runtime:fixture@127.0.0.1:55434/careiq_review"},
            self.state / "audit.env": {"CAREIQ_AUDIT_DATABASE_URL": "postgresql://careiq_review_audit:fixture@127.0.0.1:55434/careiq_review"},
        }

        def read_fixture(path):
            self.assertIn(path, values, "A test attempted to read outside its temporary environment fixtures.")
            return values[path].copy()

        with mock.patch.object(review, "test_clerk_configuration", return_value=(self.api, "pk_test_fixture", "sk_test_fixture")), \
                mock.patch.object(review, "read_env", side_effect=read_fixture), \
                mock.patch.object(review, "clean_environment", return_value={}), \
                mock.patch.object(review.shutil, "which", return_value=None), \
                mock.patch.object(review.subprocess, "Popen") as popen, \
                mock.patch.object(review, "docker") as docker:
            yield
            popen.assert_not_called()
            docker.assert_not_called()

    def test_missing_file_preserves_api_fallback_without_creating_an_override(self):
        self.assertEqual(review.local_staff_roles(self.api), "org:previous")
        self.assertEqual(review.local_staff_roles({}), "")
        self.assertFalse((self.state / "roles.env").exists())

    def test_valid_unique_roles_are_normalized_without_changing_the_file_or_source(self):
        content = '# Approved local roles only\n\nexport CAREIQ_STAFF_ROLES="org:qa_clinician_20261021, org:reviewer"\n'
        path = self.override(content)
        self.assertEqual(review.local_staff_roles(self.api), "org:qa_clinician_20261021,org:reviewer")
        self.assertEqual(path.read_text(), content)
        self.assertEqual(self.api["CAREIQ_STAFF_ROLES"], "org:previous")
        self.assertFalse((self.state / "owner.env").exists())

    def test_empty_assignment_explicitly_disables_custom_roles(self):
        for value in ["", '""', "''"]:
            with self.subTest(value=value):
                self.override("CAREIQ_STAFF_ROLES=" + value + "\n")
                self.assertEqual(review.local_staff_roles(self.api), "")

    def test_unknown_variables_duplicate_assignments_and_stray_lines_are_rejected(self):
        for content in [
            "DATABASE_URL=fixture\n",
            "CAREIQ_STAFF_ROLES=org:reviewer\nOTHER_ENV=value\n",
            "CAREIQ_STAFF_ROLES=org:reviewer\nCAREIQ_STAFF_ROLES=org:other\n",
            "CAREIQ_STAFF_ROLES=org:reviewer\nnot-an-assignment\n",
            "# Missing required assignment\n",
        ]:
            with self.subTest(content=content):
                self.override(content)
                with self.assertRaises(review.ReviewError):
                    review.local_staff_roles(self.api)

    def test_invalid_role_keys_duplicates_and_empty_list_entries_are_rejected(self):
        for value in ["*", "org:*", "org:Clinician", "org:with-hyphen", "org:", "clinician", "org:a,org:a", "org:a,", ",org:a", "org:a,,org:b", "org:a;org:b", "org:" + "a" * 65]:
            with self.subTest(value=value):
                with self.assertRaises(review.ReviewError):
                    review.parse_staff_role_override("CAREIQ_STAFF_ROLES=" + value)
        self.assertEqual(review.parse_staff_role_override("CAREIQ_STAFF_ROLES=org:" + "a" * 64), "org:" + "a" * 64)

    def test_override_is_applied_only_to_the_api_environment(self):
        self.override("CAREIQ_STAFF_ROLES=org:qa_clinician_20261021\n")
        with self.environment_fixture():
            api = review.app_environment("api")
            web = review.app_environment("web")
            marketing = review.app_environment("marketing")
        self.assertEqual(api["CAREIQ_STAFF_ROLES"], "org:qa_clinician_20261021")
        self.assertNotIn("CAREIQ_STAFF_ROLES", web)
        self.assertNotIn("CAREIQ_STAFF_ROLES", marketing)

    def test_empty_override_reaches_the_api_without_reusing_the_fallback(self):
        self.override("CAREIQ_STAFF_ROLES=\n")
        with self.environment_fixture():
            self.assertEqual(review.app_environment("api")["CAREIQ_STAFF_ROLES"], "")

    def test_start_rejects_malformed_override_before_setup_or_service_launch(self):
        self.override("CAREIQ_STAFF_ROLES=org:*\n")
        with mock.patch.object(review, "check_node_runtime"), \
                mock.patch.object(review, "processes", return_value={}), \
                mock.patch.object(review, "owned", return_value=False), \
                mock.patch.object(review, "occupied", return_value=False), \
                mock.patch.object(review, "app_command"), \
                mock.patch.object(review, "test_clerk_configuration", return_value=(self.api, "pk_test_fixture", "sk_test_fixture")), \
                mock.patch.object(review, "setup") as setup, \
                mock.patch.object(review, "docker") as docker, \
                mock.patch.object(review.subprocess, "Popen") as popen:
            with self.assertRaises(review.ReviewError):
                review.start()
            setup.assert_not_called()
            docker.assert_not_called()
            popen.assert_not_called()

    def test_every_restart_rejects_malformed_override_before_stopping_a_healthy_app(self):
        self.override("CAREIQ_STAFF_ROLES=org:a,org:a\n")
        for name in review.APPS:
            with self.subTest(name=name), mock.patch.object(review, "check_node_runtime"), \
                    mock.patch.object(review, "test_clerk_configuration", return_value=(self.api, "pk_test_fixture", "sk_test_fixture")), \
                    mock.patch.object(review, "processes") as processes, \
                    mock.patch.object(review, "stop_application") as stop, \
                    mock.patch.object(review, "start") as start:
                with self.assertRaises(review.ReviewError):
                    review.restart(name)
                processes.assert_not_called()
                stop.assert_not_called()
                start.assert_not_called()


if __name__ == "__main__":
    unittest.main()
