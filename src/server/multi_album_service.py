"""
Serviço Isolado de Expansão e Descoberta Multi-Álbum / Performer.
Executa buscas determinísticas em contêineres relacionados, rotas canônicas e busca interna do site,
sem depender de alucinações de LLM e sem alterar os motores de extração existentes.
"""

import os
import re
import asyncio
import urllib.parse
import json
from typing import List, Dict, Any, Optional, AsyncGenerator
import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

try:
    from ..core.network_profiles import get_canonical_performer_routes, is_fast_track_supported, get_fast_track_endpoint
except (ImportError, ValueError):
    from src.core.network_profiles import get_canonical_performer_routes, is_fast_track_supported, get_fast_track_endpoint

router = APIRouter(prefix="/api/multi-album", tags=["Multi-Album Discovery"])

# Palavras de ruído e stop-words em português para extração de nomes
STOP_WORDS_PT = {
    'quero', 'album', 'albums', 'albuns', 'link', 'outro', 'outros', 'mais',
    'dos', 'das', 'pagina', 'dela', 'dele', 'relacionados', 'relacionadas',
    'fotos', 'videos', 'site', 'qualquer', 'todos', 'todas', 'extrair',
    'principal', 'galerias', 'galeria', 'esse', 'essa', 'este', 'esta',
    'como', 'para', 'pelo', 'pela', 'com', 'sem', 'que', 'nao', 'sim',
    'tambem', 'apenas', 'somente', 'outro', 'outra', 'atriz', 'modelo',
    'performer', 'celebrity', 'related', 'links', 'imagens', 'download'
}

BAD_TITLES = {
    'google', 'login', 'sign in', 'signin', 'signup', 'sign up',
    'entrar', 'cadastrar', 'compartilhar', 'share', 'facebook', 'twitter',
    'instagram', 'reddit', 'vk', 'discord', 'privacy policy', 'terms of service',
    'dmca', 'contact', 'support', 'help', 'home', 'inicio', 'login with google'
}

CANONICAL_PERFORMER_ROUTES = get_canonical_performer_routes()

SEARCH_QUERY_ROUTES = [
    "{origin}/search/?q={query}",
    "{origin}/search?q={query}",
    "{origin}/search.php?q={query}",
    "{origin}/search.php?keywords={query}",
    "{origin}/?s={query}",
    "{origin}/search/{query}/"
]

class DiscoveryRequest(BaseModel):
    url: str
    performer_name: Optional[str] = None
    max_related: Optional[int] = 0
    max_pages: Optional[int] = 50

class DiscoveredAlbumItem(BaseModel):
    title: str
    url: str
    thumbnail_url: Optional[str] = None
    source_type: str  # 'related', 'performer_page', 'search', 'primary'
    total_images_hint: Optional[int] = None
    page_found: Optional[int] = None

class DiscoveryResponse(BaseModel):
    source_url: str
    target_performer: Optional[str] = None
    discovered_albums: List[DiscoveredAlbumItem]
    total_found: int
    pages_scanned: Optional[int] = 1


