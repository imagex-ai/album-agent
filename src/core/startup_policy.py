"""Opt-out of automatic startup maintenance for isolated diagnostic runs."""
import os


def startup_maintenance_enabled() -> bool:
    return os.getenv('IMAGEX_SKIP_STARTUP_MAINTENANCE', '').strip().lower() not in ('1', 'true', 'yes')
