import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from server import NotdHandler


class GraphAssetPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.graph = Path(self.temporary.name).resolve()
        (self.graph / "assets" / "images").mkdir(parents=True)
        self.handler = object.__new__(NotdHandler)
        self.handler.server = SimpleNamespace(graph=self.graph)

    def tearDown(self):
        self.temporary.cleanup()

    def test_accepts_files_inside_assets(self):
        expected = self.graph / "assets" / "images" / "cover.png"
        self.assertEqual(
            self.handler.graph_asset_path("assets/images/cover.png"),
            expected,
        )

    def test_rejects_graph_files_outside_assets(self):
        for path in (
            ".git/config",
            "pages/private.md",
            "assets/../.git/config",
            "assets/%252e%252e/.git/config",
            "/assets/cover.png",
        ):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    self.handler.graph_asset_path(path)

    def test_rejects_asset_symlinks_to_other_graph_files(self):
        private = self.graph / ".git" / "config"
        private.parent.mkdir()
        private.write_text("private")
        link = self.graph / "assets" / "config"
        try:
            link.symlink_to(private)
        except OSError:
            self.skipTest("Symbolic links are not available")
        with self.assertRaises(ValueError):
            self.handler.graph_asset_path("assets/config")


if __name__ == "__main__":
    unittest.main()
