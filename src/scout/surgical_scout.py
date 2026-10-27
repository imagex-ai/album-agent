"""
Gemini Surgical Scout Engine.
High-speed HTTP DOM filtering, Physical X-Ray binary verification,
intermediate gateway form resolution, and Google Gemini AI host-rule deduction.
"""

import os
import re
import time
import json
import struct
import logging
import asyncio
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Set, Callable
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None

from ..core.models import Album, AlbumImage, ResolutionMethod, TelemetryMetrics
from ..core.media_classification import image_header_facts, media_source_format
from ..core.network_profiles import get_preseeded_session_cookies, is_static_preview_upgradeable, _b64d
from .knowledge_bridge import ScoutKnowledgeBridge, extract_base_domain

logger = logging.getLogger("gemini_surgical_scout")
load_dotenv()

# Junk keywords for avatars, ads, smilies, social sharing, and compliance banners
JUNK_PATTERNS = [
    "avatar", "signature", "smilie", "smilies", "emoji", "icon", "logo",
    "banner", "button", "pixel", "tracker", "adserver", "rating", "clear.gif",
    "facebook", "twitter", "reddit", "whatsapp", "telegram", "share", "flag", "flags", "lang",
    "rta.gif", "parentalcontrol", "compliance", "rtalabel", "asacp", "rta-validated",
    "_190x152", "thumbs/static", "site_loading.gif"
]

DEFAULT_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_CONCURRENT_WORKERS = 5


def create_worker_session() -> requests.Session:
    """Creates an isolated session with full browser headers to avoid blocks."""
    session = requests.Session()
    default_cookies = get_preseeded_session_cookies()
    cookie_str = "; ".join(f"{k}={v}" for k, v in default_cookies.items())
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Cookie": cookie_str
    })
    for k, v in default_cookies.items():
        session.cookies.set(k, v)
    return session


# Thread-safe URL metadata cache to capture genuine file sizes and headers
_URL_METADATA_CACHE: Dict[str, Dict[str, Any]] = {}


def get_canonical_media_key(url: str) -> str:
    """
    Normaliza a chave de identificação de mídia para evitar duplicatas entre miniaturas e imagens originais.
    Ex: '.../43554714-img-0900_296x1000.jpg' e '.../43554714-img-0900.jpg' geram a mesma chave '43554714-img-0900'.
    """
    if not url:
        return ""
    clean = url.split("?")[0].split("#")[0].strip()
    filename = clean.split("/")[-1]
    name_no_ext = re.sub(r'\.[a-zA-Z0-9]+$', '', filename)
    # Remove sufixos de resolução e tags de thumbnail
    canonical = re.sub(
        r'(_\d+x\d+|_thumb\b|-thumb\b|\.thumb\b|thumb_|_small\b|-small\b|_240\b|_360\b|_480\b|_720\b|_190x152\b|_medium\b|-medium\b|_preview\b|-preview\b)',
        '',
        name_no_ext,
        flags=re.I
    )
    return canonical.strip().lower()


def parse_image_dimensions(chunk: bytes) -> tuple:
    """Extracts width and height from initial binary bytes without decoding full image."""
    if not chunk:
        return None, None
    try:
        # PNG: Header 8 bytes, IHDR chunk at 12: width 16..20, height 20..24
        if chunk.startswith(b'\x89PNG\r\n\x1a\n') and len(chunk) >= 24:
            w, h = struct.unpack('>II', chunk[16:24])
            return w, h
        # GIF: width 6..8, height 8..10
        if chunk.startswith((b'GIF87a', b'GIF89a')) and len(chunk) >= 10:
            w, h = struct.unpack('<HH', chunk[6:10])
            return w, h
        # JPEG: Scan for SOF markers (SOF0=0xC0, SOF1=0xC1, SOF2=0xC2, etc.)
        if chunk.startswith(b'\xff\xd8'):
            idx = 2
            length = len(chunk)
            while idx < length - 8:
                if chunk[idx] != 0xff:
                    idx += 1
                    continue
                marker = chunk[idx + 1]
                if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                    h, w = struct.unpack('>HH', chunk[idx + 5:idx + 9])
                    return w, h
                if idx + 4 > length:
                    break
                seg_len = struct.unpack('>H', chunk[idx + 2:idx + 4])[0]
                idx += 2 + seg_len
    except Exception:
        pass
    return None, None


