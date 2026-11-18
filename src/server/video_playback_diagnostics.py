"""Safe diagnostics for stream resolution; never return exception text or URLs."""

import asyncio
import socket
import httpcore
import httpx


def resolution_failure(exc: BaseException) -> dict:
    """Classify only evidence available from the exception chain."""
    seen = set()
    pending = [exc]
    while pending:
        current = pending.pop()
        if not isinstance(current, BaseException) or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, (TimeoutError, asyncio.TimeoutError, socket.timeout,
                                httpx.TimeoutException, httpcore.TimeoutException)):
            return {"stage": "resolution", "code": "resolution_timeout"}
        for name in ("__cause__", "__context__", "cause", "reason"):
            child = getattr(current, name, None)
            if isinstance(child, BaseException):
                pending.append(child)
        exc_info = getattr(current, 'exc_info', None)
        if isinstance(exc_info, tuple) and len(exc_info) > 1 and isinstance(exc_info[1], BaseException):
            pending.append(exc_info[1])
    return {"stage": "resolution", "code": "extraction_failed"}
