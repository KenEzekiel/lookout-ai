# Decisions car-crash experiment

This experiment replays four vehicle collisions and two ordinary-traffic controls
through OpenAI Decisions. It follows the [fall experiment](../decisions-falls/README.md)
with eight chronological frames per request and a candidate threshold of **0.70**,
fixed before evaluation. It is separate from the application and does not confirm
incidents, send alerts, or make calls.

## Recorded baseline

The November 7, 2026 run completed **25 requests without errors or refusals** using
`gpt-6-luna`. All four crash clips produced a candidate. Neither control produced
a candidate in its five windows, giving ten control windows in total.

| Clip            | Expected | Peak crash score | Candidate windows | First candidate, video time |
| --------------- | -------- | ---------------- | ----------------- | --------------------------- |
| crash-tbone     | Crash    | 1.00             | 3 / 3             | 3.5 s                       |
| crash-headon    | Crash    | 1.00             | 4 / 5             | 3.5 s                       |
| crash-rearend   | Crash    | 0.93             | 2 / 2             | 3.5 s                       |
| crash-sideswipe | Crash    | 0.98             | 4 / 5             | 4.5 s                       |
| normal-highway  | No crash | 0.00             | 0 / 5             | None                        |
| normal-traffic  | No crash | 0.01             | 0 / 5             | None                        |

The sideswipe's first window ends before the annotated collision and scores 0.07.
Its next window crosses the threshold. The head-on clip's last window scores 0.30
and `unclear` scores 0.83, after earlier windows detected the event. The separate
`unclear` question is recorded but does not gate candidates, matching the fall
experiment. Model scores are not calibrated real-world probabilities.

Each request contains eight 640 × 360 JPEGs with `detail: high`, sampled at 2 fps.
The window advances two frames, representing one request per video second.
Eight samples span 3.5 seconds between first and last nominal timestamps. Clips
are limited to their first eight seconds, or their shorter source duration.
No future frames enter a window. Only timestamps, instructions, and image bytes
enter the model input; clip filenames, expected labels, and onset annotations do not.
The exact prompts are in [experiment.py](experiment.py).

First candidates occur 0.5–2.5 seconds after the manually assigned approximate
onsets in nominal video time. Three collisions begin before the first full
window. These delays include startup buffering and exclude upload, inference,
and second-stage verification. They do not establish live alert latency.

API wall time, measured around HTTP upload and response reading, has a median of
0.670 seconds, p95 of 1.450 seconds using nearest rank, and range of
0.417–1.756 seconds. Requests ran sequentially without real-time pacing.
The interrupted run saved 23 successful responses; resuming completed only the
two remaining control windows. This is one evaluation split across two sessions,
not repeated trials. No server/network profile or concurrent throughput test ran,
so these timings do not establish sustained live performance or a speedup over falls.

## Usage and cost

Every response reports 2,410 input tokens and zero output tokens. Across the run,
60,250 input tokens comprise 9,025 uncached tokens, 49,176 cache-write tokens,
and 2,049 cache-read tokens. At the standard rates checked on November 7, 2026:

```text
(9,025 × $0.10 + 49,176 × $0.125 + 2,049 × $0.01) / 1,000,000
  = $0.00706999 for the 25 recorded responses
  = $0.0002827996 per request on average
  = $1.01807856 per camera-hour at one request per second
```

Rates come from the [official GPT-6 Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).
This is an estimate from returned usage, not a billing invoice. An interrupted
request without a saved response may still have been billed. It includes both
questions and all eight images, rather than an isolated per-image measurement.
The hourly figure projects this run's cache mix; live caching may differ. It
excludes verification, storage, notifications, calls, retries, regional premiums,
and long-context pricing. Overlapping windows did not consistently yield cache reads.

## Reproduce

Requirements are Python 3.10+ with its standard library, FFmpeg, and network
access for downloads. No Python packages are needed. FFmpeg 9.0.2 reproduced all
25 original request hashes from the checksummed videos during verification.
Other FFmpeg versions may produce different JPEG bytes.

From the repository root:

```sh
python3 experiments/decisions-crashes/experiment.py prepare

python3 experiments/decisions-crashes/experiment.py summarize

python3 -m unittest discover -s experiments/decisions-crashes -p 'test_*.py'

python3 experiments/decisions-crashes/experiment.py run \
  --key-file /absolute/path/to/private/openai-key \
  --output experiments/decisions-crashes/.local/new-run.jsonl

python3 experiments/decisions-crashes/experiment.py summarize \
  --results experiments/decisions-crashes/.local/new-run.jsonl \
  --output-dir experiments/decisions-crashes/.local/new-report
```

`prepare` downloads about 13 MB, checks SHA-256, and extracts frames without
calling OpenAI. `summarize` recalculates the saved results without a key or model
requests. Tests reproduce the committed summary and CSV, check duplicate and
inconsistent results, preserve missing/refused evaluations, and exercise HTTP
failure, overwrite prevention, label isolation, and resumability at the HTTP boundary.

The [raw responses](results/baseline.jsonl), [summary](results/summary.json),
[per-window scores](results/windows.csv), and [input manifest](results/inputs.json)
preserve the evidence. The manifest records each window's frame paths and hashes;
the raw rows record the corresponding complete request-body hash and request ID.

Use a private credential tool or a permission-restricted key file outside the
repository. The runner never prints or saves the key in results. Fresh runs refuse
to overwrite output, cap at 80 requests, and stop at the first HTTP or transport
failure without retries. Downloads, extracted frames, and fresh results stay in
the ignored `.local/` directory.

After inspecting an interrupted run and confirming its old process has stopped,
explicitly add `--resume` to the same `run` command. It requires the saved rows to
be a successful prefix with matching metadata and request hashes. It appends only
remaining jobs and rejects changed inputs, recorded errors, and malformed rows.
It cannot determine whether an unsaved in-flight request was billed. Run only one
writer per output file. Partial runs and refused questions remain visible in the
summary and must not be treated as negative detections.

## Data and limits

[dataset.json](dataset.json) pins source URLs, checksums, clip lengths, expected
labels, and approximate manually inspected onset times. The crash examples are
from the [ACCIDENT project page](https://accidentbench.github.io/) by Lukas Picek,
Michal Cermak, Marek Hanzl, and Vojtech Cermak. The controls come from the separate
[AarohiSingla speed-detection example](https://github.com/AarohiSingla/Speed-detection-of-vehicles)
and [DeGirum PySDK examples](https://github.com/DeGirum/PySDKExamples), with immutable
source revisions in the manifest. These are selected public demonstration clips,
not an evaluation of ACCIDENT's official benchmark partitions or annotations.
Footage redistribution rights were not independently verified. Videos and contact
sheets are not committed.

This is one smoke test on six selected clips. Overlapping windows are correlated.
Two daylight highway controls cannot estimate false alarms per camera-hour and
do not match every crash scene. There are no nighttime, bad-weather, occluded,
near-miss, emergency-braking, or long-duration controls. No threshold tuning,
repeatability study, or second verification model ran. Clip scores do not establish
general accuracy, production safety, or incident-lifecycle integration.

The next useful check is longer unseen footage with difficult controls and
pre-event context, followed by second-stage review. This result supplies research
evidence for future device assessment; it does not implement monitoring.

## References

- [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions).
- [GPT-6 Luna model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).
- [ACCIDENT surveillance-video benchmark](https://accidentbench.github.io/).
