import argparse
import base64
import csv
import hashlib
import json
import math
import pathlib
import statistics
import subprocess
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
MODEL = "gpt-6-luna"
THRESHOLD = 0.7
MAX_REQUESTS = 80


def read_json(path):
    return json.loads(path.read_text())


def prepare(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for clip in read_json(ROOT / "dataset.json")["clips"]:
        video = data_dir / (clip["id"] + ".mp4")
        if not video.exists():
            temporary = video.with_suffix(".download")
            with urllib.request.urlopen(clip["url"], timeout=60) as response:
                temporary.write_bytes(response.read())
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != clip["sha256"]:
                temporary.unlink()
                raise ValueError(f"Downloaded checksum mismatch: {clip['id']}")
            temporary.replace(video)
        if hashlib.sha256(video.read_bytes()).hexdigest() != clip["sha256"]:
            raise ValueError(f"Local checksum mismatch: {video}")
        folder = data_dir / "sampled" / clip["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for frame in folder.glob("*.jpg"):
            frame.unlink()
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf",
             "fps=2:start_time=0,scale=640:-2", "-t", str(clip["duration_seconds"]),
             str(folder / "%04d.jpg")],
            check=True,
        )
        frames = sorted(folder.glob("*.jpg"))
        if len(frames) < 8:
            raise ValueError(f"Clip has fewer than eight frames: {clip['id']}")
        for end in range(8, len(frames) + 1, 2):
            jobs.append({
                "clip": clip["id"],
                "expected": clip["expected"],
                "source_onset_seconds": clip["source_onset_seconds"],
                "window_start": (end - 8) / 2,
                "window_end": (end - 1) / 2,
                "frames": [str(f.relative_to(data_dir)) for f in frames[end - 8:end]],
            })
    if not 0 < len(jobs) <= MAX_REQUESTS:
        raise ValueError(f"Expected 1–{MAX_REQUESTS} requests, got {len(jobs)}")
    (data_dir / "jobs.json").write_text(json.dumps(jobs, indent=2) + "\n")
    print(f"Prepared {len(jobs)} requests. No API calls made.")


def request_body(job, data_dir):
    parts = [{
        "type": "input_text",
        "text": "Evaluate only these eight chronological camera observations. "
                "They are sampled at 2 frames per second. Use the sequence to "
                "distinguish actual vehicle collisions from ordinary driving, braking, "
                "lane changes, close passes, and perspective overlap. A stopped vehicle "
                "or overlapping vehicles alone do not prove a crash. "
                "Do not infer events outside this window.",
    }]
    for index, path in enumerate(job["frames"]):
        encoded = base64.b64encode((data_dir / path).read_bytes()).decode()
        parts.extend([
            {"type": "input_text", "text": f"Time {job['window_start'] + index / 2:.1f} seconds."},
            {"type": "input_image", "image_url": "data:image/jpeg;base64," + encoded,
             "detail": "high"},
        ])
    return {
        "model": MODEL,
        "input": [{"role": "user", "content": parts}],
        "questions": [
            {"type": "predicate", "name": "crash",
             "instructions": "Does this sequence show a motor vehicle colliding with another "
                             "vehicle, a road user, or a fixed object, or clear visual "
                             "evidence that such a collision has just occurred? Exclude "
                             "ordinary braking, lane changes, close passes, perspective "
                             "overlap, and stopped traffic without collision evidence."},
            {"type": "predicate", "name": "unclear",
             "instructions": "Is the evidence too ambiguous or occluded to distinguish "
                             "a vehicle collision from ordinary traffic?"},
        ],
    }


def run(data_dir, key_file, output, resume=False):
    key = key_file.read_text().strip()
    if not key:
        raise ValueError("Key file is empty")
    jobs = read_json(data_dir / "jobs.json")
    if not 0 < len(jobs) <= MAX_REQUESTS:
        raise ValueError(f"Expected 1–{MAX_REQUESTS} requests, got {len(jobs)}")
    completed = []
    if resume:
        completed = [json.loads(line) for line in output.read_text().splitlines()]
        if len(completed) > len(jobs):
            raise ValueError("Saved run has more rows than the prepared jobs")
        for row, job in zip(completed, jobs):
            digest = hashlib.sha256(json.dumps(request_body(job, data_dir)).encode()).hexdigest()
            if ("response" not in row or "error_type" in row
                    or row.get("expected_requests") != len(jobs)
                    or row.get("request_sha256") != digest
                    or any(row.get(k) != v for k, v in job.items() if k != "frames")):
                raise ValueError("Saved run does not match a successful prefix of the prepared jobs")
    with output.open("a" if resume else "x") as stream:
        for index in range(len(completed), len(jobs)):
            job = jobs[index]
            request = urllib.request.Request(
                "https://api.openai.com/v1/decisions",
                data=json.dumps(request_body(job, data_dir)).encode(),
                headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            )
            start = time.perf_counter()
            row = {k: v for k, v in job.items() if k != "frames"}
            row["expected_requests"] = len(jobs)
            row["request_sha256"] = hashlib.sha256(request.data).hexdigest()
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    row["response"] = json.load(response)
                    row["request_id"] = response.headers.get("x-request-id")
            except (urllib.error.URLError, TimeoutError) as error:
                row["error_type"] = type(error).__name__
                if isinstance(error, urllib.error.HTTPError):
                    row["status"] = error.code
                row["elapsed_seconds"] = time.perf_counter() - start
                stream.write(json.dumps(row) + "\n")
                stream.flush()
                raise SystemExit(f"Stopped on {row['error_type']}; no retries. See {output}.")
            row["elapsed_seconds"] = time.perf_counter() - start
            stream.write(json.dumps(row) + "\n")
            stream.flush()
            print(json.dumps({"completed": index + 1, "clip": job["clip"],
                              "window_end": job["window_end"],
                              "answers": row["response"].get("answers"),
                              "elapsed_seconds": row["elapsed_seconds"]}), flush=True)


