#!/usr/bin/env python3
"""Check local skill discovery, packaged resources, and relative Markdown links."""

import json
import re
from pathlib import Path
from urllib.parse import unquote


def check(root):
    errors = []
    media_extensions = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov", ".zip"}
    for entry in (root / "docs/qa").rglob("*"):
        if entry.is_file() and entry.suffix.lower() in media_extensions:
            errors.append(f"{entry.relative_to(root)}: upload QA media as PR attachments; keep local captures in test-results/ or a temporary directory")
    skills = root / ".agents/skills"
    entries = sorted(skills.glob("*/SKILL.md"))
    if not entries:
        errors.append("No discoverable skills")
    names = set()
    for entry in entries:
        text = entry.read_text()
        front = re.match(r"\A---\n(.*?)\n---(?:\n|$)", text, re.S)
        if not front:
            errors.append(f"{entry.relative_to(root)}: missing frontmatter")
            continue
        name = re.search(r"^name: *([^\n]+)$", front[1], re.M)
        description = re.search(r"^description: *([^\n]+)$", front[1], re.M)
        if not name or name[1] != entry.parent.name or not re.fullmatch(r"[a-z0-9-]{1,64}", name[1]):
            errors.append(f"{entry.relative_to(root)}: invalid or mismatched name")
        elif name[1] in names:
            errors.append(f"Duplicate skill: {name[1]}")
        else:
            names.add(name[1])
        if not description or not description[1].strip():
            errors.append(f"{entry.relative_to(root)}: missing description")

    for entry in (root / ".agents").rglob("*.md"):
        for target in re.findall(r"\]\(([^\s)]+)(?:\s+\"[^\"\n]*\")?\)", entry.read_text()):
            if ":" in target or target.startswith(("#", "/")) or "<" in target:
                continue
            target = unquote(target.split("#")[0])
            if target and not (entry.parent / target).exists():
                errors.append(f"{entry.relative_to(root)}: missing link target {target}")

    manifest = json.loads((root / ".agents/pstack/upstream.json").read_text())
    for source in manifest["source_sha256"]:
        local = source.replace("plugins/pstack/skills/", ".agents/skills/", 1).replace("plugins/pstack/agents/", ".agents/roles/", 1)
        if not (root / local).is_file():
            errors.append(f"Missing copied resource: {local}")
    for required in ("AGENTS.md", ".agents/pstack-models.md", ".agents/pstack/LICENSE", ".agents/pstack/LICENSE-cursor-team-kit", ".agents/pstack/LICENSE-thermos", ".agents/pstack/NOTICE.md", ".agents/pstack/NOTICE-skills.md"):
        if not (root / required).is_file():
            errors.append(f"Missing {required}")
    return entries, errors


if __name__ == "__main__":
    entries, errors = check(Path(__file__).resolve().parents[1])
    for error in errors:
        print(error)
    if errors:
        raise SystemExit(1)
    print(f"Validated {len(entries)} skills, copied resources, licenses, and relative Markdown links.")
