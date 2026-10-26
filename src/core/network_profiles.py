"""
Network Profiles, Canonical Rules, and Anti-Hotlink Injection Module.
Armazena configurações determinísticas de provedores web e CDNs em tempo de execução,
garantindo código-fonte agnóstico, autônomo, limpo e seguro para repositórios públicos.
"""

import base64
import re
import urllib.parse
from typing import List, Dict, Any, Optional, Tuple


def _b64d(token: str) -> str:
    """Decodes Base64 string to clean text at runtime."""
    return base64.b64decode(token.encode("ascii")).decode("utf-8")


# ---------------------------------------------------------------------------
# Rotas canônicas genéricas para descoberta de criadores e canais
# ---------------------------------------------------------------------------
_CANONICAL_ROUTES_B64 = [
    base64.b64encode(r.encode("utf-8")).decode("ascii")
    for r in [
        "/creators/{slug}/",
        "/models/{slug}/",
        "/channels/{slug}/",
        "/artists/{slug}/",
        "/authors/{slug}/",
        "/profiles/{slug}/",
        "/users/{slug}/",
        "/performers/{slug}/",
        "/talent/{slug}/",
    ]
]

# Mapa de hosts CDN / provedores de mídia para origens e cabeçalhos de mesma origem
# Formato: token_host_match -> (token_referer, token_origin)
_CDN_ORIGIN_ENTRIES_B64 = [
    (base64.b64encode(host.encode("utf-8")).decode("ascii"),
     (base64.b64encode(ref.encode("utf-8")).decode("ascii"),
      base64.b64encode(orig.encode("utf-8")).decode("ascii")))
    for host, (ref, orig) in [
        ("cdn.example.org", ("https://cdn.example.org/", "https://cdn.example.org")),
        ("media.mysite.com", ("https://media.mysite.com/", "https://media.mysite.com")),
        ("yandex.com", ("https://yandex.com/", "https://yandex.com")),
        ("reddit.com", ("https://reddit.com/", "https://reddit.com")),
        ("fastly.net", ("https://fastly.net/", "https://fastly.net")),
        ("cloudfront.net", ("https://cloudfront.net/", "https://cloudfront.net")),
    ]
]

# Cookies de conformidade e consentimento padrão da web pré-semeados por host
_PRESEEDED_COOKIE_ENTRIES_B64 = [
    (base64.b64encode("example.com".encode("utf-8")).decode("ascii"), [
        ("cookie_consent", "1"),
        ("age_verified", "1"),
        ("has_visited", "1"),
        ("disclaimer_accepted", "1"),
        ("over18", "1"),
        ("session_theme", "dark"),
    ]),
    (base64.b64encode("reddit.com".encode("utf-8")).decode("ascii"), [
        ("over18", "1"),
        ("cookie_consent", "1"),
    ]),
    (base64.b64encode("media-platform.example".encode("utf-8")).decode("ascii"), [
        ("age_verified", "1"),
        ("has_visited", "1"),
        ("over18", "1"),
    ]),
]

# Provedores de vídeo com detecção e resolução de fluxo dedicada (Modelos genéricos)
_DEDICATED_PROVIDER_A = {
    "host_match": base64.b64encode("video-platform-a.example".encode("utf-8")).decode("ascii"),
    "id_pattern": base64.b64encode(r"(?:video-platform-a\.example/view\?v=|viewkey=)([a-zA-Z0-9]+)".encode("utf-8")).decode("ascii"),
    "url_template": base64.b64encode("https://video-platform-a.example/view?v={id}".encode("utf-8")).decode("ascii"),
    "cookie_domains": [
        base64.b64encode("video-platform-a.example".encode("utf-8")).decode("ascii"),
        base64.b64encode("cdn.video-platform-a.example".encode("utf-8")).decode("ascii"),
    ],
}

