"""
Browser Engine powered by Playwright.
Handles browser lifecycle, multi-tab concurrency limiting,
session context extraction, network monitoring, and DOM interaction.
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
try:
    from playwright.async_api import async_playwright, Playwright, Browser, BrowserContext, Page, Response
except ImportError:
    async_playwright = None
    Playwright = Any
    Browser = Any
    BrowserContext = Any
    Page = Any
    Response = Any

try:
    from ..core.network_profiles import (
        get_preseeded_domain_cookies,
        get_domain_specific_cookies,
        get_domain_specific_headers,
    )
except (ImportError, ValueError):
    from src.core.network_profiles import (
        get_preseeded_domain_cookies,
        get_domain_specific_cookies,
        get_domain_specific_headers,
    )

logger = logging.getLogger(__name__)


class BrowserEngine:
    """
    Manages Playwright browser instance, contexts, background tab pool,
    and network telemetry.
    """

    def __init__(
        self,
        headless: bool = True,
        max_concurrent_tabs: int = 3,
        user_agent: Optional[str] = None,
    ):
        self.headless = headless
        self.max_concurrent_tabs = max_concurrent_tabs
        self.semaphore = asyncio.Semaphore(max_concurrent_tabs)
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._main_page: Optional[Page] = None
        self.network_resources: List[Dict[str, Any]] = []
        self._is_started = False

    async def start(self):
        """Initializes Playwright browser and context."""
        if self._is_started:
            return

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        self._context = await self._browser.new_context(
            user_agent=self.user_agent,
            viewport={"width": 1440, "height": 900},
            ignore_https_errors=True,
        )

        # Pre-seed universal verification & consent cookies to prevent blocking on cloud datacenters (Render/AWS)
        default_cookies = get_preseeded_domain_cookies()
        try:
            await self._context.add_cookies(default_cookies)
        except Exception:
            pass

        self._main_page = await self._context.new_page()
        self._setup_network_interception(self._main_page)

        # Auto-close popup tabs / ad popunders (never close the main page!)
        def on_popup(popup_page: Page):
            if popup_page != self._main_page:
                logger.info(f"Auto-closing unexpected popup page: {popup_page.url}")
                asyncio.create_task(popup_page.close())
        self._context.on("page", on_popup)
        self._is_started = True

    def _setup_network_interception(self, page: Page):
        """Monitors network traffic for images, media, XHR, and Fetch."""
        async def on_response(response: Response):
            try:
                url = response.url
                status = response.status
                headers = response.headers
                content_type = headers.get("content-type", "").lower()
                resource_type = response.request.resource_type

                if (
                    resource_type in ("image", "media", "xhr", "fetch")
                    or "image/" in content_type
                    or "video/" in content_type
                    or "mpegurl" in content_type
                    or ".m3u8" in url.lower()
                    or any(ext in url.lower() for ext in (".mp4", ".webm", ".mov", ".m4v"))
                    or ("application/octet-stream" in content_type and (".mp4" in url or ".webm" in url))
                ):
                    self.network_resources.append({
                        "url": url,
                        "status": status,
                        "content_type": content_type,
                        "resource_type": resource_type,
                    })
                    # Keep memory bounded
                    if len(self.network_resources) > 300:
                        self.network_resources.pop(0)
            except Exception:
                pass

        page.on("response", on_response)

    async def close(self):
        """Shuts down browser and cleans up resources."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._is_started = False

    async def get_session_cookies(self) -> Dict[str, str]:
        """Returns active cookies from browser context as key-value pairs."""
        if not self._context:
            return {}
        try:
            cookies = await self._context.cookies()
            return {c["name"]: c["value"] for c in cookies}
        except Exception:
            return {}

    @property
    def main_page(self) -> Page:
        if not self._main_page:
            raise RuntimeError("BrowserEngine is not started. Call await start() first.")
        return self._main_page

    async def dismiss_age_gates_and_popups(self, page: Page):
        """Auto-dismisses verification modals, disclaimers, and inert blockers."""
        try:
            clicked = await page.evaluate("""() => {
                // 1. Generic modalGate unblock & class cleanup
                const yesBtn = document.getElementById('ageVerifYes') || document.querySelector('[id*="age"] button, [class*="age"] button, button[class*="verif"], [class*="gate"] button');
                if (yesBtn) {
                    try { yesBtn.click(); } catch (_) {}
                }
                if (window.EP && window.EP.footer && window.EP.footer.closeAgeVerif) {
                    try { window.EP.footer.closeAgeVerif(); } catch (_) {}
                }
                if (typeof createCookieAgeVer === 'function') {
                    try { createCookieAgeVer("ageverif_accepted", "T", 365); } catch (_) {}
                }
                if (window.EP && window.EP.ageVerif && window.EP.ageVerif.modalGate) {
                    try { window.EP.ageVerif.modalGate.unblock(); } catch (_) {}
                }
                document.documentElement.classList.remove('ageverifyimg');
                const ageCovers = document.querySelectorAll('#ageverify, #ageverify-cover, #ageverifybox, .age-verification, .modal-age, .agegate, #disclaimer, .disclaimer-overlay, [id*="age-verify"], [class*="age-gate"]');
                ageCovers.forEach(el => {
                    try {
                        el.style.display = 'none';
                        el.remove();
                    } catch (_) {}
                });

                // Remove inert attribute from children if set by age-gate
                if (document.body) {
                    Array.from(document.body.children).forEach(c => {
                        try { c.removeAttribute('inert'); } catch (_) {}
                    });
                }

                // 2. Click buttons/links INSIDE explicit verification or disclaimer overlays
                const modalBtns = Array.from(document.querySelectorAll(
                    '#ageverify button, #ageverify a, #ageverify-cover button, #ageverify-cover a, .agegate button, .agegate a, .disclaimer button, .disclaimer a, [id*="disclaimer"] button, [class*="disclaimer"] button'
                ));
                for (const el of modalBtns) {
                    try { el.click(); return true; } catch (_) {}
                }

                // 3. Fallback: Search for any button/link with confirmation text
                const allButtons = Array.from(document.querySelectorAll('button, a.btn, a[href*="age"], a[href*="verify"], a[href*="confirm"], .btn-agree, #btn-agree, input[type="submit"]'));
                for (const btn of allButtons) {
                    const txt = (btn.innerText || btn.textContent || btn.value || '').toLowerCase().trim();
                    if (txt.includes('i am 18') || txt.includes('over 18') || txt.includes('agree') || txt.includes('confirm') || txt.includes('enter') || txt.includes('yes') || txt.includes('continuar') || txt.includes('accept') || txt.includes('proceed') || txt.includes('18+')) {
                        try { btn.click(); return true; } catch (_) {}
                    }
                }
                return false;
            }""")
            if clicked:
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=3000)
                except Exception:
                    pass
                await asyncio.sleep(0.3)
        except Exception:
            pass

    async def navigate(self, url: str, wait_until: str = "domcontentloaded") -> bool:
        """Navigates main page to specified URL."""
        if not self._main_page:
            await self.start()

        # Seed domain-specific verification cookies across all subdomain combinations
        try:
            parsed = urlparse(url)
            netloc = parsed.netloc.lower()
            parts = netloc.split(".")
            base_d = ".".join(parts[-2:]) if len(parts) >= 2 else netloc
            cookies_to_add = []
            for d in {netloc, f".{netloc}", base_d, f".{base_d}"}:
                for c_name, c_val in [
                    ("ageverif_accepted", "T"),
                    ("age_verified", "1"),
                    ("over18", "1"),
                    ("disclaimer_accepted", "1"),
                    ("has_visited", "1"),
                ]:
                    cookies_to_add.append({"name": c_name, "value": c_val, "domain": d, "path": "/"})
            cookies_to_add.extend(get_domain_specific_cookies(netloc))
            await self._context.add_cookies(cookies_to_add)

            extra_headers = get_domain_specific_headers(url, netloc)
            if extra_headers:
                await self._main_page.set_extra_http_headers(extra_headers)
        except Exception:
            pass

        # Block ad networks and ad hijack redirects away from the target domain
        try:
            target_netloc = urlparse(url).netloc.lower().replace("www.", "")
            async def _filter_routes(route):
                try:
                    req = route.request
                    r_url = req.url.lower()
                    if any(ad in r_url for ad in ("exoclick", "trafficjunky", "popads", "juicyads", "tsyndicate", "ero-advertising")):
                        await route.abort()
                        return
                    if req.is_navigation_request():
                        req_netloc = urlparse(req.url).netloc.lower().replace("www.", "")
                        if req_netloc and target_netloc not in req_netloc and req_netloc not in target_netloc and not req.url.startswith("about:"):
                            logger.info(f"Blocking ad redirect from {target_netloc} to {req.url}")
                            await route.abort()
                            return
                    await route.continue_()
                except Exception:
                    try:
                        await route.continue_()
                    except Exception:
                        pass
            await self._context.route("**/*", _filter_routes)
        except Exception:
            pass

        try:
            await self.main_page.goto(url, wait_until=wait_until, timeout=25000)
            await asyncio.sleep(0.3)
            await self.dismiss_age_gates_and_popups(self.main_page)
            return True
        except Exception as e:
            logger.warning(f"Navigation error to {url}: {e}")
            return False

    async def scroll_page(self, distance: int = 600):
        """Scrolls page down by given distance."""
        if self._main_page:
            await self._main_page.evaluate(f"window.scrollBy(0, {distance});")
            await asyncio.sleep(0.2)

    async def wait_for_idle(self, timeout_ms: int = 3000):
        """Waits for network idle."""
        if self._main_page:
            try:
                await self._main_page.wait_for_load_state("networkidle", timeout=timeout_ms)
            except Exception:
                pass

    async def open_tab_and_inspect(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Opens link in a background page guarded by semaphore concurrency limiter,
        extracts detail page data, and closes the tab.
        """
        if not self._context:
            await self.start()

        async with self.semaphore:
            # Small randomized micro-delay
            await asyncio.sleep(0.05)
            page = await self._context.new_page()
            try:
                self._setup_network_interception(page)
                await page.goto(url, wait_until="domcontentloaded", timeout=18000)
                await asyncio.sleep(0.2)
                await self.dismiss_age_gates_and_popups(page)

                # Intermediate Gateway & Landing Page "Continue" Button Auto-Clicker
                try:
                    clicked = await page.evaluate("""() => {
                        const candidates = Array.from(document.querySelectorAll('input[type="submit"], button, a.btn, a.btn-continue, #btn_download, a'));
                        for (const el of candidates) {
                            const text = (el.innerText || el.value || '').toLowerCase().trim();
                            if (text.includes('continue to image') || text.includes('continue to video') || text === 'continue' || text === 'proceed' || text.includes('view full image') || text.includes('access image')) {
                                el.click();
                                return true;
                            }
                        }
                        return false;
                    }""")
                    if clicked:
                        await asyncio.sleep(0.4)
                except Exception:
                    pass

                # Extract detail page inspection snapshot
                detail_data = await page.evaluate("""() => {
                    const result = {
                        url: window.location.href,
                        title: document.title,
                        images: [],
                        json_states: [],
                        meta_images: []
                    };

                    // Check meta tags (og:image, twitter:image)
                    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(m => {
                        const content = m.getAttribute('content');
                        if (content) result.meta_images.push(content);
                    });

                    // Check JSON scripts (ld+json or window states)
                    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
                        try {
                            result.json_states.push(JSON.parse(s.textContent));
                        } catch (e) {}
                    });

                    // Check window.__INITIAL_STATE__
                    if (window.__INITIAL_STATE__) {
                        result.json_states.push(window.__INITIAL_STATE__);
                    }

                    // Find all images with details
                    document.querySelectorAll('img').forEach((img, idx) => {
                        const rect = img.getBoundingClientRect();
                        const dataset = {};
                        for (const k in img.dataset) {
                            dataset[k] = img.dataset[k];
                        }
                        result.images.push({
                            index: idx,
                            id: img.id || null,
                            className: img.className || '',
                            src: img.src || '',
                            currentSrc: img.currentSrc || '',
                            srcset: img.getAttribute('srcset') || '',
                            dataset: dataset,
                            width: rect.width || img.naturalWidth || 0,
                            height: rect.height || img.naturalHeight || 0,
                            parentTag: img.parentElement ? img.parentElement.tagName.toLowerCase() : null,
                            parentHref: img.parentElement && img.parentElement.tagName.toLowerCase() === 'a' ? img.parentElement.href : null
                        });
                    });

                    return result;
                }""")
                return detail_data
            except Exception as e:
                logger.warning(f"Error inspecting background tab {url}: {e}")
                return None
            finally:
                await page.close()
