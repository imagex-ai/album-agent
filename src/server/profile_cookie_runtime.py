"""Bounded ECMAScript calculation with no Python, Node, filesystem or network bindings.

One QuickJS context per call: no shared globals/cookies across origins or threads.
Missing engine/invalid code/resource exhaustion fail closed; never fall back to Node.
"""
import re

# Technical resource bounds for untrusted source code, not media/business limits.
MAX_SCRIPT_CHARACTERS = 1024 * 1024
SCRIPT_MEMORY_BYTES = 16 * 1024 * 1024
SCRIPT_STACK_BYTES = 256 * 1024
SCRIPT_CPU_SECONDS = 1.0
MAX_COOKIE_BYTES = 4096
COOKIE_ATTRIBUTES = frozenset({'path', 'domain', 'expires', 'max-age', 'samesite', 'httponly', 'secure', 'partitioned'})


def calculate_cookie_script(script: str) -> dict[str, str]:
    if not isinstance(script, str) or not script or len(script) > MAX_SCRIPT_CHARACTERS:
        return {}
    try:
        import quickjs
        context = quickjs.Context()
        context.set_memory_limit(SCRIPT_MEMORY_BYTES)
        context.set_max_stack_size(SCRIPT_STACK_BYTES)
        context.set_time_limit(SCRIPT_CPU_SECONDS)
        # Do not add Python callables, module loaders, browser APIs or host objects.
        raw = context.eval(
            "(() => { const document = {cookie: '', location: {reload: () => {}}}; "
            "const window = {document};\n" + script +
            "\nif (typeof go === 'function') go(); return document.cookie; })()"
        )
    except Exception:
        return {}
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_COOKIE_BYTES:
        return {}
    cookies = {}
    for part in raw.split(';'):
        if '=' not in part:
            continue
        name, value = (piece.strip() for piece in part.split('=', 1))
        if (name.lower() in COOKIE_ATTRIBUTES or not value
                or not re.fullmatch(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+", name)
                or re.search(r'[\x00-\x20\x7f]', value)):
            continue
        cookies[name] = value
    return cookies