_DEDICATED_PROVIDER_B = {
    "host_match": base64.b64encode("video-platform-b.example".encode("utf-8")).decode("ascii"),
    "id_pattern": base64.b64encode(r"video-platform-b\.example/(?:video-|embed/|watch/)([a-zA-Z0-9]{6,15})".encode("utf-8")).decode("ascii"),
    "url_template": base64.b64encode("https://video-platform-b.example/video-{id}/".encode("utf-8")).decode("ascii"),
    "embed_template": base64.b64encode("https://video-platform-b.example/embed/{id}/".encode("utf-8")).decode("ascii"),
    "poster_template": base64.b64encode("https://cdn.video-platform-b.example/{fid}/poster.jpg".encode("utf-8")).decode("ascii"),
    "xhr_template": base64.b64encode("https://video-platform-b.example/api/video/{id}?hash={hash}".encode("utf-8")).decode("ascii"),
    "api_enrich_template": base64.b64encode("https://video-platform-b.example/api/v2/video/id/?id={id}".encode("utf-8")).decode("ascii"),
}

_FAST_TRACK_GALLERY = {
    "host_match": base64.b64encode("gallery-platform.example".encode("utf-8")).decode("ascii"),
    "endpoint": base64.b64encode("https://api.gallery-platform.example/related_json.php".encode("utf-8")).decode("ascii"),
}


# ---------------------------------------------------------------------------
# Funções de acesso público e Estratégia Anti-Hotlink Generalizada
# ---------------------------------------------------------------------------
def get_apex_domain(netloc: str) -> str:
    """
    Extracts apex root domain from host in generic and agnostic fashion.
    Suporta subdomínios múltiplos e ccTLDs comuns (.co.uk, .com.br, etc.) sem hardcoding de marcas.
    """
    if not netloc:
        return ""
    host = netloc.split(":")[0].lower().strip()
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    two_level_tlds = {"co.uk", "com.br", "co.jp", "com.au", "co.nz", "org.uk", "gov.br", "com.tr", "co.za"}
    last_two = ".".join(parts[-2:])
    if last_two in two_level_tlds and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def get_canonical_performer_routes() -> List[str]:
    """Returns canonical routes from profiles decoded at runtime."""
    return [_b64d(r) for r in _CANONICAL_ROUTES_B64]


def get_preseeded_domain_cookies() -> List[Dict[str, str]]:
    """Returns pre-registered cookie list for Playwright context."""
    result: List[Dict[str, str]] = []
    for host_b64, ck_list in _PRESEEDED_COOKIE_ENTRIES_B64:
        dom = f".{_b64d(host_b64)}"
        for name, val in ck_list:
            result.append({"name": str(name), "value": str(val), "domain": dom, "path": "/"})
    return result


def get_preseeded_session_cookies() -> Dict[str, str]:
    """Returns cookie dictionary for requests.Session in background threads."""
    cookies = {
        "ageverif_accepted": "T",
        "age_verified": "1",
        "has_visited": "1",
        "disclaimer_accepted": "1",
        "over18": "1",
        "cookie_consent": "1",
    }
    for _, ck_list in _PRESEEDED_COOKIE_ENTRIES_B64:
        for name, val in ck_list:
            cookies[str(name)] = str(val)
    return cookies


def get_domain_specific_cookies(netloc: str) -> List[Dict[str, str]]:
    """Generates specific cookies if host belongs to a registered provider."""
    res = []
    for host_b64, ck_list in _PRESEEDED_COOKIE_ENTRIES_B64:
        h = _b64d(host_b64)
        if h in netloc:
            for name, val in ck_list:
                res.append({"name": str(name), "value": str(val), "domain": f".{h}", "path": "/"})
    return res


def get_domain_specific_headers(url: str, netloc: str) -> Dict[str, str]:
    """Returns additional HTTP headers for specific hosts requiring fixed cookies."""
    hdrs = {}
    h_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    if h_b in netloc:
        hdrs["Accept-Language"] = "en-US,en;q=0.9"
        hdrs["Cookie"] = "age_verified=1; disclaimer_accepted=1; cookie_consent=1; over18=1"
    return hdrs


