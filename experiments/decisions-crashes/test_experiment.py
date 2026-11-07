import contextlib
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import experiment


class ExperimentIntegrationTests(unittest.TestCase):
    def test_resume_sends_only_remaining_windows_and_rejects_changed_input(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            folder = pathlib.Path(folder)
            (folder / "key").write_text("test-only")
            (folder / "frame.jpg").write_bytes(b"synthetic-jpeg")
            jobs = [{"clip": "control", "expected": "no_crash", "source_onset_seconds": None,
                     "window_start": start, "window_end": start + 3.5,
                     "frames": ["frame.jpg"] * 8} for start in (0, 1, 2)]
            (folder / "jobs.json").write_text(json.dumps(jobs))
            row = {k: v for k, v in jobs[0].items() if k != "frames"}
            row.update(expected_requests=3, response={"answers": []}, request_sha256=hashlib.sha256(
                json.dumps(experiment.request_body(jobs[0], folder)).encode()).hexdigest())
            output = folder / "results.jsonl"
            prefix = json.dumps(row) + "\n"
            output.write_text(prefix)
            with patch("urllib.request.urlopen") as request:
                def response():
                    body = io.StringIO('{"answers": []}')
                    body.headers = {}
                    return body

                request.return_value.__enter__.side_effect = response
                experiment.run(folder, folder / "key", output, resume=True)
                self.assertEqual(request.call_count, 2)
            saved = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual([r["window_start"] for r in saved], [0, 1, 2])
            self.assertTrue(output.read_text().startswith(prefix))
            (folder / "frame.jpg").write_bytes(b"changed-jpeg")
            with patch("urllib.request.urlopen") as request:
                with self.assertRaisesRegex(ValueError, "successful prefix"):
                    experiment.run(folder, folder / "key", output, resume=True)
                request.assert_not_called()

    def test_recorded_report_reproduces_through_cli(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(
                [sys.executable, str(experiment.ROOT / "experiment.py"), "summarize",
                 "--output-dir", folder], check=True, capture_output=True,
            )
            actual = experiment.read_json(pathlib.Path(folder) / "summary.json")
            self.assertEqual(actual, experiment.read_json(experiment.ROOT / "results/summary.json"))
            self.assertEqual(actual["completed_requests"], 25)
            self.assertEqual(actual["missing_requests"], 0)
            self.assertEqual(actual["refused_crash_questions"], 0)
            self.assertEqual(
                (pathlib.Path(folder) / "windows.csv").read_bytes(),
                (experiment.ROOT / "results/windows.csv").read_bytes(),
            )

    def test_duplicate_windows_and_inconsistent_counts_are_rejected(self):
        rows = [json.loads(line) for line in
                (experiment.ROOT / "results/baseline.jsonl").read_text().splitlines()]
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            source = folder / "changed.jsonl"
            duplicate = [rows[0], rows[0], *rows[2:]]
            source.write_text("\n".join(json.dumps(row) for row in duplicate))
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                experiment.summarize(source, folder)
            rows[1]["expected_requests"] = 24
            source.write_text("\n".join(json.dumps(row) for row in rows))
            with self.assertRaisesRegex(ValueError, "Inconsistent"):
                experiment.summarize(source, folder)

    def test_partial_run_and_refusal_remain_visible(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            folder = pathlib.Path(folder)
            row = json.loads((experiment.ROOT / "results/baseline.jsonl").read_text().splitlines()[0])
            row["response"]["answers"][0] = {"name": "crash", "type": "refusal"}
            source = folder / "partial.jsonl"
            source.write_text(json.dumps(row) + "\n" + json.dumps({"error_type": "TimeoutError"}) + "\n")
            experiment.summarize(source, folder)
            report = experiment.read_json(folder / "summary.json")
            self.assertEqual(report["refused_crash_questions"], 1)
            self.assertIsNone(report["clip_results"][0]["peak_probability"])
            self.assertEqual(report["errors"], 1)
            self.assertEqual(report["missing_requests"], 23)

    def test_existing_output_prevents_api_call(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            (folder / "key").write_text("test-only")
            (folder / "jobs.json").write_text("[{}]")
            output = folder / "results.jsonl"
            output.write_text("existing result")
            with patch("urllib.request.urlopen") as request:
                with self.assertRaises(FileExistsError):
                    experiment.run(folder, folder / "key", output)
                request.assert_not_called()
            self.assertEqual(output.read_text(), "existing result")

    def test_http_failure_stops_without_retry_or_label_leakage(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            (folder / "key").write_text("test-only-secret")
            (folder / "frame.jpg").write_bytes(b"synthetic-jpeg")
            job = {"clip": "hidden-clip-label", "expected": "hidden-expected-label",
                   "window_start": 0, "window_end": 3.5, "frames": ["frame.jpg"] * 8}
            (folder / "jobs.json").write_text(json.dumps([job, job]))
            output = folder / "results.jsonl"
            failure = urllib.error.HTTPError("https://api.openai.com", 429, "test", {}, None)
            with patch("urllib.request.urlopen", side_effect=failure) as request:
                with self.assertRaises(SystemExit):
                    experiment.run(folder, folder / "key", output)
                self.assertEqual(request.call_count, 1)
                sent = request.call_args.args[0].data.decode()
                self.assertNotIn("hidden-clip-label", sent)
                self.assertNotIn("hidden-expected-label", sent)
                self.assertEqual(sent.count('"type": "input_image"'), 8)
            saved = output.read_text()
            self.assertNotIn("test-only-secret", saved)
            self.assertEqual(json.loads(saved)["status"], 429)


if __name__ == "__main__":
    unittest.main()
