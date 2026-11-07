# Decisions fall-detection experiment

This experiment replays four staged falls and four ordinary activities through
OpenAI Decisions. It tests whether a short frame sequence can distinguish falls
from lying on a bed, picking up a phone, stretching, and sitting on the floor.
It is separate from the product application and does not verify incidents or make calls.

## Recorded baseline

The November 7, 2026 run completed 46 requests without errors using `gpt-6-luna`.
Every request contained eight 640 × 360 images with `detail: high`, sampled at
2 fps. The window advances two frames, representing one request per video second.
Eight samples span 3.5 seconds between the first and last timestamp.
The first full window ends at nominal video time 3.5 seconds.

The candidate threshold was **0.70**, selected before the run. The separate
`unclear` question was recorded but did not gate candidates.

| Clip            | Expected | Peak fall score | Candidate windows | First candidate, video time |
| --------------- | -------- | --------------- | ----------------- | --------------------------- |
| fall-chair      | Fall     | 0.95            | 3 / 4             | 4.5 s                       |
| fall-walking    | Fall     | 0.87            | 1 / 3             | 4.5 s                       |
| fall-person2    | Fall     | 0.83            | 2 / 5             | 5.5 s                       |
| fall-backward   | Fall     | 0.81            | 1 / 7             | 5.5 s                       |
| normal-bed      | No fall  | 0.00            | 0 / 5             | None                        |
| normal-pickup   | No fall  | 0.00            | 0 / 4             | None                        |
| normal-exercise | No fall  | 0.02            | 0 / 10            | None                        |
| normal-floor    | No fall  | 0.05            | 0 / 8             | None                        |

All four fall clips produced a candidate. No candidates occurred in the four
negative clips' 27 windows. Two falls crossed the threshold in only one window,
so requiring repeated positives would have missed those events in this run.

API wall time, measured around each HTTP request including upload and response
reading, had a median of 0.621 seconds, p95 of 1.389 seconds using nearest rank,
and range of 0.438–2.704 seconds. Calls ran sequentially without real-time pacing.
These numbers do not establish that a concurrent live stream sustains one request
per second. We did not profile the server/network latency breakdown.

Each request reported 2,387 input tokens, including 2,040 cache-write tokens and
zero cache-read tokens. At the rates checked on November 7, 2026, the cost is:

```text
(347 × $0.10 + 2,040 × $0.125) / 1,000,000 = $0.0002897 per request
46 requests = $0.0133262
One request/second for one camera-hour = $1.04292
```

This is an estimate from returned usage, not a billing invoice. It includes both
questions and eight images, not an isolated per-image measurement. It excludes
verification, storage, calls, retries, regional premiums, and long-context pricing.
Sliding-window overlap did not produce cache reads in this run.

The [raw responses](results/baseline.jsonl), [original summary](results/baseline-summary.json),
and [per-window scores](results/baseline-windows.csv) preserve the observed run.
The summary command can reproduce the measurements without a key or API calls.

## Reproduce

Requirements: Python 3.10+ with its standard library, `ffmpeg`, and network access
for downloads. The recorded extraction used FFmpeg 7.1.1; different versions may
produce different JPEG bytes. No Python package installation is needed.

From the repository root:

```sh
# Download about 72 MB of footage, verify SHA-256, and extract frames locally.
python3 experiments/decisions-falls/experiment.py prepare

# Recalculate the committed baseline measurements without calling OpenAI.
python3 experiments/decisions-falls/experiment.py summarize

# Verify result reproduction and API failure handling without spending credits.
python3 -m unittest discover -s experiments/decisions-falls -p 'test_*.py'

# Run a new paid experiment using a private file containing only the API key.
python3 experiments/decisions-falls/experiment.py run \
  --key-file /absolute/path/to/private/openai-key \
  --output experiments/decisions-falls/.local/new-run.jsonl

python3 experiments/decisions-falls/experiment.py summarize \
  --results experiments/decisions-falls/.local/new-run.jsonl \
  --output-dir experiments/decisions-falls/.local/new-report
```

Use a private credential tool or a permission-restricted file outside the
repository for the key. The runner never prints it, copies it into results, or
accepts it as a literal command-line value. Do not commit a key file.

`prepare` never calls OpenAI. `run` refuses to overwrite existing output, caps
runs at 80 requests, and stops at the first HTTP or transport error without
retrying. An interrupted request may still be billed. Inspect partial results
before deliberately starting another run. Summary output counts errors and
refused fall questions; missing or refused evaluations are not negatives.

Downloads, frames, and fresh results default to the ignored `.local/` directory.
The exact baseline prompts live in `request_body()` in [experiment.py](experiment.py).
Only timestamps and image bytes enter the model input; filenames, dataset labels,
and source event times are not sent. No future frames enter a window.

## Data and limits

[dataset.json](dataset.json) pins the GMDCSA24 source revision, URLs, checksums,
expected clip labels, and approximate source onset annotations. Attribution:
Ekram Alam et al., _GMDCSA24: A Dataset for Human Fall Detection in Videos_ (2024),
[DOI 10.5281/zenodo.12921216](https://doi.org/10.5281/zenodo.12921216).
The upstream repository's [MIT license](DATASET-LICENSE) is included.
Footage-specific public redistribution permission was not separately verified;
videos are not committed to this repository.

This is one smoke test on selected clips from two participants and two scenes.
The overlapping windows are correlated. These results are not a general accuracy
estimate, probability calibration, or evidence of production safety.

Source onset labels are approximate. First candidates occur 1.1–2.8 seconds after
those labels in nominal video time, excluding API and verification latency.
Several falls begin before the first full window. Treat startup buffering
separately from steady-state monitoring; this run cannot measure their difference.

The next checks are longer unseen footage with adequate pre-event context,
additional participants, difficult negatives, crash footage with independent
normal-traffic controls, and a second verification model. Neither crash detection
nor the product's incident/call lifecycle is implemented by this experiment.

## References

- [Decisions API and pricing](https://developers.openai.com/api/docs/guides/decisions)
- [GPT-6 Luna cache pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GMDCSA24 repository](https://github.com/ekramalam/GMDCSA24-A-Dataset-for-Human-Fall-Detection-in-Videos)