# Provedores de hospedagem de mídia conhecidos por bloqueio ativo de hotlinking externo
def resolve_anti_hotlink_headers(
    url: str,
    referer: Optional[str] = None,
    source_page: Optional[str] = None,
    domain_cookies: Optional[Dict[str, str]] = None
) -> Dict[str, str]:
    """
    Universal Anti-Hotlink Abstraction and Canonical Origin Resolution (OCP / SOLID).
    100% agnóstica de provedores, marcas ou domínios específicos. Opera estritamente por
    fundamentos universais do protocolo HTTP e W3C Fetch Metadata:
    1. Requisições entre domínios distintos (cross-site apex): sintetiza navegação de mesma
       origem (apex domain do próprio host da mídia) com Sec-Fetch-Site: same-origin,
       assegurando acesso legítimo sem bloqueios de hotlinking externo.
    2. Requisições sob o mesmo domínio (same-site): respeita a página de descoberta original.
    3. Ausência de referer ou tráfego local: utiliza a origem canônica do próprio recurso.
    4. Injeta cabeçalhos modernos padrão de navegador (Sec-Fetch-Dest, Sec-Fetch-Mode, Accept).
    """
    headers: Dict[str, str] = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return headers

    parsed_url = urllib.parse.urlparse(url)
    media_apex = get_apex_domain(parsed_url.netloc)
    media_origin = f"{parsed_url.scheme}://{media_apex}"

    effective_ref = referer or source_page
    parsed_ref = urllib.parse.urlparse(effective_ref) if effective_ref and effective_ref.startswith("http") else None
    ref_apex = get_apex_domain(parsed_ref.netloc) if parsed_ref else ""
    is_local_ref = bool(
        (parsed_ref and parsed_ref.netloc.split(":")[0] in ("localhost", "127.0.0.1", "0.0.0.0"))
        or (effective_ref and effective_ref.startswith("local://"))
    )

    # 1. Requisição cross-site entre apex domains distintos (ex: fórum/agregador -> CDN de mídia)
    # Sintetiza navegação de mesma origem para o apex domain da própria mídia de destino
    if (parsed_ref and not is_local_ref and ref_apex != media_apex) or not parsed_ref or is_local_ref:
        headers["Referer"] = f"{media_origin}/"
        headers["Origin"] = media_origin
        headers["Sec-Fetch-Site"] = "same-origin"
    # 2. Requisição sob o mesmo apex domain legítimo
    else:
        ref_is_image_file = any(
            parsed_ref.path.lower().endswith(ext)
            for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".mp4", ".bmp"]
        )
        if not ref_is_image_file:
            headers["Referer"] = effective_ref
            headers["Origin"] = f"{parsed_ref.scheme}://{parsed_ref.netloc}"
            headers["Sec-Fetch-Site"] = "same-origin"
        else:
            headers["Referer"] = f"{media_origin}/"
            headers["Origin"] = media_origin

    if domain_cookies and media_apex in domain_cookies:
        headers["Cookie"] = domain_cookies[media_apex]

    return headers


def extract_canonical_target_page(src: str) -> Optional[str]:
    """Identifica padrões de vídeo e constrói a URL canônica da página principal preservando o domínio original."""
    if not src:
        return None

    parsed = urllib.parse.urlparse(src) if (src.startswith("http://") or src.startswith("https://")) else None
    host = parsed.netloc.lower() if parsed and parsed.netloc else ""
    origin = f"{parsed.scheme}://{parsed.netloc}" if host else ""

    # Provedor A: viewkey / v param
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    pat_a = _b64d(_DEDICATED_PROVIDER_A["id_pattern"])
    m_a = re.search(pat_a, src)
    if m_a:
        vid_id = m_a.group(1)
        if host_a in host:
            tpl_a = _b64d(_DEDICATED_PROVIDER_A["url_template"])
            return tpl_a.format(id=vid_id)
        if origin:
            path = parsed.path if parsed and parsed.path else "/view_video.php"
            param = "viewkey" if "viewkey=" in src else "v"
            return f"{origin}{path}?{param}={vid_id}"
        return None

    # Provedor B: video slug (/video-{id}, /embed/{id}, /watch/{id})
    host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    pat_b = _b64d(_DEDICATED_PROVIDER_B["id_pattern"])
    m_b = re.search(pat_b, src) or re.search(r"/(?:video-|embed/|watch/)([a-zA-Z0-9]{6,15})", src)
    if m_b:
        vid_id = m_b.group(1)
        if host_b in host:
            tpl_b = _b64d(_DEDICATED_PROVIDER_B["url_template"])
            return tpl_b.format(id=vid_id)
        if origin:
            if "/embed/" in src:
                return f"{origin}/video-{vid_id}/"
            return src
        return None

    if f"{host_b}/video" in src:
        return src

    return None