class MultiAlbumService:
    """
    Motor determinístico e assíncrono para descoberta de novos álbuns
    sem qualquer dependência de Selenium, PyQt ou chamadas pesadas a LLM.
    """

    @staticmethod
    def extract_performer_slug(raw_name: str) -> str:
        clean = raw_name.strip().lower()
        # Remove caracteres especiais
        clean = re.sub(r'[^a-zA-Z0-9\s-]', '', clean)
        return clean.replace(" ", "-")

    @staticmethod
    def is_single_gallery_url(url: str) -> bool:
        """
        Determina de forma agnóstica se a URL fornecida é de um álbum/galeria individual
        ou de uma página estrutural de índice/listagem/feed (categoria, autor, busca, tag, etc.).
        Baseia-se puramente na anatomia canônica de rotas da web, sem vocabulário restrito.
        """
        parsed = urllib.parse.urlparse(url)
        path = parsed.path.lower().strip("/")
        if not path:
            return False

        # Parâmetros de paginação e filtragem indicam listas/feeds
        query = parsed.query.lower()
        if any(qp in query for qp in ['page=', 'p=', 's=', 'q=', 'search=', 'query=', 'sort=', 'filter=']):
            return False

        segments = [s for s in path.split("/") if s]
        if not segments:
            return False

        # Rotas estruturais genéricas de índices e diretórios
        STRUCTURAL_LISTING_PATTERNS = {
            'category', 'categories', 'cat', 'user', 'users', 'u', 'author', 'authors',
            'channel', 'channels', 'c', 'search', 'find', 'tag', 'tags', 't',
            'profile', 'profiles', 'creator', 'creators', 'collection', 'collections',
            'explore', 'trending', 'popular', 'top', 'latest', 'recent', 'feed',
            'browse', 'archive', 'archives', 'topic', 'topics', 'section', 'sections'
        }
        if any(p in segments for p in STRUCTURAL_LISTING_PATTERNS) or any(path.startswith(p) for p in STRUCTURAL_LISTING_PATTERNS):
            return False

        # Prefixos canônicos de entidades de mídia terminal
        TERMINAL_GALLERY_PREFIXES = {
            'gallery', 'galleries', 'album', 'albums', 'post', 'posts',
            'artwork', 'art', 'set', 'sets', 'photo', 'photos', 'view', 'item', 'thread', 'threads', 'a', 'g'
        }

        # Identificadores únicos terminais (IDs numéricos ou hashes de recurso)
        has_numeric_id = bool(re.search(r'[-_][0-9]{4,12}$', segments[-1])) or bool(re.search(r'^[0-9]{4,12}$', segments[-1]))
        has_hash_identifier = (len(segments) >= 2 and segments[0] in TERMINAL_GALLERY_PREFIXES and (len(segments[1]) >= 5 or len(segments[-1]) >= 5))
        has_gallery_prefix = segments[0] in TERMINAL_GALLERY_PREFIXES

        # Caminhos rasos de dois segmentos sem ID numérico (ex: /photos/natureza) são diretórios/índices
        if segments[0] in ['photos', 'pics', 'photo'] and not has_numeric_id and len(segments) <= 2:
            return False

        return (has_numeric_id and has_gallery_prefix) or (has_gallery_prefix and has_hash_identifier) or has_numeric_id

    @staticmethod
    def extract_main_gallery(html: str, url: str) -> Optional[DiscoveredAlbumItem]:
        """
        Extrai o álbum legítimo da página atual quando ela é uma galeria individual.
        Captura o título real (h1/og:title) e a miniatura legítima de foto (nunca ícones SVG/Google).
        """
        if not html:
            return None
        soup = BeautifulSoup(html, "html.parser")
        clean_url = urllib.parse.urldefrag(url)[0].rstrip("/")

        # 1. Título do Álbum Principal
        title = None
        h1 = soup.find("h1")
        if h1:
            h1_txt = h1.get_text(separator=" ", strip=True)
            if len(h1_txt) > 3 and not any(ign in h1_txt.lower() for ign in ["login", "sign in", "google", "cadastro", "entrar"]):
                title = h1_txt[:90]

        if not title:
            og_title = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name": "og:title"})
            if og_title and og_title.get("content"):
                c = og_title["content"].strip()
                if len(c) > 3 and not any(ign in c.lower() for ign in ["login", "google", "sign in"]):
                    title = c[:90]

        if not title:
            t_tag = soup.find("title")
            if t_tag:
                clean_t = re.sub(r'\s*[-|–—]\s*.*$', '', t_tag.get_text(strip=True)).strip()
                if len(clean_t) > 3 and not any(ign in clean_t.lower() for ign in ["login", "google", "sign in"]):
                    title = clean_t[:90]

        if not title:
            slug = urllib.parse.urlparse(clean_url).path.rstrip("/").split("/")[-1]
            slug = re.sub(r'^\d+[-_]?', '', slug)
            slug = re.sub(r'[-_]\d+$', '', slug)
            title = slug.replace("-", " ").replace("_", " ").title().strip()[:90]

        if not title or len(title) <= 2:
            title = "Álbum Principal"

        # 2. Thumbnail da Foto Principal do Álbum
        cover = None
        og_img = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
        if og_img and og_img.get("content"):
            c = og_img["content"].strip()
            if not any(ign in c.lower() for ign in [".svg", ".ico", "1px.png", "pixel.gif", "logo", "icon", "google", "avatar", "blank"]):
                cover = urllib.parse.urljoin(clean_url, c)

        if not cover:
            # Varre as imagens da galeria procurando a primeira foto legítima
            for img in soup.find_all("img"):
                cand = img.get("data-src") or img.get("data-original") or img.get("data-lazy-src") or img.get("src")
                if not cand:
                    continue
                cand_lower = cand.lower()
                if any(ign in cand_lower for ign in [".svg", ".ico", "1px.png", "pixel.gif", "logo", "icon", "google", "avatar", "blank"]):
                    continue
                if any(ext in cand_lower for ext in [".jpg", ".jpeg", ".webp", ".png", "460", "640", "1280", "cdni", "photos", "galleries"]):
                    cover = urllib.parse.urljoin(clean_url, cand)
                    break

        return DiscoveredAlbumItem(
            title=title,
            url=clean_url,
            thumbnail_url=cover,
            source_type="primary"
        )

    @staticmethod
    def extract_thumbnail(tag_a, base_url: str) -> Optional[str]:
        # Busca imagem interna
        img = tag_a.find("img")
        if img:
            for attr in ["data-original", "data-lazy-src", "data-src", "src", "data-thumb", "data-bg"]:
                val = img.get(attr)
                if val:
                    val_lower = val.lower()
                    if any(ign in val_lower for ign in [".svg", ".ico", "1px.png", "pixel.gif", "google-icon", "logo", "favicon", "avatar", "blank"]):
                        continue
                    return urllib.parse.urljoin(base_url, val)
        
        # Busca por background-image em divs internas ou no próprio link
        for tag in [tag_a] + tag_a.find_all():
            style = tag.get("style", "")
            if "background" in style.lower():
                m = re.search(r"url\(['\"]?(.*?)['\"]?\)", style)
                if m:
                    val = m.group(1)
                    val_lower = val.lower()
                    if not val.startswith("data:image") and not any(ign in val_lower for ign in [".svg", ".ico", "1px.png", "google", "logo", "icon"]):
                        return urllib.parse.urljoin(base_url, val)
        return None

    @staticmethod
    def unpack_redirect_url(href: str, base_url: str) -> str:
        """Descompacta URLs de redirecionamento/tracking como /hit/.../?url=... para a URL real da galeria."""
        if not href or href.strip() in ['#', '/', 'javascript:;', 'javascript:void(0)']:
            return ""
        if href.strip().startswith(('#', 'javascript:', 'mailto:', 'tel:', 'data:')):
            return ""
        full = urllib.parse.urljoin(base_url, href).strip()
        full, _ = urllib.parse.urldefrag(full)
        if "url=" in full or "redirect=" in full or "link=" in full:
            m = re.search(r'(?:url|redirect|link|target|goto)=([^&]+)', full)
            if m:
                unpacked = urllib.parse.unquote(urllib.parse.unquote(m.group(1)))
                if unpacked.startswith("http"):
                    unpacked, _ = urllib.parse.urldefrag(unpacked)
                    return unpacked.rstrip("/")
        return full.rstrip("/")

    @staticmethod
    def extract_title_from_tag(tag_a, full_url: str, fallback_index: int) -> str:
        BAD_TITLES = {"google", "login", "sign in", "signin", "signup", "sign up", "entrar", "cadastrar", "compartilhar", "share", "facebook", "twitter", "instagram"}

        # 1. Title do link
        title = tag_a.get("title", "").strip()
        if title and len(title) > 3 and title.lower() not in BAD_TITLES:
            return title[:90]

        # 2. Alt/title da imagem
        img = tag_a.find("img")
        if img:
            img_alt = (img.get("alt", "").strip() or img.get("title", "").strip())
            if img_alt and len(img_alt) > 3 and img_alt.lower() not in BAD_TITLES:
                return img_alt[:90]

        # 3. Texto do próprio elemento
        txt = tag_a.get_text(separator=" ", strip=True)
        if txt and len(txt) > 3 and len(txt) < 120 and txt.lower() not in BAD_TITLES:
            return txt[:90]

        # 4. Texto do card pai
        card = tag_a.find_parent(class_=lambda c: c and any(k in str(c).lower() for k in ['item', 'thumb', 'video', 'post', 'box', 'card']))
        if card:
            card_txt = card.get_text(separator=" ", strip=True)
            clean_txt = re.sub(r'^\d{1,2}:\d{2}\s*', '', card_txt).strip()
            if clean_txt and len(clean_txt) > 3 and clean_txt.lower() not in BAD_TITLES:
                return clean_txt[:90]

        # 5. Derivado do slug da URL
        try:
            slug = urllib.parse.urlparse(full_url).path.rstrip("/").split("/")[-1]
            slug = re.sub(r'^\d+[-_]?', '', slug)
            slug = re.sub(r'[-_]\d+$', '', slug)
            clean_slug = slug.replace("-", " ").replace("_", " ").title().strip()
            if clean_slug and len(clean_slug) > 3 and clean_slug.lower() not in BAD_TITLES:
                return clean_slug[:90]
        except Exception:
            pass

        return f"Álbum #{fallback_index}"

    @staticmethod
    def is_related_container(tag_a) -> bool:
        """
        Determina se a tag <a> está contida em uma seção de recomendações secundárias,
        aside, sidebar, footer ou blocos explicitamente marcados como relacionados.
        """
        if not tag_a:
            return False
        for parent in tag_a.parents:
            if not parent or not hasattr(parent, 'name'):
                continue
            p_name = parent.name.lower()
            if p_name in ["aside", "footer", "nav"]:
                return True
            classes = parent.get("class", [])
            classes_str = " ".join(classes).lower() if isinstance(classes, list) else str(classes).lower()
            parent_id = str(parent.get("id", "")).lower()

            related_signals = [
                "related", "relacionad", "recommended", "recomendad", "similar", "suggestions",
                "more-like", "sponsored", "sidebar", "widget-tags"
            ]
            if any(sig in classes_str or sig in parent_id for sig in related_signals):
                if not any(main_sig in classes_str or main_sig in parent_id for main_sig in ["main", "primary", "performer-galleries", "user-galleries", "category-galleries"]):
                    return True
        return False

    @staticmethod
    async def stream_discover_albums(req: DiscoveryRequest) -> AsyncGenerator[str, None]:
        results: List[DiscoveredAlbumItem] = []
        clean_base_url = urllib.parse.urldefrag(req.url)[0].rstrip("/")
        seen_urls = {
            clean_base_url,
            clean_base_url + "/",
            clean_base_url + "/#",
            req.url,
            req.url.rstrip("/")
        }

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        }

        ALBUM_PATTERNS = [
            "/galleries/", "/gallery/", "/album/", "/albums/", "/g/", "/post/", "/posts/",
            "/thread/", "/threads/", "/photo/", "/photos/", "/set/", "/sets/", "/pics/",
            "/pictures/", "/v/", "/video/", "/videos/", "/watch/", "/item/", "/tube/videos/"
        ]

        parsed_origin = urllib.parse.urlparse(req.url)
        origin_url = f"{parsed_origin.scheme}://{parsed_origin.netloc}"
        netloc = parsed_origin.netloc.lower()
        is_unlimited = (req.max_related == 0)
        is_single_gallery = MultiAlbumService.is_single_gallery_url(req.url)

        yield f"data: {json.dumps({'type': 'status', 'message': 'Conectando ao site...', 'count': 0})}\n\n"

        # -----------------------------------------------------------------
        # PASSO 0: IDENTIFICAÇÃO DO ÁLBUM PRINCIPAL (Se for galeria individual)
        # O álbum do próprio link fornecido é o 1º resultado ("primary")
        # com título legítimo e miniatura de foto real, nunca SVG/OAuth/Google.
        # -----------------------------------------------------------------
        main_album: Optional[DiscoveredAlbumItem] = None
        if is_single_gallery:
            try:
                async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers=headers) as mclient:
                    m_resp = await mclient.get(req.url)
                    if m_resp.status_code == 200:
                        main_album = MultiAlbumService.extract_main_gallery(m_resp.text, req.url)
            except Exception:
                pass

            if not main_album:
                slug = urllib.parse.urlparse(clean_base_url).path.rstrip("/").split("/")[-1]
                slug = re.sub(r'^\d+[-_]?', '', slug)
                slug = re.sub(r'[-_]\d+$', '', slug)
                derived_title = slug.replace("-", " ").replace("_", " ").title().strip()
                main_album = DiscoveredAlbumItem(
                    title=derived_title or "Álbum Principal",
                    url=clean_base_url,
                    thumbnail_url=None,
                    source_type="primary"
                )

            results.append(main_album)
            seen_urls.add(main_album.url.rstrip("/"))
            yield f"data: {json.dumps({'type': 'album', 'album': main_album.dict(), 'count': len(results)})}\n\n"
            await asyncio.sleep(0.01)

        # -----------------------------------------------------------------
        # PASSO 0-B: Extração Multi-Página de Listagem / Performer (via HTTPX)
        # Se for uma página de listagem/categoria/performer, busca ativamente os
        # álbuns de todas as páginas subsequentes (rel="next", paginação, botões).
        # -----------------------------------------------------------------
        max_pages = req.max_pages if (req.max_pages is not None and req.max_pages > 0) else 50
        pages_scanned = 0

        if not is_single_gallery:
            current_page_url = req.url
            visited_page_urls = set()

            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers=headers) as lclient:
                    while current_page_url and pages_scanned < max_pages:
                        if req.max_related and req.max_related > 0 and len(results) >= req.max_related:
                            break

                        if current_page_url in visited_page_urls:
                            break
                        visited_page_urls.add(current_page_url)
                        pages_scanned += 1

                        yield f"data: {json.dumps({'type': 'page', 'page': pages_scanned, 'message': f'Escaneando página {pages_scanned}... ({len(results)} álbuns)', 'count': len(results)})}\n\n"

                        try:
                            l_resp = await lclient.get(current_page_url)
                        except Exception:
                            break

                        if l_resp.status_code != 200:
                            break

                        soup_list = BeautifulSoup(l_resp.text, "html.parser")
                        new_albums_this_page = 0

                        for tag_a in soup_list.find_all("a", href=True):
                            if req.max_related and req.max_related > 0 and len(results) >= req.max_related:
                                break
                            raw_href = tag_a["href"].strip()
                            full_sub = MultiAlbumService.unpack_redirect_url(raw_href, current_page_url)
                            if not full_sub:
                                continue
                            clean_sub = urllib.parse.urldefrag(full_sub)[0].rstrip("/")
                            if clean_sub in seen_urls or clean_sub == clean_base_url:
                                continue
                            parsed_sub = urllib.parse.urlparse(clean_sub)
                            # Verifica se o link é do mesmo domínio
                            if parsed_sub.netloc.lower() != netloc and not parsed_sub.netloc.lower().endswith("." + netloc.split(".", 1)[-1]):
                                continue
                            if any(clean_sub.lower().endswith(ext) for ext in [".jpg", ".png", ".webp", ".gif", ".css", ".js", ".svg"]):
                                continue
                            if any(noise in clean_sub.lower() for noise in ["login", "terms", "privacy", "dmca", "contact", "join", "signup", "/advertising", "/faq", "/support"]):
                                continue
                            path_lower = parsed_sub.path.lower()
                            has_album_pattern = any(p in path_lower for p in ALBUM_PATTERNS)
                            has_thumb = (tag_a.find("img") is not None) or ("background" in tag_a.get("style", "").lower())
                            if has_album_pattern or (has_thumb and len(path_lower) > 3):
                                title = MultiAlbumService.extract_title_from_tag(tag_a, clean_sub, len(results) + 1)
                                if not title or title.lower() in BAD_TITLES or any(title.lower().startswith(b) for b in ["google", "login", "sign in", "entrar"]):
                                    continue
                                thumb = MultiAlbumService.extract_thumbnail(tag_a, current_page_url)
                                if thumb and any(ign in thumb.lower() for ign in [".svg", ".ico", "google-icon", "google", "logo", "favicon"]):
                                    thumb = None
                                is_rel = MultiAlbumService.is_related_container(tag_a)
                                album_obj = DiscoveredAlbumItem(
                                    title=title,
                                    url=clean_sub,
                                    thumbnail_url=thumb,
                                    source_type="related" if is_rel else "primary",
                                    page_found=pages_scanned
                                )
                                results.append(album_obj)
                                seen_urls.add(clean_sub)
                                new_albums_this_page += 1
                                yield f"data: {json.dumps({'type': 'album', 'album': album_obj.dict(), 'count': len(results)})}\n\n"
                                await asyncio.sleep(0.005)

                        # Detect next page
                        next_page_url = None

                        # Strategy 1: link rel="next" or a rel="next"
                        link_next = soup_list.find(["link", "a"], attrs={"rel": lambda r: r and "next" in r.lower() if isinstance(r, str) else (isinstance(r, list) and any("next" in str(x).lower() for x in r))})
                        if link_next and link_next.get("href"):
                            cand = link_next["href"].strip()
                            if cand and not cand.startswith(('#', 'javascript:')):
                                next_page_url = urllib.parse.urljoin(current_page_url, cand)

                        # Strategy 2: Common CSS pagination selectors
                        if not next_page_url:
                            next_sel = soup_list.select_one('.pagination .next a, .pagination a.next, a.next_page, a.next-page, a.pagination-next, .pagination-next a, .page-next a, li.page_next a, .page_next a, a#next_page, a.nextPage, [aria-label*="Next" i], [title*="Next page" i], [title*="Próxima" i]')
                            if next_sel and next_sel.get("href"):
                                cand = next_sel["href"].strip()
                                if cand and not cand.startswith(('#', 'javascript:')):
                                    next_page_url = urllib.parse.urljoin(current_page_url, cand)

                        # Strategy 3: Text content inspection of anchors
                        if not next_page_url:
                            for a_tag in soup_list.find_all("a", href=True):
                                txt = a_tag.get_text(strip=True).lower()
                                title_a = (a_tag.get("title") or "").strip().lower()
                                aria_a = (a_tag.get("aria-label") or "").strip().lower()
                                cls_a = " ".join(a_tag.get("class", [])).lower() if isinstance(a_tag.get("class"), list) else str(a_tag.get("class", "")).lower()

                                is_next_match = (
                                    txt in ['next', 'next »', 'next >', 'next ›', '»', '›', 'próxima', 'proxima', 'seguinte', 'suivante', 'weiter'] or
                                    'next page' in title_a or 'próxima' in title_a or 'next page' in aria_a or
                                    'pagination-next' in cls_a or 'next-page' in cls_a
                                )
                                if is_next_match:
                                    cand = a_tag["href"].strip()
                                    if cand and not cand.startswith(('#', 'javascript:')):
                                        next_page_url = urllib.parse.urljoin(current_page_url, cand)
                                        break

                        # Strategy 4: Numbered pagination (pages_scanned + 1)
                        if not next_page_url:
                            target_num_str = str(pages_scanned + 1)
                            for a_tag in soup_list.find_all("a", href=True):
                                txt = a_tag.get_text(strip=True)
                                if txt == target_num_str:
                                    parent_cls = " ".join([str(p.get("class", "")) for p in a_tag.parents if hasattr(p, "get")]).lower()
                                    if any(p_kw in parent_cls for p_kw in ['pag', 'page', 'paging', 'nav']):
                                        cand = a_tag["href"].strip()
                                        if cand and not cand.startswith(('#', 'javascript:')):
                                            next_page_url = urllib.parse.urljoin(current_page_url, cand)
                                            break

                        # Strategy 5 Fallback: URL pattern increment if on page 1 and no explicit next link was found
                        if not next_page_url and pages_scanned == 1:
                            m_pat = re.match(r"^(https?://[^/]+(?:/[^/]+)+?)(?:/)?$", current_page_url)
                            if m_pat and not re.search(r"\.(?:html|php|aspx?)$", current_page_url):
                                next_page_url = m_pat.group(1).rstrip("/") + "/2/"

                        if not next_page_url or next_page_url in visited_page_urls or new_albums_this_page == 0:
                            break

                        current_page_url = next_page_url
            except Exception:
                pass

        # -----------------------------------------------------------------
        # PASSO A: FAST-TRACK (Se for galeria individual com API suportada)
        # -----------------------------------------------------------------
        if is_fast_track_supported(netloc, req.url):
            gid_m = re.search(r'-([0-9]{6,10})/?$', req.url)
            if gid_m:
                gid = gid_m.group(1)
                try:
                    async with httpx.AsyncClient(timeout=10.0, headers=headers) as pclient:
                        p_resp = await pclient.post(
                            get_fast_track_endpoint(),
                            json={"lang": "en", "gid": gid, "limit": 400},
                            headers={"Referer": req.url}
                        )
                        if p_resp.status_code == 200:
                            data = p_resp.json()
                            if isinstance(data, list):
                                for item in data:
                                    if req.max_related and req.max_related > 0 and len(results) >= req.max_related:
                                        break
                                    g_url = (item.get("g_url") or "").rstrip("/")
                                    g_clean = urllib.parse.urldefrag(g_url)[0].rstrip("/")
                                    if g_clean and g_clean not in seen_urls and g_clean != clean_base_url:
                                        desc = (item.get("desc") or "Galeria Relacionada").strip()
                                        if not desc or desc.lower() in BAD_TITLES:
                                            continue
                                        thumb = item.get("t_url_460") or item.get("t_url")
                                        if thumb and any(ign in str(thumb).lower() for ign in [".svg", ".ico", "google-icon", "google", "logo"]):
                                            thumb = None
                                        album_obj = DiscoveredAlbumItem(
                                            title=desc[:90],
                                            url=g_clean,
                                            thumbnail_url=thumb,
                                            source_type="related"
                                        )
                                        results.append(album_obj)
                                        seen_urls.add(g_clean)
                                        yield f"data: {json.dumps({'type': 'album', 'album': album_obj.dict(), 'count': len(results)})}\n\n"
                                        await asyncio.sleep(0.01)
                except Exception:
                    pass

        # -------------------------------------------------------------
        # PASSO B: Rota Canônica de Performer (se especificada)
        # -------------------------------------------------------------
        if req.performer_name:
            slug = MultiAlbumService.extract_performer_slug(req.performer_name)
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers=headers) as client:
                for pattern in CANONICAL_PERFORMER_ROUTES:
                    test_url = f"{origin_url}{pattern.format(slug=slug)}"
                    try:
                        resp_m = await client.get(test_url)
                        if resp_m.status_code == 200 and slug in resp_m.url.lower():
                            soup_m = BeautifulSoup(resp_m.text, "html.parser")
                            performer_found_count = 0
                            for tag_a in soup_m.find_all("a", href=True):
                                if req.max_related and req.max_related > 0 and performer_found_count >= req.max_related + 2:
                                    break
                                
                                raw_href = tag_a["href"].strip()
                                full_sub = MultiAlbumService.unpack_redirect_url(raw_href, test_url)
                                clean_sub = urllib.parse.urldefrag(full_sub)[0].rstrip("/")
                                if not clean_sub or clean_sub in seen_urls or clean_sub == clean_base_url:
                                    continue
                                path_lower = urllib.parse.urlparse(clean_sub).path.lower()
                                if any(p in path_lower for p in ALBUM_PATTERNS) and slug in clean_sub.lower():
                                    title = MultiAlbumService.extract_title_from_tag(tag_a, clean_sub, len(results) + 1)
                                    if not title or title.lower() in BAD_TITLES:
                                        continue
                                    thumb = MultiAlbumService.extract_thumbnail(tag_a, test_url)
                                    album_obj = DiscoveredAlbumItem(
                                        title=title[:90],
                                        url=clean_sub,
                                        thumbnail_url=thumb,
                                        source_type="performer_page"
                                    )
                                    results.append(album_obj)
                                    seen_urls.add(clean_sub)
                                    yield f"data: {json.dumps({'type': 'album', 'album': album_obj.dict(), 'count': len(results)})}\n\n"
                                    performer_found_count += 1
                            
                            if any(r.source_type == "performer_page" for r in results):
                                break
                    except Exception:
                        continue

        # -----------------------------------------------------------------
        # PASSO C: NAVEGADOR COM HARDWARE SCROLL STREAMING (Playwright)
        # Só ativa rolagem pesada se Fast-Track ou passos anteriores não trouxeram dados suficientes
        # -----------------------------------------------------------------
        if not is_single_gallery and len(results) > 0:
            needs_deep_scroll = False
        else:
            needs_deep_scroll = (len(results) < (req.max_related or 20)) if not is_unlimited else (len(results) < 30)
        if needs_deep_scroll:
            try:
                try:
                    from ..browser.engine import BrowserEngine
                except (ImportError, ValueError):
                    from src.browser.engine import BrowserEngine
                browser = BrowserEngine(headless=True)
                await browser.start()
                try:
                    page = browser.main_page

                    # Fila para transmitir itens interceptados via XHR/JSON
                    pending_stream_items: List[DiscoveredAlbumItem] = []

                    async def on_dynamic_response(res):
                        try:
                            if "json" in res.headers.get("content-type", "").lower():
                                data = await res.json()
                                items_to_parse = []
                                if isinstance(data, list):
                                    items_to_parse = data
                                elif isinstance(data, dict):
                                    for key in ["data", "items", "galleries", "albums", "videos", "results"]:
                                        if isinstance(data.get(key), list):
                                            items_to_parse = data[key]
                                            break

                                for item in items_to_parse:
                                    if isinstance(item, dict) and any(k in item for k in ["g_url", "url", "gallery", "gallery_url", "link"]):
                                        u = (item.get("g_url") or item.get("url") or item.get("gallery") or item.get("gallery_url") or item.get("link") or "").strip()
                                        u_clean = urllib.parse.urldefrag(u)[0].rstrip("/")
                                        if u_clean and u_clean not in seen_urls and u_clean != clean_base_url:
                                            d = (item.get("desc") or item.get("title") or item.get("name") or "").strip()
                                            if not d or d.lower() in BAD_TITLES:
                                                continue
                                            t = item.get("t_url_460") or item.get("t_url") or item.get("thumb") or item.get("thumbnail") or item.get("image")
                                            if t and any(ign in str(t).lower() for ign in [".svg", ".ico", "google-icon", "google", "logo"]):
                                                t = None

                                            if is_single_gallery:
                                                dyn_source = "related"
                                            else:
                                                is_explicit_rel = any(k in str(item.get("type", "")).lower() or k in str(item.get("section", "")).lower() for k in ["related", "recommended", "similar"])
                                                dyn_source = "related" if is_explicit_rel else "primary"

                                            album_obj = DiscoveredAlbumItem(
                                                title=str(d)[:90],
                                                url=u_clean,
                                                thumbnail_url=t,
                                                source_type=dyn_source
                                            )
                                            results.append(album_obj)
                                            seen_urls.add(u_clean)
                                            pending_stream_items.append(album_obj)
                        except Exception:
                            pass

                    page.on("response", on_dynamic_response)
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Abrindo página no navegador...', 'count': len(results)})}\n\n"
                    await browser.navigate(req.url)
                    await browser.dismiss_age_gates_and_popups(page)

                    # Se for galeria individual e ainda não capturamos o álbum principal
                    if is_single_gallery and not any(r.source_type == "primary" for r in results):
                        rendered_initial = await page.content()
                        main_album = MultiAlbumService.extract_main_gallery(rendered_initial, req.url)
                        if main_album:
                            results.insert(0, main_album)
                            seen_urls.add(main_album.url.rstrip("/"))
                            yield f"data: {json.dumps({'type': 'album', 'album': main_album.dict(), 'count': len(results)})}\n\n"

                    yield f"data: {json.dumps({'type': 'status', 'message': 'Iniciando rolagem contínua (PageDown)...', 'count': len(results)})}\n\n"

                    total_cycles = 30 if is_unlimited else 15
                    consecutive_empty = 0
                    for cycle in range(total_cycles):
                        if req.max_related and req.max_related > 0 and len(results) >= req.max_related:
                            break

                        cycle_start_count = len(results)

                        # Transmite qualquer item interceptado do XHR/JSON
                        while pending_stream_items:
                            popped = pending_stream_items.pop(0)
                            yield f"data: {json.dumps({'type': 'album', 'album': popped.dict(), 'count': len(results)})}\n\n"

                        # Hardware Scroll
                        await page.keyboard.press("PageDown")
                        await page.keyboard.press("PageDown")
                        await page.mouse.wheel(0, 1500)
                        await asyncio.sleep(0.35)

                        # Auto-click em botões de "Load More"
                        await page.evaluate("""() => {
                            const selectors = ['.load-more', '#load-more', '.btn-load-more', '.pagination-load-more'];
                            for (const s of selectors) {
                                const el = document.querySelector(s);
                                if (el && el.offsetParent !== null) { try { el.click(); return; } catch (_) {} }
                            }
                            const allBtns = Array.from(document.querySelectorAll('button, a.btn, a'));
                            for (const b of allBtns) {
                                const t = (b.innerText || '').toLowerCase().trim();
                                if (t === 'load more' || t === 'carregar mais' || t === 'show more' || t === 'ver mais') {
                                    try { b.click(); return; } catch (_) {}
                                }
                            }
                        }""")

                        # A cada 2 ciclos, raspa os novos links injetados no DOM e envia ao vivo
                        if cycle % 2 == 0 or cycle == total_cycles - 1:
                            rendered_html = await page.content()
                            soup_dyn = BeautifulSoup(rendered_html, "html.parser")
                            for tag_a in soup_dyn.find_all("a", href=True):
                                if req.max_related and req.max_related > 0 and len(results) >= req.max_related:
                                    break
                                
                                # Filtra classes/IDs de botões de login, oauth, google e redes sociais
                                tag_classes = tag_a.get("class", [])
                                tag_class_str = " ".join(tag_classes).lower() if isinstance(tag_classes, list) else str(tag_classes).lower()
                                tag_id_str = str(tag_a.get("id", "")).lower()
                                if any(ign in tag_class_str or ign in tag_id_str for ign in ["google", "oauth", "login", "signin", "signup", "auth", "social", "facebook", "twitter", "btn-outlined"]):
                                    continue

                                parent_classes = " ".join([
                                    " ".join(p.get("class", [])) if isinstance(p.get("class", []), list) else str(p.get("class", ""))
                                    for p in tag_a.parents if hasattr(p, "get")
                                ]).lower()
                                if any(auth_kw in parent_classes for auth_kw in ["login-modal", "oauth", "auth-popup", "header-auth", "user-auth"]):
                                    continue

                                raw_href = tag_a["href"].strip()
                                full_sub = MultiAlbumService.unpack_redirect_url(raw_href, req.url)
                                if not full_sub:
                                    continue

                                clean_sub = urllib.parse.urldefrag(full_sub)[0].rstrip("/")
                                if clean_sub in seen_urls or clean_sub == clean_base_url:
                                    continue
                                parsed_sub = urllib.parse.urlparse(clean_sub)
                                if parsed_sub.netloc.lower() != netloc and not parsed_sub.netloc.lower().endswith("." + netloc.split(".", 1)[-1]):
                                    continue
                                if any(clean_sub.lower().endswith(ext) for ext in [".jpg", ".png", ".webp", ".gif", ".css", ".js", ".svg"]):
                                    continue
                                if any(noise in clean_sub.lower() for noise in ["login", "terms", "privacy", "dmca", "contact", "join", "signup", "/advertising", "/faq", "/support", "google.com", "facebook.com", "twitter.com"]):
                                    continue

                                path_lower = urllib.parse.urlparse(clean_sub).path.lower()
                                has_album_pattern = any(p in path_lower for p in ALBUM_PATTERNS)
                                has_thumb = (tag_a.find("img") is not None) or ("background" in tag_a.get("style", "").lower())

                                if has_album_pattern or (has_thumb and len(path_lower) > 3):
                                    title = MultiAlbumService.extract_title_from_tag(tag_a, clean_sub, len(results) + 1)
                                    if not title or title.lower() in BAD_TITLES or any(title.lower().startswith(b) for b in ["google", "login", "sign in", "entrar"]):
                                        continue

                                    thumb = MultiAlbumService.extract_thumbnail(tag_a, req.url)
                                    if thumb and any(ign in thumb.lower() for ign in [".svg", ".ico", "google-icon", "google", "logo", "favicon"]):
                                        thumb = None

                                    if is_single_gallery:
                                        item_source_type = "related"
                                    else:
                                        item_source_type = "related" if MultiAlbumService.is_related_container(tag_a) else "primary"

                                    album_obj = DiscoveredAlbumItem(
                                        title=title,
                                        url=clean_sub,
                                        thumbnail_url=thumb,
                                        source_type=item_source_type
                                    )
                                    results.append(album_obj)
                                    seen_urls.add(clean_sub)
                                    yield f"data: {json.dumps({'type': 'album', 'album': album_obj.dict(), 'count': len(results)})}\n\n"

                            yield f"data: {json.dumps({'type': 'status', 'message': f'Rolando página... ({len(results)} álbuns encontrados)', 'count': len(results)})}\n\n"

                    # Descarrega qualquer item restante na fila
                    while pending_stream_items:
                        popped = pending_stream_items.pop(0)
                        yield f"data: {json.dumps({'type': 'album', 'album': popped.dict(), 'count': len(results)})}\n\n"

                finally:
                    await browser.close()
            except Exception:
                pass

        yield f"data: {json.dumps({'type': 'done', 'total': len(results), 'pages_scanned': max(pages_scanned, 1)})}\n\n"

    @staticmethod
    async def discover_albums(req: DiscoveryRequest) -> DiscoveryResponse:
        results: List[DiscoveredAlbumItem] = []
        pages_scanned = 1
        async for chunk in MultiAlbumService.stream_discover_albums(req):
            if chunk.startswith("data: "):
                try:
                    payload = json.loads(chunk[6:].strip())
                    if payload.get("type") == "album":
                        results.append(DiscoveredAlbumItem(**payload["album"]))
                    elif payload.get("type") == "done" and payload.get("pages_scanned"):
                        pages_scanned = payload.get("pages_scanned", 1)
                except Exception:
                    pass
        return DiscoveryResponse(
            source_url=req.url,
            target_performer=req.performer_name,
            discovered_albums=results,
            total_found=len(results),
            pages_scanned=pages_scanned
        )

multi_album_service = MultiAlbumService()

@router.post("/discover-stream")
async def discover_albums_stream_endpoint(req: DiscoveryRequest):
    """Transmite álbuns encontrados em tempo real via Server-Sent Events (SSE)."""
    if not req.url or not req.url.startswith("http"):
        raise HTTPException(status_code=400, detail="URL inválida fornecida.")
    return StreamingResponse(multi_album_service.stream_discover_albums(req), media_type="text/event-stream")

@router.post("/discover", response_model=DiscoveryResponse)
async def discover_albums_endpoint(req: DiscoveryRequest):
    """Rota isolada para descobrir álbuns secundários e de modelos sem travar a navegação principal."""
    if not req.url or not req.url.startswith("http"):
        raise HTTPException(status_code=400, detail="URL inválida fornecida.")
    return await multi_album_service.discover_albums(req)

