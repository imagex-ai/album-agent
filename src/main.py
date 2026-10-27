"""
Main Entrypoint for AI-First Browser Agent.
Supports launching the web server or running CLI investigation on target URLs.
"""

import multiprocessing
import threading
import webview
import sys
import argparse
import asyncio
import socket
import uvicorn

if sys.platform == "win32":
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

from src.browser.engine import BrowserEngine
from src.browser.tools import BrowserTools
from src.validator.validator import ImageValidator
from src.investigator.investigator import OriginalImageInvestigator
from src.agent.brain import SemanticAgentBrain
from src.agent.llm_adapter import LLMAdapter
from src.observability.debugger import AgentDebugger
from src.server.server import app

def _get_local_ips() -> list[str]:
    """Returns local network IPv4 addresses for mobile access (e.g. iPhone on Wi-Fi)."""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary = s.getsockname()[0]
        s.close()
        if primary and primary != "127.0.0.1":
            ips.append(primary)
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127.") and not ip.startswith("169.254.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass

    return ips if ips else ["127.0.0.1"]


async def run_cli_investigation(
    url: str,
    headless: bool = True,
    llm_base: str = "http://localhost:11434/v1",
    model_name: str = "qwen2.5:32b",
):
    """Runs investigation on a single URL and prints structured report to console."""
    print(f"\n[AI-Agent] Starting investigation on: {url} (Model: {model_name})")
    engine = BrowserEngine(headless=headless, max_concurrent_tabs=3)
    await engine.start()

    try:
        tools = BrowserTools(engine=engine)
        validator = ImageValidator()
        investigator = OriginalImageInvestigator(tools=tools, validator=validator)
        llm = LLMAdapter(api_base=llm_base, model_name=model_name)
        await llm.check_availability()

        brain = SemanticAgentBrain(
            engine=engine,
            tools=tools,
            validator=validator,
            investigator=investigator,
            llm_adapter=llm,
        )

        album = await brain.run(url)
        report = AgentDebugger.format_console_report(album)
        print("\n" + report)
    finally:
        await engine.close()