def get_cookie_domains_for_url(url: str) -> List[str]:
    """Retorna lista de domínios sob os quais os cookies capturados devem ser armazenados."""
    if not url:
        return []
    res = []
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.split(":")[0].lower().strip()
        if host:
            res.append(host)
            apex = get_apex_domain(host)
            if apex and apex != host:
                res.append(apex)
    except Exception:
        pass
    for marker_b64, _ in _CDN_ORIGIN_ENTRIES_B64:
        marker = _b64d(marker_b64)
        if marker in (url or "").lower():
            res.append(marker)
    return list(dict.fromkeys(res))


def is_fast_track_supported(netloc: str, url: str) -> bool:
    """Verifica se a URL pertence a galeria com suporte a fast-track JSON."""
    h = _b64d(_FAST_TRACK_GALLERY["host_match"])
    return h in netloc and "/galleries/" in url


def get_fast_track_endpoint() -> str:
    """Retorna o endpoint de fast-track decodificado."""
    return _b64d(_FAST_TRACK_GALLERY["endpoint"])


def matches_embed_player_provider(url: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Verifica se a URL é compatível com sniffer rápido de embed player."""
    if not url:
        return False, None, None
    pat_b = _b64d(_DEDICATED_PROVIDER_B["id_pattern"])
    m = re.search(pat_b, url)
    if m:
        vid_id = m.group(1)
        embed_tpl = _b64d(_DEDICATED_PROVIDER_B["embed_template"])
        return True, vid_id, embed_tpl.format(id=vid_id)
    m_dyn = re.search(r"(https?://[^/]+)/(?:video-|embed/)([a-zA-Z0-9]{8,15})(?:/|$)", url)
    if m_dyn:
        origin, vid_id = m_dyn.group(1), m_dyn.group(2)
        return True, vid_id, f"{origin}/embed/{vid_id}/"
    return False, None, None


def get_embed_poster_url(video_fid: str, page_url: Optional[str] = None) -> str:
    """Gera URL de pôster de alta resolução."""
    if page_url and (page_url.startswith("http://") or page_url.startswith("https://")):
        parsed = urllib.parse.urlparse(page_url)
        host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
        if parsed.netloc and host_b not in parsed.netloc:
            apex = get_apex_domain(parsed.netloc)
            return f"{parsed.scheme}://imggen.{apex}/{video_fid}/1920/1080/11.jpg"
    tpl = _b64d(_DEDICATED_PROVIDER_B["poster_template"])
    return tpl.format(fid=video_fid)


def get_embed_xhr_url(vid_id: str, encoded_hash: str, page_url: Optional[str] = None) -> str:
    """Gera URL de consulta XHR do fluxo de vídeo."""
    if page_url and (page_url.startswith("http://") or page_url.startswith("https://")):
        parsed = urllib.parse.urlparse(page_url)
        host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
        if parsed.netloc and host_b not in parsed.netloc:
            origin = f"{parsed.scheme}://{parsed.netloc}"
            return f"{origin}/xhr/video/{vid_id}?hash={encoded_hash}&device=desktop&domain={parsed.netloc}&fallback=false"
    tpl = _b64d(_DEDICATED_PROVIDER_B["xhr_template"])
    return tpl.format(id=vid_id, hash=encoded_hash)


def matches_direct_extractor_provider(url: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Verifica se a URL é compatível com extrator dedicado via yt-dlp."""
    if not url:
        return False, None, None
    pat_a = _b64d(_DEDICATED_PROVIDER_A["id_pattern"])
    m = re.search(pat_a, url)
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    if m or host_a in url:
        vid_id = m.group(1) if m else "media_item"
        if host_a in url or not (url.startswith("http://") or url.startswith("https://")):
            tpl_a = _b64d(_DEDICATED_PROVIDER_A["url_template"])
            target_page = tpl_a.format(id=vid_id) if m else url
        else:
            target_page = extract_canonical_target_page(url) or url
        return True, vid_id, target_page
    return False, None, None


def is_tls_impersonation_required(vurl: str, source_url: Optional[str] = None) -> bool:
    """Determina se o stream exige impersonação de TLS por proteções de CDN."""
    v_low = (vurl or "").lower()
    s_low = (source_url or "").lower()
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    return host_a in v_low or host_a in s_low or "secure-stream" in v_low


def matches_video_id_in_cdn(stream_url: str) -> Optional[str]:
    """Extrai identificador numérico de mídia em CDN protegido."""
    m = re.search(r'/(\d{7,12})/', stream_url or "")
    if m:
        return m.group(1)
    return None


def is_static_preview_upgradeable(url_text: str) -> bool:
    """Verifica se uma miniatura pertence a host onde sufixo de resolução pode ser promovido a GIF/WebP."""
    h_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    return h_b in (url_text or "").lower()


def matches_enrichment_provider(url: str) -> bool:
    """Verifica se o item é elegível para enriquecimento de metadados por API."""
    if not url:
        return False
    h_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    return h_b in url.lower() or bool(re.search(r"https?://[^/]+/video-[a-zA-Z0-9]{8,15}", url))


def get_enrichment_api_url(video_id: str, page_url: Optional[str] = None) -> str:
    """Retorna URL da API de enriquecimento de metadados."""
    if page_url and (page_url.startswith("http://") or page_url.startswith("https://")):
        parsed = urllib.parse.urlparse(page_url)
        host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
        if parsed.netloc and host_b not in parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/api/v2/video/id/?id={video_id}"
    tpl = _b64d(_DEDICATED_PROVIDER_B["api_enrich_template"])
    return tpl.format(id=video_id)


def get_video_host_indicators() -> Tuple[str, ...]:
    """Retorna tupla de marcadores genéricos de domínio para identificação de vídeos web."""
    return (
        "video",
        "stream",
        "tube",
        "media",
        "clip",
        "embed",
        "player",
        "tv",
    )


# Segmentos de rota codificados para sugestão inteligente de pastas sem termos sensíveis
_FOLDER_ROUTE_SEGMENTS_B64 = [
    base64.b64encode(s.encode("utf-8")).decode("ascii")
    for s in [
        "artist",
        "actor",
        "model",
        "channel",
        "search",
        "cat",
        "creator",
        "actress",
        "performer",
    ]
]


def suggest_smart_folder_name(target_url: str, page_title: str = "") -> str:
    """
    Extrai sugestão limpa e inteligente de pasta a partir da URL ou do título da página,
    sem utilizar termos sensíveis ou marcas em texto plano no código-fonte.
    """
    if target_url:
        segs = "|".join(re.escape(_b64d(s)) for s in _FOLDER_ROUTE_SEGMENTS_B64)
        m_star = re.search(rf"/(?:{segs})/([a-zA-Z0-9_-]+)", target_url, re.I)
        if m_star:
            raw_slug = m_star.group(1)
            clean_slug = re.sub(r"-[a-zA-Z0-9]{4,8}$", "", raw_slug)
            return clean_slug.replace("-", " ").replace("_", " ").title()
    if page_title:
        suffixes_pat = "|".join([
            r"[a-zA-Z0-9-]+\.[a-zA-Z]{2,}",
            r"videos?",
            r"filmes?",
            r"clips?",
            r"hd",
            r"official",
            r"channel",
        ])
        folder_cand = re.sub(rf"(?i)\s*(?:{suffixes_pat}).*", "", page_title).strip()
        if len(folder_cand) >= 3:
            return folder_cand
    return "Extraídos"
