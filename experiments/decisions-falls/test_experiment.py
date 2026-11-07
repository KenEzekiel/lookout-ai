import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import experiment


class ExperimentTests(unittest.TestCase):
    def test_recorded_metrics_reproduce(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            output = pathlib.Path(folder)
            experiment.summarize(experiment.ROOT / 'results/baseline.jsonl', output)
            actual = experiment.read_json(output / 'summary.json')
            baseline = experiment.read_json(experiment.ROOT / 'results/baseline-summary.json')
            for key in baseline.keys() - {'expected_requests', 'limitations'}:
                self.assertEqual(actual[key], baseline[key], key)
            self.assertEqual(actual['completed_requests'], 46)
            self.assertEqual(actual['refused_fall_questions'], 0)

    def test_refusal_is_not_a_negative(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            folder = pathlib.Path(folder)
            row = json.loads((experiment.ROOT / 'results/baseline.jsonl').read_text().splitlines()[0])
            row['response']['answers'][0] = {'name': 'fall', 'type': 'refusal'}
            source = folder / 'refusal.jsonl'
            source.write_text(json.dumps(row) + '\n')
            experiment.summarize(source, folder)
            report = experiment.read_json(folder / 'summary.json')
            self.assertEqual(report['refused_fall_questions'], 1)
            self.assertIsNone(report['clip_results'][0]['peak_probability'])

    def test_existing_output_prevents_api_call(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            (folder / 'key').write_text('test-only')
            (folder / 'jobs.json').write_text('[{}]')
            output = folder / 'results.jsonl'
            output.write_text('existing result')
            with patch('urllib.request.urlopen') as request:
                with self.assertRaises(FileExistsError):
                    experiment.run(folder, folder / 'key', output)
                request.assert_not_called()
            self.assertEqual(output.read_text(), 'existing result')

    def test_http_failure_stops_without_retry_or_secret_output(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            (folder / 'key').write_text('test-only-secret')
            job = {'clip': 'test', 'window_end': 3.5, 'frames': []}
            (folder / 'jobs.json').write_text(json.dumps([job, job]))
            output = folder / 'results.jsonl'
            failure = urllib.error.HTTPError('https://api.openai.com', 429, 'test', {}, None)
            with patch('urllib.request.urlopen', side_effect=failure) as request:
                with self.assertRaises(SystemExit):
                    experiment.run(folder, folder / 'key', output)
                self.assertEqual(request.call_count, 1)
            saved = output.read_text()
            self.assertNotIn('test-only-secret', saved)
            self.assertEqual(json.loads(saved)['status'], 429)


if __name__ == '__main__':
    unittest.main()