def get_true_image_url(url: str, session: requests.Session, referer: str) -> Optional[str]:
    """PHYSICAL X-RAY: Downloads the first bytes to prove it's a real image and captures redirects, dimensions and real file size."""
    if not url:
        return None
    try:
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/") or not url.startswith("http"):
            url = urljoin(referer, url)

        headers = {"Referer": referer, "Accept": "image/*"}
        with session.get(url, headers=headers, stream=True, timeout=8) as res:
            if res.status_code == 200:
                content_type = res.headers.get("Content-Type", "").lower()

                # If server returns text/html, reject it
                if "text/html" in content_type:
                    return None

                content_length = res.headers.get("Content-Length")
                file_sz = int(content_length) if content_length and content_length.isdigit() and int(content_length) > 0 else None

                # Read first 4096 bytes to check file DNA and capture real width/height
                chunk = res.raw.read(4096)
                if not chunk:
                    return None

                # Rejeita payloads anômalos de erro HTTP ou bloqueio de hotlink (< 20KB)
                chunk_lower = chunk.lower()
                if (file_sz and file_sz < 20000) or len(chunk) < 20000:
                    generic_block_signatures = (
                        b"hotlink", b"hot-link", b"hotlinking",
                        b"access denied", b"forbidden", b"unauthorized",
                        b"embed image", b"direct linking", b"bandwidth limit"
                    )
                    if any(sig in chunk_lower for sig in generic_block_signatures):
                        logger.warning(f"[SurgicalScout] Bloqueio ou aviso de hotlink detectado em {url} (size={file_sz}). Rejeitando falso positivo.")
                        return None

                is_jpeg = chunk.startswith(b'\xff\xd8\xff')
                is_png = chunk.startswith(b'\x89PNG')
                is_gif = chunk.startswith(b'GIF8')
                is_webp = b'WEBP' in chunk
                is_jfif = b'JFIF' in chunk
                is_exif = b'Exif' in chunk

                if is_jpeg or is_png or is_gif or is_webp or is_jfif or is_exif or ("image/" in content_type and len(chunk) > 5):
                    final_url = str(res.url)
                    img_w, img_h = parse_image_dimensions(chunk)
                    meta_dict: Dict[str, Any] = {"file_size": file_sz}
                    meta_dict.update(image_header_facts(chunk, complete=file_sz == len(chunk)))
                    if is_gif:
                        meta_dict.setdefault("format", "gif")
                        meta_dict.setdefault("is_animated", True)
                    elif is_webp:
                        meta_dict.setdefault("format", "webp")
                    if img_w and img_h:
                        meta_dict["width"] = img_w
                        meta_dict["height"] = img_h
                    _URL_METADATA_CACHE[final_url] = meta_dict
                    _URL_METADATA_CACHE[url] = meta_dict
                    return final_url
    except Exception:
        pass
    return None


def resolve_gateway_intermediate_form(viewer_url: str, session: requests.Session, referer: str) -> Optional[str]:
    """Handles intermediate forms for gateway viewers (GET -> POST Form -> CDN Image)."""
    try:
        r1 = session.get(viewer_url, headers={"Referer": referer}, timeout=12)
        if r1.status_code != 200:
            return None

        soup1 = BeautifulSoup(r1.text, "html.parser")
        form = soup1.find("form")
        if form:
            action = form.get("action") or viewer_url
            action_url = urljoin(viewer_url, action)

            payload = {}
            for inp in form.find_all("input"):
                name = inp.get("name")
                val = inp.get("value", "")
                if name:
                    payload[name] = val

            if "imgContinue" not in payload:
                btn = form.find("input", {"id": "continuebutton"}) or form.find("input", {"type": "submit"})
                if btn:
                    payload[btn.get("name", "imgContinue")] = btn.get("value", "Continue to image ... ")

            parsed_viewer = urlparse(viewer_url)
            origin_hdr = f"{parsed_viewer.scheme}://{parsed_viewer.netloc}"
            r2 = session.post(action_url, data=payload, headers={"Referer": viewer_url, "Origin": origin_hdr}, timeout=12)
            if r2.status_code == 200:
                soup2 = BeautifulSoup(r2.text, "html.parser")
                img = (
                    soup2.select_one("img.centred") or
                    soup2.select_one("img.centred_element") or
                    soup2.select_one("img.img-responsive") or
                    soup2.select_one("img#show_image") or
                    soup2.select_one("img#image") or
                    soup2.select_one("div#image-container img")
                )
                if img:
                    raw_src = img.get("src") or img.get("data-src") or img.get("data-original")
                    if raw_src:
                        raw_src = str(raw_src).strip()
                        return "https:" + raw_src if raw_src.startswith("//") else urljoin(viewer_url, raw_src)

        for img in soup1.find_all("img"):
            src = img.get("src") or img.get("data-src")
            if src and not any(j in str(src).lower() for j in JUNK_PATTERNS):
                if re.search(r"\.(jpg|jpeg|png|webp)(\?.*)?$", str(src), re.I):
                    return "https:" + str(src) if str(src).startswith("//") else urljoin(viewer_url, str(src))
    except Exception:
        pass
    return None


def resolve_adaptive_subpage(viewer_url: str, session: requests.Session, referer: str) -> Optional[str]:
    """
    RESOLVEDOR ADAPTATIVO UNIVERSAL (Estrutural/Determinístico):
    Lida com formulários intermediários (POST) e visualizadores dinâmicos de QUALQUER site sem regras fixas.
    """
    try:
        r1 = session.get(viewer_url, headers={"Referer": referer}, timeout=12)
        if r1.status_code != 200:
            return None

        soup = BeautifulSoup(r1.text, "html.parser")
        parsed = urlparse(viewer_url)
        origin_domain = f"{parsed.scheme}://{parsed.netloc}"

        # 1. Se a página tiver um formulário intermediário (splash page, token, botão continue)
        form = soup.find("form")
        if form:
            action = form.get("action") or viewer_url
            action_url = urljoin(viewer_url, action)
            
            payload = {}
            for inp in form.find_all("input"):
                name = inp.get("name")
                val = inp.get("value", "")
                if name:
                    payload[name] = val

            # Captura qualquer botão de submit/continue/view
            btn = (
                form.find("input", {"type": "submit"}) or 
                form.find("button", {"type": "submit"}) or
                form.find("input", {"id": re.compile(r"continue|submit|btn|image|show", re.I)}) or
                form.find("button", {"id": re.compile(r"continue|submit|btn|image|show", re.I)})
            )
            if btn and btn.get("name"):
                payload[btn["name"]] = btn.get("value", "Continue")

            # Dispara POST adaptativo
            try:
                r2 = session.post(
                    action_url, 
                    data=payload, 
                    headers={"Referer": viewer_url, "Origin": origin_domain}, 
                    timeout=12
                )
                if r2.status_code == 200:
                    soup = BeautifulSoup(r2.text, "html.parser")
            except Exception:
                pass

        # 2. Varredura adaptativa de imagens no HTML resultante
        # A) Seletores comuns de containers e elementos centrais
        for sel in [
            "img.centred", "img.centred_element", "img#show_image", "img#image", 
            "img.main-image", "img.pic", "img.img-responsive", "div#image-container img",
            "div.image-viewer img", "div.pic-container img", "div.image-box img",
            "img#photo_img", "div.photo-box img", "div#photo img", "div.photo-container img"
        ]:
            highlight_img = soup.select_one(sel)
            if highlight_img:
                src = highlight_img.get("src") or highlight_img.get("data-src") or highlight_img.get("data-original")
                if src:
                    candidate = "https:" + str(src) if str(src).startswith("//") else urljoin(viewer_url, str(src))
                    verified = get_true_image_url(candidate, session, viewer_url)
                    if verified:
                        return verified

        # B) Varredura em nós <noscript>
        for noscript in soup.find_all("noscript"):
            ns_soup = BeautifulSoup(noscript.text, "html.parser")
            for img in ns_soup.find_all("img"):
                src = img.get("src") or img.get("data-src")
                if src and not any(j in str(src).lower() for j in JUNK_PATTERNS):
                    candidate = "https:" + str(src) if str(src).startswith("//") else urljoin(viewer_url, str(src))
                    verified = get_true_image_url(candidate, session, viewer_url)
                    if verified:
                        return verified

        # C) Varredura de tags <img> gerais
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-original")
            if src and not any(j in str(src).lower() for j in JUNK_PATTERNS):
                if re.search(r"\.(jpg|jpeg|png|webp)(\?.*)?$", str(src), re.I) or "images" in str(src) or "upload" in str(src):
                    candidate = "https:" + str(src) if str(src).startswith("//") else urljoin(viewer_url, str(src))
                    verified = get_true_image_url(candidate, session, viewer_url)
                    if verified:
                        return verified

    except Exception:
        pass
    return None