def main():
    parser = argparse.ArgumentParser(description="AI-First Browser Agent for Album Discovery")
    parser.add_argument("url", nargs="?", help="Target album or gallery URL to investigate")
    parser.add_argument("--server", action="store_true", help="Launch FastAPI Web UI server")
    parser.add_argument("--no-window", action="store_true", help="Runs web server only, without opening desktop window")
    import os
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8100)), help="Port for web server (default 8100 or $PORT)")
    parser.add_argument("--host", type=str, default=os.environ.get("HOST", "0.0.0.0"), help="Host for web server (default 0.0.0.0)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload on code change")
    parser.add_argument("--headed", action="store_true", help="Run browser in visible headed mode")
    parser.add_argument("--model", type=str, default="qwen2.5:32b", help="Model name (default: qwen2.5:32b)")
    parser.add_argument("--llm-base", type=str, default="http://localhost:11434/v1", help="Local LLM API base URL")

    args = parser.parse_args()

    if args.server or not args.url:
        local_ips = _get_local_ips()
        print("\n" + "=" * 65)
        print(" AI-First Browser Agent Server Running")
        print(f" Computador Local: http://localhost:{args.port}")
        for ip in local_ips:
            print(f" iPhone / Wi-Fi:   http://{ip}:{args.port}")
        print(f" Default Model:    {args.model}")
        print(f" Mock Tests:       http://localhost:{args.port}/mock/gallery/album-1")
        print("=" * 65 + "\n")

        # Se pediu --server ou --no-window, roda diretamente no main thread com resiliência
        if args.server or getattr(args, 'no_window', False):
            import time
            while True:
                try:
                    uvicorn.run(app, host=args.host, port=args.port, loop="asyncio")
                    break
                except KeyboardInterrupt:
                    print("\nA encerrar servidor...")
                    break
                except Exception as e:
                    print(f"\n[Server] Reiniciando uvicorn após erro: {e}", flush=True)
                    time.sleep(1)
        else:
            server_thread = threading.Thread(
                target=uvicorn.run,
                args=(app,),
                kwargs={"host": args.host, "port": args.port, "loop": "asyncio"},
                daemon=True  # Fecha o servidor assim que a janela principal for fechada
            )
            server_thread.start()

            # Modo desktop nativo (PyWebView com API de tela cheia do monitor)
            class DesktopApi:
                def __init__(self):
                    self._is_fullscreen = False
                    self._saved_wp = None

                def _get_hwnd(self):
                    if sys.platform != "win32":
                        return None
                    try:
                        import ctypes
                        from ctypes import wintypes
                        import os

                        # 1. Tenta obter pelo window.native do pywebview (.ToInt64 ou .ToInt32)
                        if hasattr(webview, "windows") and webview.windows:
                            win = webview.windows[0]
                            if hasattr(win, "native") and win.native:
                                h = getattr(win.native, "Handle", None)
                                if h is not None:
                                    if hasattr(h, "ToInt64"):
                                        return h.ToInt64()
                                    elif hasattr(h, "ToInt32"):
                                        return h.ToInt32()
                                    else:
                                        return int(h)
                            if hasattr(win, "handle") and win.handle:
                                return int(win.handle)

                        # 2. Enumera as janelas visiveis pertencentes ao processo atual (100% resiliente)
                        pid = os.getpid()
                        found_hwnds = []
                        def _enum_proc(h_wnd, lparam):
                            if ctypes.windll.user32.IsWindowVisible(h_wnd):
                                wpid = wintypes.DWORD()
                                ctypes.windll.user32.GetWindowThreadProcessId(h_wnd, ctypes.byref(wpid))
                                if wpid.value == pid:
                                    found_hwnds.append(h_wnd)
                            return True
                        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
                        ctypes.windll.user32.EnumWindows(WNDENUMPROC(_enum_proc), 0)
                        if found_hwnds:
                            return found_hwnds[0]

                        # 3. Fallback por titulos conhecidos
                        for title in ["IMAGEX.AI", "Media Extractor", "Extrator de Mídia", "Extrator de Midia"]:
                            h = ctypes.windll.user32.FindWindowW(None, title)
                            if h:
                                return h
                    except Exception as e:
                        print(f"[DesktopApi] Erro ao obter HWND: {e}", flush=True)
                    return None

                def set_fullscreen(self, value: bool) -> bool:
                    target = bool(value)
                    try:
                        if sys.platform == "win32":
                            import ctypes
                            from ctypes import wintypes
                            user32 = ctypes.windll.user32
                            dwmapi = getattr(ctypes.windll, "dwmapi", None)

                            hwnd = self._get_hwnd()
                            if hwnd:
                                GWL_STYLE = -16
                                WS_CAPTION = 0x00C00000
                                WS_THICKFRAME = 0x00040000
                                WS_MINIMIZEBOX = 0x00020000
                                WS_MAXIMIZEBOX = 0x00010000
                                WS_SYSMENU = 0x00080000
                                WS_OVERLAPPEDWINDOW = (WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
                                SWP_FRAMECHANGED = 0x0020
                                SWP_NOOWNERZORDER = 0x0200
                                SWP_NOMOVE = 0x0002
                                SWP_NOSIZE = 0x0001
                                SWP_NOZORDER = 0x0004
                                HWND_TOP = 0

                                class WINDOWPLACEMENT(ctypes.Structure):
                                    _fields_ = [
                                        ("length", wintypes.UINT),
                                        ("flags", wintypes.UINT),
                                        ("showCmd", wintypes.UINT),
                                        ("ptMinPosition", wintypes.POINT),
                                        ("ptMaxPosition", wintypes.POINT),
                                        ("rcNormalPosition", wintypes.RECT)
                                    ]

                                class MONITORINFO(ctypes.Structure):
                                    _fields_ = [
                                        ("cbSize", wintypes.DWORD),
                                        ("rcMonitor", wintypes.RECT),
                                        ("rcWork", wintypes.RECT),
                                        ("dwFlags", wintypes.DWORD)
                                    ]

                                dwStyle = user32.GetWindowLongW(hwnd, GWL_STYLE)

                                if target and not self._is_fullscreen:
                                    wp = WINDOWPLACEMENT()
                                    wp.length = ctypes.sizeof(WINDOWPLACEMENT)
                                    mi = MONITORINFO()
                                    mi.cbSize = ctypes.sizeof(MONITORINFO)
                                    hMon = user32.MonitorFromWindow(hwnd, 2)

                                    if user32.GetWindowPlacement(hwnd, ctypes.byref(wp)) and user32.GetMonitorInfoW(hMon, ctypes.byref(mi)):
                                        self._saved_wp = wp

                                        # Desativa cantos arredondados e borda no DWM do Windows 11
                                        if dwmapi:
                                            try:
                                                corner_pref = ctypes.c_int(1) # DWMWCP_DONOTROUND
                                                dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner_pref), ctypes.sizeof(corner_pref))
                                                border_none = ctypes.c_uint32(0xFFFFFFFE) # DWMWA_COLOR_NONE
                                                dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(border_none), ctypes.sizeof(border_none))
                                            except Exception:
                                                pass

                                        # Remove WS_OVERLAPPEDWINDOW e expande cobrindo o monitor inteiro sem forçar WS_MAXIMIZE
                                        user32.SetWindowLongW(hwnd, GWL_STYLE, dwStyle & ~WS_OVERLAPPEDWINDOW)
                                        mx = mi.rcMonitor.left
                                        my = mi.rcMonitor.top
                                        mw = mi.rcMonitor.right - mi.rcMonitor.left
                                        mh = mi.rcMonitor.bottom - mi.rcMonitor.top
                                        user32.SetWindowPos(hwnd, HWND_TOP, mx, my, mw, mh, SWP_NOOWNERZORDER | SWP_FRAMECHANGED)
                                        self._is_fullscreen = True
                                        return True

                                elif not target and self._is_fullscreen:
                                    # Restaura decorações e estilo da janela
                                    user32.SetWindowLongW(hwnd, GWL_STYLE, dwStyle | WS_OVERLAPPEDWINDOW)

                                    # Restaura cantos arredondados padrão DWM do Windows 11
                                    if dwmapi:
                                        try:
                                            corner_pref = ctypes.c_int(0) # DWMWCP_DEFAULT
                                            dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner_pref), ctypes.sizeof(corner_pref))
                                            border_default = ctypes.c_uint32(0xFFFFFFFF) # DWMWA_COLOR_DEFAULT
                                            dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(border_default), ctypes.sizeof(border_default))
                                        except Exception:
                                            pass

                                    # Restaura o estado exato anterior da janela (se estava maximizada, volta maximizada; se estava normal, volta normal)
                                    if self._saved_wp:
                                        user32.SetWindowPlacement(hwnd, ctypes.byref(self._saved_wp))
                                    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED)
                                    self._is_fullscreen = False
                                    return True
                    except Exception as e:
                        print(f"[DesktopApi Win32] Erro na alternancia de janela: {e}", flush=True)

                    # Fallback com PyWebView direto
                    try:
                        if hasattr(webview, "windows") and webview.windows:
                            win = webview.windows[0]
                            if self._is_fullscreen != target:
                                if hasattr(win, "toggle_fullscreen"):
                                    win.toggle_fullscreen()
                                elif not target and hasattr(win, "restore"):
                                    win.restore()
                            self._is_fullscreen = target
                            return True
                    except Exception as e:
                        print(f"[DesktopApi Fallback] Erro: {e}", flush=True)

                    self._is_fullscreen = target
                    return False

                def toggle_fullscreen(self) -> bool:
                    return self.set_fullscreen(not self._is_fullscreen)

                def restore_window(self) -> bool:
                    return self.set_fullscreen(False)

                def is_fullscreen(self) -> bool:
                    return self._is_fullscreen

            desktop_api = DesktopApi()

            # Aguarda o servidor FastAPI uvicorn inicializar e escutar na porta antes de renderizar o WebView
            import time
            start_wait = time.time()
            while time.time() - start_wait < 15:
                try:
                    with socket.create_connection(("127.0.0.1", args.port), timeout=0.3):
                        break
                except (ConnectionRefusedError, OSError):
                    time.sleep(0.15)

            webview.create_window(
                title="IMAGEX.AI - Media Extractor",
                url=f"http://127.0.0.1:{args.port}",
                width=1280,
                height=800,
                resizable=True,
                background_color='#000000',
                js_api=desktop_api
            )
            webview.start()
    else:
        asyncio.run(run_cli_investigation(
            url=args.url,
            headless=not args.headed,
            llm_base=args.llm_base,
            model_name=args.model,
        ))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
