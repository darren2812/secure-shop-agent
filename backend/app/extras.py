"""Optional penalty providers. Provider failures leave SQL scoring intact.

Providers return fixed reason parameters and small structured audit metadata;
seller passages belong exclusively in ``untrusted``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

EXTRA_CODES = {"policy_red_flag", "linked_two_hops"}
_STATUSES = {"live", "cached", "off", "error"}


@dataclass
class ExtraResult:
    signals: list[dict]
    status: str
    untrusted: dict[str, str]
    audit: dict


class Provider(Protocol):
    name: str

    def enabled(self) -> bool: ...
    async def startup(self) -> None: ...
    def reset(self) -> None: ...
    def signals(self, store: dict, flagged: list[dict], network: bool) -> ExtraResult: ...


PROVIDERS: list[Provider] = []
_statuses: dict[str, str] = {}


async def startup() -> None:
    """Initialize enabled providers; providers must schedule slow warming themselves."""
    _statuses.clear()
    for provider in PROVIDERS:
        try:
            if provider.enabled():
                await provider.startup()
                _statuses[provider.name] = "live"
            else:
                _statuses[provider.name] = "off"
        except Exception:
            _statuses[provider.name] = "error"


def reset() -> None:
    """Reset optional caches after reseeding without making reset depend on them."""
    for provider in PROVIDERS:
        try:
            if provider.enabled():
                provider.reset()
                _statuses[provider.name] = "live"
            else:
                _statuses[provider.name] = "off"
        except Exception:
            _statuses[provider.name] = "error"


def statuses() -> dict[str, str]:
    """Last observed status for each currently registered provider."""
    result = {}
    for provider in PROVIDERS:
        try:
            result[provider.name] = _statuses.get(provider.name, "off") if provider.enabled() else "off"
        except Exception:
            result[provider.name] = "error"
    return result


def run(store: dict, flagged: list[dict], network: bool) -> tuple[list[dict], dict, dict, dict]:
    signals, sources, untrusted, audit = [], {}, {}, {}
    for provider in PROVIDERS:
        status = "off"
        try:
            if provider.enabled():
                result = provider.signals(store, flagged, network)
                if result.status not in _STATUSES:
                    raise ValueError("Invalid provider status")
                status = result.status
                # Only these penalties are allowed: providers cannot add gates or
                # change the SQL facts. Validate before merging any provider data.
                allowed = [s for s in result.signals if s.get("signal") in EXTRA_CODES]
                if not isinstance(result.untrusted, dict) or not isinstance(result.audit, dict):
                    raise ValueError("Invalid provider metadata")
                if status in {"live", "cached"}:
                    signals.extend(allowed)
                    untrusted.update(result.untrusted)
                    audit[provider.name] = result.audit
        except Exception:
            status = "error"
        sources[provider.name] = status
        _statuses[provider.name] = status
    return signals, sources, untrusted, audit