class GeminiSurgicalScout:
    """
    Engine 1: Gemini Surgical Scout.
    Performs lightning-fast DOM filtering, Physical X-Ray binary validation,
    intermediate form bypassing, and Gemini subpage CSS learning.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", DEFAULT_GEMINI_KEY)
        self.client = genai.Client(api_key=self.api_key) if (genai and self.api_key) else None
        self.bridge = ScoutKnowledgeBridge()
        self.domain_rule_cache: Dict[str, Dict[str, str]] = {}
        self.learning_lock = threading.Lock()
        self.is_cancelled = False

    def cancel(self):
        self.is_cancelled = True

    @staticmethod
    def find_media_links(page_url: str, raw_html: str) -> List[Dict[str, Any]]:
        """
        Stage 1: Maps the main page DOM, isolates post container, and extracts genuine media links.
        """
        soup = BeautifulSoup(raw_html, "html.parser")
        items = []
        seen_urls = set()

        post_container = (
            soup.select_one("div.photosgrid") or
            soup.select_one("div.gallerygrid") or
            soup.select_one("div#photos") or
            soup.select_one("div.photos") or
            soup.select_one("div.gallery-content") or
            soup.select_one("div[id^='post_message_']") or
            soup.select_one("blockquote.postcontent") or
            soup.select_one("div.postbody") or
            soup.select_one("div.post-content") or
            soup.select_one("div.entry-content") or
            soup.select_one("article") or
            soup.select_one("div#posts") or
            soup.select_one("main") or
            soup
        )

        for a in post_container.find_all("a", href=True):
            raw_href = a["href"].strip()
            if not raw_href or raw_href.startswith(("#", "javascript:", "mailto:")):
                continue

            # Converte links relativos (/photo/...) para URLs absolutas completas
            href = urljoin(page_url, raw_href)
            href_lower = href.lower()

            if any(bad in href_lower for bad in ("/performer/", "/model/", "/profile/", "/cat/", "/search/", "/channels/", "/tags/", "/user/")):
                continue

            if any(junk in href_lower for junk in JUNK_PATTERNS):
                continue

            # Filtra links de galerias laterais/relacionadas
            if "/gallery/" in href_lower and "/gallery/" not in page_url.lower():
                continue
            if "/gallery/" in href_lower and "/gallery/" in page_url.lower():
                parsed_page = urlparse(page_url)
                parsed_href = urlparse(href)
                if parsed_page.netloc == parsed_href.netloc:
                    page_path_parts = [p for p in parsed_page.path.split('/') if p]
                    href_path_parts = [p for p in parsed_href.path.split('/') if p]
                    if len(page_path_parts) >= 2 and len(href_path_parts) >= 2:
                        if page_path_parts[0] == 'gallery' and href_path_parts[0] == 'gallery':
                            if page_path_parts[1] != href_path_parts[1]:
                                continue

            img = a.find("img")
            thumb_src = None
            alt_text = ""

            if img:
                raw_s = img.get("src") or ""
                data_s = img.get("data-src") or img.get("data-original") or img.get("data-lazy") or ""
                if not raw_s or "data:image" in raw_s or "1x1" in raw_s or "blank" in raw_s:
                    raw_thumb = data_s
                else:
                    raw_thumb = raw_s or data_s
                if any(junk in str(raw_thumb).lower() for junk in JUNK_PATTERNS) or "/flags/" in str(raw_thumb).lower():
                    continue
                if raw_thumb:
                    thumb_src = "https:" + raw_thumb if str(raw_thumb).startswith("//") else urljoin(page_url, str(raw_thumb).strip())
                alt_text = img.get("alt", "").strip()

            if "logo" in href_lower or href_lower.endswith(".svg") or href.strip("/") == page_url.strip("/"):
                continue

            is_direct_ext = bool(re.search(r"\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$", href, re.I))
            is_photo_subpage = any(pattern in href_lower for pattern in [
                "/photo/", "/image/", "/view/", "/pic/", "/show/", "/viewer/", "/gallery/", "/i/", "/p/"
            ]) or bool(re.search(r"/[a-zA-Z0-9_-]{6,}\.(html?)$", href_lower))

            if (is_direct_ext or is_photo_subpage or img) and href not in seen_urls:
                seen_urls.add(href)
                items.append({
                    "target_url": href,
                    "thumbnail_url": thumb_src if thumb_src else None,
                    "alt_text": alt_text or a.get_text(strip=True)
                })

        # Fallback: if no <a> tags found, extract loose <img> in post container
        if not items:
            for img in post_container.find_all("img"):
                raw_src = img.get("src") or img.get("data-src") or img.get("data-original")
                if not raw_src or any(junk in str(raw_src).lower() for junk in JUNK_PATTERNS):
                    continue
                src = "https:" + str(raw_src).strip() if str(raw_src).startswith("//") else urljoin(page_url, str(raw_src).strip())
                if src not in seen_urls:
                    seen_urls.add(src)
                    items.append({
                        "target_url": src,
                        "thumbnail_url": src,
                        "alt_text": img.get("alt", "").strip()
                    })

        return items

    def learn_domain_rule_sync(
        self,
        viewer_url: str,
        viewer_html: str,
        model_name: str = "gemini-3.7-flash"
    ) -> Optional[Dict[str, str]]:
        """
        Uses Gemini to audit external host subpage and deduce the exact CSS selector.
        """
        if not self.client:
            return None

        soup = BeautifulSoup(viewer_html, "html.parser")
        candidates = []
        for tag in soup.find_all(["img", "a"])[:20]:
            tag_str = str(tag)
            if not any(j in tag_str.lower() for j in JUNK_PATTERNS):
                candidates.append(tag_str)

        sample_html = "\n".join(candidates)

        prompt = f"""
