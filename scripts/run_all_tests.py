import sys, os, inspect, asyncio, tempfile, pathlib
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath("."))

class MonkeyPatch:
    def __init__(self):
        self._undo = []
    def setattr(self, target, name, value, raising=True):
        if isinstance(target, str):
            parts = target.split('.')
            mod = __import__(parts[0])
            for p in parts[1:]:
                mod = getattr(mod, p)
            target = mod
        old_val = getattr(target, name, None)
        setattr(target, name, value)
        self._undo.append(lambda: setattr(target, name, old_val))
    def setenv(self, name, value):
        old_val = os.environ.get(name)
        os.environ[name] = value
        self._undo.append(lambda: os.environ.pop(name, None) if old_val is None else os.environ.__setitem__(name, old_val))
    def delenv(self, name, raising=True):
        old_val = os.environ.get(name)
        os.environ.pop(name, None)
        if old_val is not None:
            self._undo.append(lambda: os.environ.__setitem__(name, old_val))
    def undo(self):
        for fn in reversed(self._undo):
            try:
                fn()
            except Exception:
                pass

# Setup mock pytest and playwright
class MockPytest:
    @staticmethod
    def fixture(fn):
        fn._is_fixture = True
        return fn
    class mark:
        @staticmethod
        def asyncio(fn):
            fn._is_async = True
            return fn
    class raises:
        def __init__(self, exc):
            self.exc = exc
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is None or not issubclass(exc_type, self.exc):
                raise AssertionError(f'Expected {self.exc}, got {exc_type}')
            return True

sys.modules['pytest'] = MockPytest()
sys.modules['playwright'] = MagicMock()
sys.modules['playwright.async_api'] = MagicMock()

test_dir = 'tests'
test_files = sorted([f for f in os.listdir(test_dir) if f.startswith('test_') and f.endswith('.py')])

total_passed = 0
total_failed = 0
failed_tests = []
suite_results = {}

for tf in test_files:
    mod_name = f'tests.{tf[:-3]}'
    try:
        mod = __import__(mod_name, fromlist=['*'])
    except Exception as e:
        print(f'Error importing {tf}: {e}')
        total_failed += 1
        failed_tests.append((tf, str(e)))
        suite_results[tf] = f"Import Error: {e}"
        continue

    funcs = [getattr(mod, name) for name in dir(mod) if name.startswith('test_') and callable(getattr(mod, name)) and not getattr(getattr(mod, name), '_is_fixture', False)]
    passed_in_suite = 0
    failed_in_suite = 0

    print(f"\n--- Running {tf} ({len(funcs)} tests) ---")
    for fn in funcs:
        mp = MonkeyPatch()
        try:
            sig = inspect.signature(fn)
            kwargs = {}
            for param in sig.parameters:
                if param == 'monkeypatch':
                    kwargs['monkeypatch'] = mp
                elif param == 'tmp_path':
                    td = tempfile.mkdtemp()
                    kwargs['tmp_path'] = pathlib.Path(td)
                elif param == 'temp_store':
                    from src.learning.knowledge_store import KnowledgeStore
                    td = tempfile.mkdtemp()
                    kwargs['temp_store'] = KnowledgeStore(td)

            if asyncio.iscoroutinefunction(fn) or getattr(fn, '_is_async', False):
                asyncio.run(fn(**kwargs))
            else:
                fn(**kwargs)

            total_passed += 1
            passed_in_suite += 1
            print(f"  [PASS] {fn.__name__}")
        except Exception as e:
            total_failed += 1
            failed_in_suite += 1
            print(f"  [FAIL] {fn.__name__}: {e}")
            failed_tests.append((f"{tf}::{fn.__name__}", str(e)))
        finally:
            mp.undo()

    suite_results[tf] = f"{passed_in_suite} passed, {failed_in_suite} failed"

print("\n" + "=" * 60)
print(f"SUMMARY: Total Tests: {total_passed + total_failed} | Passed: {total_passed} | Failed: {total_failed}")
print("=" * 60)
for suite, res in suite_results.items():
    print(f"  {suite:<35}: {res}")

if failed_tests:
    print("\nFailed Tests:")
    for item in failed_tests:
        print(" ", item)
    sys.exit(1)
else:
    print("\nALL TEST SUITES PASSED CLEANLY!")
    sys.exit(0)
