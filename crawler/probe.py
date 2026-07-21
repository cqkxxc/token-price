"""Deprecated direct-probe module.

Route health is sourced from Oken's verified model-supplier measurements.
Keeping a failing compatibility function prevents old callers from silently
reintroducing one synthetic supplier check across every model.
"""


def run_probe(*_args, **_kwargs):
    raise RuntimeError(
        "Direct synthetic probing is disabled; use Oken route stability data"
    )