def summarize(results, output_dir):
    rows = [json.loads(line) for line in results.read_text().splitlines()]
    ok = [row for row in rows if "response" in row]
    if not ok:
        raise ValueError("No successful responses to summarize")
    identities = [(row["clip"], row["window_start"]) for row in ok]
    if len(identities) != len(set(identities)):
        raise ValueError("Duplicate successful windows cannot establish coverage")
    expected = rows[0]["expected_requests"]
    if len(rows) > expected or any(row.get("expected_requests", expected) != expected for row in rows):
        raise ValueError("Inconsistent request counts")
    clips = []
    for row in ok:
        answers = {answer["name"]: answer for answer in row["response"]["answers"]}
        row["crash_probability"] = answers["crash"].get("probability")
        row["unclear_probability"] = answers["unclear"].get("probability")
    for clip in dict.fromkeys(row["clip"] for row in ok):
        windows = [row for row in ok if row["clip"] == clip]
        probabilities = [row["crash_probability"] for row in windows
                         if row["crash_probability"] is not None]
        hits = [row for row in windows if row["crash_probability"] is not None
                and row["crash_probability"] >= THRESHOLD]
        onset = windows[0]["source_onset_seconds"]
        clips.append({
            "clip": clip, "expected": windows[0]["expected"], "windows": len(windows),
            "candidate_windows": len(hits), "peak_probability": max(probabilities, default=None),
            "first_candidate_video_seconds": hits[0]["window_end"] if hits else None,
            "source_onset_seconds": onset,
            "nominal_delay_seconds": round(hits[0]["window_end"] - onset, 2)
                                     if hits and onset is not None else None,
        })
    cost = 0
    inputs = cached = writes = 0
    for row in ok:
        usage = row["response"]["usage"]
        details = usage["input_tokens_details"]
        total, reads, written = (usage["input_tokens"], details["cached_tokens"],
                                 details["cache_write_tokens"])
        inputs += total
        cached += reads
        writes += written
        cost += ((total - reads - written) * 0.1 + reads * 0.01 + written * 0.125) / 1e6
    latency = sorted(row["elapsed_seconds"] for row in ok)
    summary = {
        "expected_requests": rows[0]["expected_requests"],
        "recorded_requests": len(rows),
        "completed_requests": len(ok), "errors": len(rows) - len(ok),
        "missing_requests": max(0, rows[0]["expected_requests"] - len(rows)),
        "threshold": THRESHOLD,
        "model_ids": sorted(set(row["response"]["model"] for row in ok)),
        "refused_crash_questions": sum(row["crash_probability"] is None for row in ok),
        "input_tokens": inputs, "cached_tokens": cached, "cache_write_tokens": writes,
        "estimated_cost_usd": cost, "average_request_cost_usd": cost / len(ok),
        "projected_hour_at_1rps_usd": cost / len(ok) * 3600,
        "latency_seconds": {"median": statistics.median(latency),
                            "p95_nearest_rank": latency[math.ceil(0.95 * len(latency)) - 1],
                            "min": latency[0], "max": latency[-1]},
        "clip_results": clips,
        "limitations": [
            "One run on four selected crashes and two normal-traffic controls, not a general accuracy benchmark.",
            "Offline sequential requests; no real-time concurrency, verification model, or calls.",
            "Manually assigned coarse onset labels; nominal delays exclude API and verification latency and include warm-up effects.",
            "Standard-rate cost estimate from token usage, not an invoice; pricing checked 2026-11-07.",
            "Partial runs and refused questions must not be counted as negative detections.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    fields = ["clip", "expected", "window_start", "window_end", "crash_probability",
              "unclear_probability", "elapsed_seconds"]
    with (output_dir / "windows.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows({key: row[key] for key in fields} for row in ok)
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Replay labeled crash clips through Decisions.")
    parser.add_argument("--data-dir", type=pathlib.Path, default=ROOT / ".local")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare")
    running = commands.add_parser("run")
    running.add_argument("--key-file", type=pathlib.Path, required=True)
    running.add_argument("--output", type=pathlib.Path, required=True)
    running.add_argument("--resume", action="store_true")
    report = commands.add_parser("summarize")
    report.add_argument("--results", type=pathlib.Path, default=ROOT / "results/baseline.jsonl")
    report.add_argument("--output-dir", type=pathlib.Path, default=ROOT / ".local/report")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.data_dir)
    elif args.command == "run":
        run(args.data_dir, args.key_file, args.output, args.resume)
    else:
        summarize(args.results, args.output_dir)


if __name__ == "__main__":
    main()
