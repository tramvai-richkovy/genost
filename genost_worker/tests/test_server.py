from __future__ import annotations

import unittest
from unittest.mock import patch

from genost_worker.server import parent_process_exists


class ServerTests(unittest.TestCase):
    def test_parent_process_exists_when_signal_check_succeeds(self) -> None:
        with patch("genost_worker.server.os.kill") as kill:
            self.assertTrue(parent_process_exists(123))
        kill.assert_called_once_with(123, 0)

    def test_parent_process_is_missing_after_process_lookup_error(self) -> None:
        with patch("genost_worker.server.os.kill", side_effect=ProcessLookupError):
            self.assertFalse(parent_process_exists(123))

    def test_permission_error_still_means_parent_process_exists(self) -> None:
        with patch("genost_worker.server.os.kill", side_effect=PermissionError):
            self.assertTrue(parent_process_exists(123))


if __name__ == "__main__":
    unittest.main()
