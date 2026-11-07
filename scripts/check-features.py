import argparse
from pathlib import Path
import re
import sys

parser = argparse.ArgumentParser(description="Validate or list Lookout feature records")
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument("--list", action="store_true")
args = parser.parse_args()
root = args.root.resolve()
folder = root / "docs/features"
files = sorted(path for path in folder.rglob("*.md") if path.name != "README.md")
codes = {path.stem for path in files}
errors = []
seen = set()
sections = (
    "Behavior", "Entry points", "Wiring and compatibility", "Implementation",
    "Verification", "Decisions and sources", "Open questions",
)
if not files:
    errors.append("docs/features: no feature records found")
for path in files:
    source = path.read_text()
    code = path.stem
    if code in seen:
        errors.append(f"{path.relative_to(root)}: duplicate feature code {code}")
    seen.add(code)
    prefix = f"{path.relative_to(root)}: "
    if not re.fullmatch(r"F-[A-Z]+(?:-[A-Z]+)*", code):
        errors.append(prefix + "use a descriptive F- code without numbers")
    title = re.match(r"# " + re.escape(code) + r": (\S[^\n]*)\n", source)
    if not title:
        errors.append(prefix + "title must start with the filename code")
    statuses = re.findall(r"^Status: (.+)$", source, re.M)
    if len(statuses) != 1 or statuses[0] not in {"planned", "partial", "implemented", "retired"}:
        errors.append(prefix + "provide one valid Status field")
    dependencies = re.findall(r"^Depends on: (.+)$", source, re.M)
    if len(dependencies) != 1:
        errors.append(prefix + "provide one Depends on field")
    elif dependencies[0] != "none":
        refs = dependencies[0].split(", ")
        if len(set(refs)) != len(refs):
            errors.append(prefix + "duplicate dependency")
        for ref in refs:
            if ref not in codes or ref == code:
                errors.append(prefix + f"invalid dependency {ref}")
    content = {}
    for section in sections:
        matches = re.findall(r"^## " + re.escape(section) + r"\n(.*?)(?=^## |\Z)", source, re.M | re.S)
        if len(matches) != 1 or not matches[0].strip():
            errors.append(prefix + f"provide one nonempty {section} section")
        else:
            content[section] = matches[0]
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", source):
        if re.match(r"https?://", target) or target.startswith("#"):
            continue
        linked = (path.parent / target.split("#")[0]).resolve()
        if not linked.is_relative_to(root) or not linked.exists():
            errors.append(prefix + f"missing or out-of-repository link {target}")
    if statuses == ["implemented"]:
        for section in ("Implementation", "Verification"):
            if not re.search(r"\[[^\]]+\]\([^)]+\)", content.get(section, "")):
                errors.append(prefix + f"implemented feature needs linked {section.lower()} evidence")
    if args.list and title and len(statuses) == 1:
        print(f"{code}\t{statuses[0]}\t{title[1]}\t{path.relative_to(root)}")
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
if not args.list:
    print(f"Validated {len(files)} Lookout feature records.")
