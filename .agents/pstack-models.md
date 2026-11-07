# Repository model preferences

All roles: inherit-parent
Default effort: inherit-parent

Use the current session's model and effort. Do not apply the Claude model aliases or automatic effort adjustments retained in upstream workflow examples. Do not fabricate model diversity: label a same-model panel accordingly.

`$setup-pstack` can record explicit per-role choices here after checking the current host's supported models and dispatch settings. A named model that is unavailable must be reported, never silently substituted. This file is read as instructions; it is not a plugin override-sheet format or an executable Codex configuration.
