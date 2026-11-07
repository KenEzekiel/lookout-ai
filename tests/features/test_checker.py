from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/check-features.py"


class FeatureCheckerIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / "docs/features"
        self.folder.mkdir(parents=True)
        (self.root / "source.txt").write_text("real fixture source")
        self.record = """# F-TEST-ENTRY: Entry

Status: implemented

Depends on: none

## Behavior

Visitors can open the application.

## Entry points

Open the home page.

## Wiring and compatibility

Keep the router fallback available.

## Implementation

[Source](../../source.txt).

## Verification

[Evidence](../../source.txt).

## Decisions and sources

Introduced by this test fixture.

## Open questions

None.
"""

    def run_checker(self, record=None, filename="F-TEST-ENTRY.md", *options):
        (self.folder / filename).write_text(self.record if record is None else record)
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), *options],
            capture_output=True, text=True,
        )

    def test_valid_record_and_inventory(self):
        result = self.run_checker(None, "F-TEST-ENTRY.md", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("F-TEST-ENTRY\timplemented\tEntry", result.stdout)

    def test_rejects_invalid_contract_records(self):
        cases = [
            (self.record.replace("F-TEST-ENTRY", "F-TEST-ONE"), "title must start"),
            (self.record.replace("implemented", "done"), "valid Status"),
            (self.record.replace("Depends on: none", "Depends on: F-MISSING"), "invalid dependency"),
            (self.record.replace("Depends on: none", "Depends on: F-TEST-ENTRY"), "invalid dependency"),
            (self.record.replace("Visitors can open the application.", ""), "nonempty Behavior"),
            (self.record.replace("../../source.txt", "../../missing.txt"), "missing or out-of-repository"),
            (self.record.replace("[Source](../../source.txt)", "No implementation"), "linked implementation"),
            (self.record.replace("[Evidence](../../source.txt)", "Not checked"), "linked verification"),
        ]
        for record, message in cases:
            with self.subTest(message=message):
                result = self.run_checker(record)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

    def test_rejects_numeric_code(self):
        result = self.run_checker(self.record.replace("F-TEST-ENTRY", "F-TEST-ONE1"), "F-TEST-ONE1.md")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("without numbers", result.stderr)

    def test_consumer_references_existing_feature_without_editing_provider(self):
        provider = self.folder / "F-TEST-PROVIDER.md"
        provider.write_text(self.record.replace("F-TEST-ENTRY", "F-TEST-PROVIDER"))
        result = self.run_checker(self.record.replace("Depends on: none", "Depends on: F-TEST-PROVIDER"))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_nested_groups_resolve_cross_group_dependencies_and_list_paths(self):
        (self.folder / "providers").mkdir()
        (self.folder / "consumers").mkdir()
        provider = self.folder / "providers/F-TEST-PROVIDER.md"
        provider.write_text(self.record.replace("F-TEST-ENTRY", "F-TEST-PROVIDER").replace("../../source.txt", "../../../source.txt"))
        consumer = self.record.replace("Depends on: none", "Depends on: F-TEST-PROVIDER").replace("../../source.txt", "../../../source.txt")
        result = self.run_checker(consumer, "consumers/F-TEST-ENTRY.md", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("docs/features/providers/F-TEST-PROVIDER.md", result.stdout)
        self.assertIn("docs/features/consumers/F-TEST-ENTRY.md", result.stdout)

    def test_duplicate_codes_across_groups_fail(self):
        (self.folder / "other").mkdir()
        (self.folder / "other/F-TEST-ENTRY.md").write_text(self.record.replace("../../source.txt", "../../../source.txt"))
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate feature code F-TEST-ENTRY", result.stderr)

    def test_empty_inventory_fails(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no feature records", result.stderr)


if __name__ == "__main__":
    unittest.main()