Analise o HTML do visualizador de imagem em '{viewer_url}'.

SUA TAREFA:
Identifique a regra exata (seletor CSS e atributo) para capturar a imagem principal em alta resolução.
Ignore avatares, logotipos e anúncios.

Retorne ESTRITAMENTE um JSON no formato:
{{
  "css_selector": "seletor CSS exato da tag img (ex: 'img#show_image', 'img.centered-element', 'img.main-image')",
  "target_attr": "src ou data-src ou data-original"
}}

HTML DA AMOSTRA:
{sample_html}
"""
        try:
            response = self.client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json") if genai else None
            )
            raw_text = response.text or "{}"
            data = json.loads(raw_text)
            if data.get("css_selector"):
                return {
                    "css_selector": data["css_selector"],
                    "target_attr": data.get("target_attr", "src")
                }
        except Exception as e:
            logger.error(f"Gemini host rule learning failed for {viewer_url}: {e}")

        return None

    def resolve_single_item(
        self,
        item: Dict[str, Any],
        source_page: str,
        gemini_model: str = "gemini-3.7-flash",
        on_rule_learned: Optional[Callable] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Processes a single item with Physical X-Ray binary confirmation, gateway form bypass, and Gemini fallback.
        """
        if self.is_cancelled:
            return None

        target_url = item.get("target_url")
        thumb_url = item.get("thumbnail_url")
        if not target_url:
            return None

        # Garante que target_url e thumbnail_url sejam absolutos com esquema completo
        if target_url.startswith("//"):
            target_url = "https:" + target_url
        elif target_url.startswith("/") or not target_url.startswith("http"):
            target_url = urljoin(source_page, target_url)

        if thumb_url:
            if thumb_url.startswith("//"):
                thumb_url = "https:" + thumb_url
            elif thumb_url.startswith("/") or not thumb_url.startswith("http"):
                thumb_url = urljoin(source_page, thumb_url)
            item["thumbnail_url"] = thumb_url

        item["target_url"] = target_url

        domain = extract_base_domain(target_url)
        session = create_worker_session()
        direct_binary = None

        # 0. Fast Host Rule Cache Check (Passo 0: 0ms para domínios já aprendidos)
        rule = self.domain_rule_cache.get(domain)
        if rule and not direct_binary:
            strat = rule.get("strategy", "")
            if strat == "url_replace" and rule.get("pattern_find"):
                candidate_src = thumb_url or target_url
                if candidate_src:
                    try:
                        p_find = rule["pattern_find"]
                        p_replace = rule.get("pattern_replace", "")
                        direct_url = re.sub(p_find, p_replace, candidate_src)
                        if direct_url != candidate_src:
                            verified_candidate = get_true_image_url(direct_url, session, source_page)
                            if verified_candidate:
                                direct_binary = verified_candidate
                    except Exception:
                        pass
            elif strat == "direct":
                verified_candidate = get_true_image_url(target_url, session, source_page)
                if verified_candidate:
                    direct_binary = verified_candidate
            elif strat == "subpage_scrape" and (rule.get("container_selector") or rule.get("css_selector")):
                selector = rule.get("container_selector") or rule.get("css_selector")
                attr = rule.get("target_attr", "src")
                try:
                    res = session.get(target_url, headers={"Referer": source_page}, timeout=6)
                    if res.status_code == 200:
                        soup = BeautifulSoup(res.text, "html.parser")
                        img_tag = soup.select_one(selector)
                        if img_tag:
                            raw_src = img_tag.get(attr)
                            if raw_src:
                                candidate = "https:" + raw_src if str(raw_src).startswith("//") else urljoin(target_url, str(raw_src))
                                verified_candidate = get_true_image_url(candidate, session, target_url)
                                if verified_candidate:
                                    direct_binary = verified_candidate
                except Exception:
                    pass

        # 1. Fast-track: thumbnail size pattern deduction (e.g. ..._296x1000.jpg -> ...jpg, .gif -> full .gif / .webp)
        if not direct_binary and thumb_url:
            # If thumbnail has dimension suffix (e.g. _296x1000.gif, _296x1000.jpg, 13_240.jpg), test original full-res .gif first
            m_dim = re.search(r'_\d+x\d+\.([a-zA-Z0-9]+)(\?.*)?$', thumb_url, re.I)
            if m_dim:
                ext_found = m_dim.group(1).lower()
                base_cand = re.sub(r'_\d+x\d+\.[a-zA-Z0-9]+(\?.*)?$', '', thumb_url, flags=re.I)
                # Try high-res .gif first if thumbnail is gif or jpg/webp on gallery sites
                test_extensions = ['.gif', '.webp', f'.{ext_found}'] if ext_found in ('gif', 'jpg', 'jpeg', 'webp') else [f'.{ext_found}']
                for test_ext in test_extensions:
                    cand_url = f"{base_cand}{test_ext}"
                    verified = get_true_image_url(cand_url, session, source_page)
                    if verified:
                        direct_binary = verified
                        break

            if not direct_binary:
                cleaned_thumb = re.sub(r'_\d+x\d+\.(jpg|jpeg|png|webp|gif)(\?.*)?$', r'.\1', thumb_url, flags=re.I)
                if cleaned_thumb != thumb_url:
                    verified_candidate = get_true_image_url(cleaned_thumb, session, source_page)
                    if verified_candidate:
                        direct_binary = verified_candidate

        # 2. Test initial link with Physical X-Ray
        if not direct_binary:
            verified_url = get_true_image_url(target_url, session, source_page)
            if verified_url:
                direct_binary = verified_url

        # 2. Intermediate gateway form bypass
        if not direct_binary and (_b64d("aW14LnRv") in domain or "gateway" in domain or "viewer" in domain):
            candidate = resolve_gateway_intermediate_form(target_url, session, source_page)
            if candidate:
                verified_candidate = get_true_image_url(candidate, session, source_page)
                if verified_candidate:
                    direct_binary = verified_candidate

        # 3. Standard subpage heuristic extraction (Gateway viewers, Content CDNs, etc.)
        elif not direct_binary:
            try:
                res = session.get(target_url, headers={"Referer": source_page}, timeout=10)
                if res.status_code == 200:
                    soup = BeautifulSoup(res.text, "html.parser")
                    img = (
                        soup.select_one("img#show_image") or
                        soup.select_one("img.main-image") or
                        soup.select_one("img.centred") or
                        soup.select_one("img.centred_element") or
                        soup.select_one("img#image") or
                        soup.select_one("img.image-img") or
                        soup.select_one("img#photo_img") or
                        soup.select_one("div.photo-box img") or
                        soup.select_one("div#photo img") or
                        soup.select_one("div.photo-container img") or
                        soup.select_one("img.pic") or
                        soup.select_one("div#image-container img")
                    )
                    if img:
                        src = img.get("src") or img.get("data-src") or img.get("data-original")
                        if src:
                            src = str(src).strip()
                            candidate = "https:" + src if src.startswith("//") else urljoin(target_url, src)
                            verified_candidate = get_true_image_url(candidate, session, target_url)
                            if verified_candidate:
                                direct_binary = verified_candidate

                    if not direct_binary:
                        for tag in soup.find_all("img"):
                            src = tag.get("src") or tag.get("data-src")
                            if src and not any(j in str(src).lower() for j in JUNK_PATTERNS):
                                if re.search(r"\.(jpg|jpeg|png|webp)(\?.*)?$", str(src), re.I):
                                    candidate = "https:" + str(src) if str(src).startswith("//") else urljoin(target_url, str(src))
                                    verified_candidate = get_true_image_url(candidate, session, target_url)
                                    if verified_candidate:
                                        direct_binary = verified_candidate
                                        break

                    # 4. Resolvedor Adaptativo Universal (resolve qualquer outro host com form/splash sem gastar IA)
                    if not direct_binary:
                        candidate = resolve_adaptive_subpage(target_url, session, source_page)
                        if candidate:
                            direct_binary = candidate

                    # 5. Universal Gemini AI Fallback (último recurso se tudo falhar)
                    if not direct_binary:
                        with self.learning_lock:
                            if domain not in self.domain_rule_cache:
                                learned = self.learn_domain_rule_sync(target_url, res.text, model_name=gemini_model)
                                if learned:
                                    self.domain_rule_cache[domain] = learned
                                    self.bridge.save_host_rule(domain, learned)
                                    self.bridge.sync_scout_rule_to_qwen(domain, learned.get("css_selector", ""), learned.get("target_attr", "src"))
                                    if on_rule_learned:
                                        on_rule_learned(domain, learned)
                        rule = self.domain_rule_cache.get(domain)

                        if rule:
                            css = rule.get("css_selector") or rule.get("container_selector")
                            if css:
                                img_tag = soup.select_one(css)
                                if img_tag:
                                    raw_src = img_tag.get(rule.get("target_attr", "src"))
                                    if raw_src:
                                        raw_src = str(raw_src).strip()
                                        candidate = "https:" + raw_src if raw_src.startswith("//") else urljoin(target_url, raw_src)
                                        verified_candidate = get_true_image_url(candidate, session, target_url)
                                        if verified_candidate:
                                            direct_binary = verified_candidate
            except Exception:
                pass

        if direct_binary:
            meta = _URL_METADATA_CACHE.get(direct_binary) or _URL_METADATA_CACHE.get(target_url) or {}
            return {
                "host": domain,
                "original_url": direct_binary,
                "thumbnail_url": thumb_url or direct_binary,
                "file_size": meta.get("file_size"),
                "width": meta.get("width") or 0,
                "height": meta.get("height") or 0,
                "format": meta.get("format"),
                "is_animated": meta.get("is_animated", False),
                "animation_checked": meta.get("animation_checked", False),
                "provenance_chain": {
                    "source_page": source_page,
                    "viewer_page": target_url,
                    "cdn_endpoint": direct_binary
                },
                "contextual_data": {
                    "alt_text": item.get("alt_text", "")
                },
                "verified_binary": True
            }
        return None

    async def extract_album(
        self,
        url: str,
        gemini_model: str = "gemini-3.7-flash",
        local_model: str = "qwen2.5:32b",
        on_event: Optional[Callable[[Dict[str, Any]], Any]] = None,
    ) -> Album:
        """
        Runs parallel Surgical Scout extraction with Physical X-Ray binary validation and SSE events.
        """
        self.is_cancelled = False
        start_time = time.time()
        domain = extract_base_domain(url)

        async def emit(event_data: Dict[str, Any]):
            if on_event:
                if asyncio.iscoroutinefunction(on_event):
                    await on_event(event_data)
                else:
                    on_event(event_data)

        # Seed cached host rules
        cached_rules = self.bridge.load_host_rules()
        self.domain_rule_cache.update(cached_rules)

        # Refresh API key dynamically in case user saved it in Settings
        current_key = os.getenv("GEMINI_API_KEY", "").strip()
        if current_key and (not self.client or self.api_key != current_key):
            self.api_key = current_key
            if genai:
                try:
                    self.client = genai.Client(api_key=self.api_key)
                except Exception:
                    pass

        has_gemini = bool(self.client and self.api_key)

        await emit({
            "type": "status",
            "message": f"Accessing gallery via HTTP: {url}",
        })
        if has_gemini:
            await emit({
                "type": "ai_thought",
                "stage": "OBSERVATION",
                "thought": f" [Gemini Surgical Scout] Connected to Gemini Cloud ({gemini_model}) + Physical Binary Analysis on {domain}",
            })
        else:
            await emit({
                "type": "ai_thought",
                "stage": "OBSERVATION",
                "thought": f"️ [Surgical Scout] Gemini Cloud not configured. Operating with Deterministic Heuristic Engine + Physical Analysis (100% local) on {domain}",
            })

        main_session = create_worker_session()
        # For platforms with strict datacenter age gating, use search crawler indexing identity
        if is_static_preview_upgradeable(url):
            main_session.headers["User-Agent"] = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"

        try:
            parsed = urlparse(url)
            netloc = parsed.netloc.lower()
            parts = netloc.split(".")
            base_d = ".".join(parts[-2:]) if len(parts) >= 2 else netloc
            for d in {netloc, f".{netloc}", base_d, f".{base_d}"}:
                main_session.cookies.set("ageverif_accepted", "T", domain=d)
                main_session.cookies.set("age_verified", "1", domain=d)
                main_session.cookies.set("has_visited", "1", domain=d)
                main_session.cookies.set("disclaimer_accepted", "1", domain=d)
                main_session.cookies.set("over18", "1", domain=d)
        except Exception:
            pass
        loop = asyncio.get_running_loop()

        raw_html = ""
        try:
            res = await loop.run_in_executor(None, lambda: main_session.get(url, timeout=20))
            if res.status_code == 200:
                raw_html = res.text
            else:
                logger.warning(f"Initial requests.get returned HTTP {res.status_code} for {url}, attempting headless browser bypass")
        except Exception as net_err:
            logger.warning(f"Initial requests.get failed ({net_err}) for {url}, attempting headless browser bypass")

        if not raw_html:
            try:
                from playwright.async_api import async_playwright
                async with async_playwright() as p:
                    b = await p.chromium.launch(headless=True)
                    page = await b.new_page(
                        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    )
                    await page.goto(url, wait_until="domcontentloaded", timeout=35000)
                    raw_html = await page.content()
                    await b.close()
            except Exception as b_err:
                logger.error(f"Playwright fallback also failed for {url}: {b_err}")
                await emit({"type": "error", "error": f"Connection failed to {url}: {b_err}"})
                raise Exception(f"Falha ao carregar galeria {url}: {b_err}")

        soup = BeautifulSoup(raw_html, "html.parser")
        raw_title = soup.title.get_text(strip=True) if soup.title else f"Galeria {domain}"
        page_title = re.sub(r'(?i)\s*[-|•–]\s*(?:[a-zA-Z0-9-]+\.(?:com|net|org|tv|me|cc|video|site|club|xyz|to)).*$', '', raw_title).strip()

        # Stage 1: Filter media links
        gallery_items = self.find_media_links(url, raw_html)

        # Check if HTTP request was intercepted by Age Verification or yielded 0 items
        is_age_blocked = any(w in page_title.lower() for w in ("age verification", "verification", "disclaimer", "want to watch"))

        # Bypass 1: Search Crawler Canal (Googlebot) - Platforms must serve full galleries to search bots for SEO indexing
        if is_age_blocked or (not gallery_items and ("/gallery/" in url.lower() or is_static_preview_upgradeable(url))):
            try:
                bot_session = requests.Session()
                bot_session.headers.update({
                    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Cookie": "ageverif_accepted=T; age_verified=1; has_visited=1; disclaimer_accepted=1; over18=1"
                })
                bot_res = await loop.run_in_executor(None, lambda: bot_session.get(url, timeout=12))
                if bot_res.status_code == 200:
                    bot_soup = BeautifulSoup(bot_res.text, "html.parser")
                    bot_title = bot_soup.title.get_text(strip=True) if bot_soup.title else ""
                    if not any(w in bot_title.lower() for w in ("age verification", "verification", "disclaimer")):
                        bot_items = self.find_media_links(url, bot_res.text)
                        if bot_items:
                            raw_html = bot_res.text
                            soup = bot_soup
                            page_title = re.sub(r'(?i)\s*[-|•–]\s*(?:[a-zA-Z0-9-]+\.(?:com|net|org|tv|me|cc|video|site|club|xyz|to)).*$', '', bot_title).strip()
                            gallery_items = bot_items
                            is_age_blocked = False
                            await emit({
                                "type": "ai_thought",
                                "stage": "OBSERVATION",
                                "thought": f"️ [Active Bypass] Age verification barrier successfully bypassed via crawler channel (Googlebot). {len(gallery_items)} photos unlocked!",
                            })
            except Exception as bot_err:
                logger.warning(f"Crawler bypass fallback error: {bot_err}")

        # Bypass 2: Headless Browser Fallback if still blocked
        if (not gallery_items or is_age_blocked) and "/gallery/" in url.lower():
            try:
                from ..browser.engine import BrowserEngine
                await emit({
                    "type": "ai_thought",
                    "stage": "OBSERVATION",
                    "thought": f"️ [Active Bypass] Launching headless Chromium with consent bypass...",
                })
                b_engine = BrowserEngine(headless=True)
                await b_engine.start()
                try:
                    await b_engine.navigate(url)
                    await b_engine.dismiss_age_gates_and_popups(b_engine.main_page)
                    await asyncio.sleep(1.5)
                    raw_html = await b_engine.main_page.content()
                    soup = BeautifulSoup(raw_html, "html.parser")
                    b_title = soup.title.get_text(strip=True) if soup.title else f"Galeria {domain}"
                    page_title = re.sub(r'(?i)\s*[-|•–]\s*(?:[a-zA-Z0-9-]+\.(?:com|net|org|tv|me|cc|video|site|club|xyz|to)).*$', '', b_title).strip()
                    gallery_items = self.find_media_links(url, raw_html)
                finally:
                    await b_engine.close()
            except Exception as b_err:
                logger.warning(f"Browser fallback exception in surgical scout: {b_err}")

        await emit({
            "type": "album_init",
            "title": page_title,
            "total_candidates": len(gallery_items),
            "url": url,
        })
        await emit({
            "type": "ai_thought",
            "stage": "HYPOTHESIS_GENERATION",
            "thought": f" [Surgical Filter] Mapped {len(gallery_items)} genuine media links. Noise and advertisements filtered successfully.",
        })

        if not gallery_items:
            await emit({
                "type": "status",
                "message": "No gallery images found in page body.",
            })
            dur = round(time.time() - start_time, 2)
            try:
                telemetry = TelemetryMetrics(duration_seconds=dur)
            except Exception:
                telemetry = TelemetryMetrics()
            return Album(
                album_id=f"scout_{abs(hash(url)) % 1000000}",
                title=page_title,
                original_title=page_title,
                source_page=url,
                source_type="gallery",
                images=[],
                telemetry=telemetry,
                metadata={"model_used": f"Gemini ({gemini_model}) + Qwen ({local_model})", "duration": dur}
            )

        # Stage 2: Parallel Resolution with Physical X-Ray
        found_hosts = set(extract_base_domain(it.get("target_url", "")) for it in gallery_items if it.get("target_url"))
        cached_matches = [h for h in found_hosts if h in self.domain_rule_cache]
        if cached_matches:
            await emit({
                "type": "ai_thought",
                "stage": "PROVEN_VECTOR",
                "thought": f" [Knowledge Base] {len(cached_matches)} servidor(es) identificados em cache ({', '.join(cached_matches)}). Instant extraction (0ms) activated!",
            })

        await emit({
            "type": "ai_thought",
            "stage": "SPECULATIVE_PROBING",
            "thought": f" [Parallel Inspection] Processing {len(gallery_items)} items concurrently...",
        })

        all_records: List[Dict[str, Any]] = []
        resolved_images: List[AlbumImage] = []
        seen_urls: Set[str] = set()

        def on_rule_learned(learned_domain: str, learned_rule: Dict[str, Any]):
            async def push_learned():
                await emit({
                    "type": "ai_thought",
                    "stage": "PROVEN_VECTOR",
                    "thought": f" [Self-Learning] Nova regra aprendida para o host '{learned_domain}' ({learned_rule.get('css_selector') or learned_rule.get('strategy')}) and saved to data/host_rules.json!",
                })
            asyncio.run_coroutine_threadsafe(push_learned(), loop)

        def run_parallel_extraction():
            records = []
            canonical_map = {}  # can_key -> (record_idx, file_size, is_thumb)
            with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_WORKERS) as executor:
                future_to_item = {
                    executor.submit(self.resolve_single_item, item, url, gemini_model, on_rule_learned): item
                    for item in gallery_items
                }
                completed_count = 0
                for future in as_completed(future_to_item):
                    if self.is_cancelled:
                        break
                    completed_count += 1
                    try:
                        record = future.result()
                        if record and record.get("original_url"):
                            orig = record["original_url"]
                            can_key = get_canonical_media_key(orig)
                            file_sz = record.get("file_size") or 0
                            w = record.get("width") or 0
                            h = record.get("height") or 0
                            is_thumb_indicator = bool(re.search(r'(_\d+x\d+|_thumb\b|-thumb\b|_small\b|_240\b|_190x152\b)', orig, re.I))

                            # Format detection
                            detected_format = record.get("format") or media_source_format(orig) or "jpg"
                            is_animated_media = bool(record.get("is_animated")) or (detected_format == "gif" and not record.get("animation_checked"))
                            media_t = "gif" if is_animated_media else "image"

                            # Canonical Deduplication: never allow thumbnail and original of same media
                            if can_key and can_key in canonical_map:
                                existing_idx, existing_sz, existing_is_thumb = canonical_map[can_key]
                                # If existing entry was a thumbnail and the new one is full original, replace it!
                                if existing_is_thumb and not is_thumb_indicator:
                                    records[existing_idx] = record
                                    canonical_map[can_key] = (existing_idx, file_sz, False)
                                    for ri in resolved_images:
                                        if get_canonical_media_key(ri.original_url) == can_key:
                                            ri.original_url = orig
                                            ri.thumbnail_url = record.get("thumbnail_url") or orig
                                            ri.width = w
                                            ri.height = h
                                            ri.file_size = file_sz
                                            ri.format = detected_format
                                            ri.media_type = media_t
                                            ri.is_animated = is_animated_media
                                            ri.animation_checked = bool(record.get("animation_checked"))
                                            break
                                    continue
                                # If existing is already original or incoming is a duplicate thumbnail, discard incoming
                                continue

                            if orig not in seen_urls:
                                seen_urls.add(orig)
                                rec_idx = len(records)
                                records.append(record)
                                all_records.append(record)
                                if can_key:
                                    canonical_map[can_key] = (rec_idx, file_sz, is_thumb_indicator)

                                pos = len(resolved_images) + 1
                                img_obj = AlbumImage(
                                    position=pos,
                                    candidate_id=f"scout_cand_{pos}",
                                    thumbnail_url=record.get("thumbnail_url") or orig,
                                    original_url=orig,
                                    width=w,
                                    height=h,
                                    file_size=file_sz,
                                    format=detected_format,
                                    media_type=media_t,
                                    is_animated=is_animated_media,
                                    animation_checked=bool(record.get("animation_checked")),
                                    resolution_method=ResolutionMethod.VERIFIED_CDN_CANDIDATE,
                                    confidence=1.0,
                                    validation_status="PASS",
                                    source_page=record.get("provenance_chain", {}).get("viewer_page") or url,
                                    color_palette=record.get("color_palette"),
                                )
                                resolved_images.append(img_obj)

                                # Push live event asynchronously to SSE
                                async def push_event(img: AlbumImage, c_count: int, t_count: int):
                                    await emit({
                                        "type": "image_resolved",
                                        "position": img.position,
                                        "thumbnail_url": img.thumbnail_url,
                                        "original_url": img.original_url,
                                        "width": img.width,
                                        "height": img.height,
                                        "dimensions": f"{img.width}x{img.height}" if img.width else "Original",
                                        "format": img.format,
                                        "media_type": img.media_type,
                                        "is_animated": img.is_animated,
                                        "validation_status": "PASS",
                                        "resolution_method": "verified_cdn_candidate",
                                    })
                                    await emit({
                                        "type": "status",
                                        "message": f"Extracted {c_count}/{t_count}: {img.original_url[:60]}...",
                                    })

                                asyncio.run_coroutine_threadsafe(push_event(img_obj, completed_count, len(gallery_items)), loop)
                    except Exception as e:
                        logger.warning(f"Error resolving item: {e}")
            return records

        await loop.run_in_executor(None, run_parallel_extraction)

        # Save to knowledge ledger
        model_label = f"Gemini Surgical Scout ({gemini_model}) + Qwen ({local_model})" if has_gemini else "Surgical Scout (Heurística Determinística + Raio-X Físico)"
        self.bridge.save_knowledge_ledger(url, page_title, all_records, model_name=model_label)
        await emit({
            "type": "ai_thought",
            "stage": "PROVEN_VECTOR",
            "thought": f" [Knowledge Base] {len(all_records)} photos saved successfully ({'Gemini AI active' if has_gemini else 'Deterministic/Physical Mode'}) em data/image_knowledge_base.json e data/albums/!",
        })

        duration_val = round(time.time() - start_time, 2)
        try:
            telemetry = TelemetryMetrics(
                candidates_discovered=len(gallery_items),
                candidates_investigated=len(gallery_items),
                originals_resolved=len(resolved_images),
                originals_unresolved=len(gallery_items) - len(resolved_images),
                banners_rejected=0,
                duration_seconds=duration_val,
            )
        except Exception:
            telemetry = TelemetryMetrics(
                candidates_discovered=len(gallery_items),
                candidates_investigated=len(gallery_items),
                originals_resolved=len(resolved_images),
                originals_unresolved=len(gallery_items) - len(resolved_images),
                banners_rejected=0,
            )

        duration_saved = getattr(telemetry, "duration_seconds", duration_val)

        # Auto-resolve valid cover thumbnail (prevent transparent 1px placeholders)
        def _is_valid_media_url(u: Optional[str]) -> bool:
            if not u:
                return False
            u_low = str(u).lower()
            return not any(p in u_low for p in ("1px.png", "1px.gif", "blank.gif", "spacer.gif", "transparent.png"))

        cover_url = None
        for img in resolved_images:
            if _is_valid_media_url(img.original_url):
                cover_url = img.original_url
                break
            if _is_valid_media_url(img.thumbnail_url):
                cover_url = img.thumbnail_url
                break
            if getattr(img, "poster_url", None) and _is_valid_media_url(img.poster_url):
                cover_url = img.poster_url
                break

        album = Album(
            album_id=f"scout_{abs(hash(url)) % 1000000}",
            title=page_title,
            original_title=page_title,
            source_page=url,
            source_type="gallery",
            cover_image_url=cover_url,
            images=resolved_images,
            telemetry=telemetry,
            metadata={
                "model_used": f"Gemini Surgical Scout ({gemini_model}) + Qwen Closer ({local_model})",
                "engine_type": "gemini_surgical_scout",
                "saved_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                "duration": duration_saved,
            }
        )

        return album
