"""
Deterministic Browser Tools for the AI-First Agent.
These tools gather objective DOM facts, inspect elements, analyze containers,
intercept network resources, and explore detail pages without making decisions.
"""

import re
import asyncio
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
try:
    from playwright.async_api import Page
except ImportError:
    Page = Any

from ..core.models import (
    DOMCandidateInfo,
    LinkCandidate,
    SemanticRegionType,
)
from .engine import BrowserEngine


class BrowserTools:
    """
    Exposes deterministic inspection tools to the AI reasoning engine.
    """

    def __init__(self, engine: BrowserEngine):
        self.engine = engine

    def get_network_resources(self) -> List[Dict[str, Any]]:
        """Returns captured network resources from the active browser session."""
        return self.engine.network_resources

    def parse_srcset_candidates(self, srcset_str: str, base_url: str) -> List[Dict[str, Any]]:
        """
        Parses srcset attribute string and returns candidate URLs sorted by width descriptor descending.
        """
        if not srcset_str:
            return []
        candidates = []
        # Pattern matches: URL + optional descriptor e.g. "image.jpg 3840w" or "image.jpg 2x"
        parts = re.findall(r'(\S+)(?:\s+([\d\.]+[wx]))?', srcset_str)
        for url_part, desc in parts:
            full_url = urljoin(base_url, url_part.strip())
            desc_val = 1
            if desc:
                if desc.endswith('w'):
                    try:
                        desc_val = int(desc[:-1])
                    except Exception:
                        pass
                elif desc.endswith('x'):
                    try:
                        desc_val = int(float(desc[:-1]) * 1000)
                    except Exception:
                        pass
            candidates.append({"url": full_url, "descriptor": desc or "", "val": desc_val})
        candidates.sort(key=lambda x: x["val"], reverse=True)
        return candidates

    async def _safe_eval(self, page: Page, script: str, retries: int = 3) -> Any:
        """Executes JavaScript on page with resilience against execution context destruction during navigation."""
        for attempt in range(retries):
            try:
                return await page.evaluate(script)
            except Exception as e:
                if "context was destroyed" in str(e).lower() and attempt < retries - 1:
                    await asyncio.sleep(0.6)
                    continue
                raise

    async def inspect_page(self) -> Dict[str, Any]:
        """
        Extracts structural facts from the active page:
        Title, headings, meta tags, primary containers, images summary, links summary.
        """
        page = self.engine.main_page
        current_url = page.url

        dom_summary = await self._safe_eval(page, """() => {
            const getSelector = (el) => {
                if (!el) return '';
                if (el.id) return '#' + el.id;
                let sel = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') {
                    const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
                    if (cls) sel += '.' + cls;
                }
                return sel;
            };

            const containers = [];
            document.querySelectorAll('div, section, main, ul, article').forEach(el => {
                const imgCount = el.querySelectorAll(':scope > div img, :scope > li img, :scope > a img, :scope > img').length;
                if (imgCount >= 3) {
                    containers.push({
                        selector: getSelector(el),
                        id: el.id || null,
                        className: el.className || '',
                        directImageCount: imgCount,
                        childCount: el.children.length,
                        textSnippet: el.innerText ? el.innerText.slice(0, 100).replace(/\\s+/g, ' ') : ''
                    });
                }
            });

            const headings = [];
            document.querySelectorAll('h1, h2, h3').forEach(h => {
                const text = h.innerText.trim();
                if (text) {
                    headings.push({
                        level: h.tagName.toLowerCase(),
                        text: text
                    });
                }
            });

            return {
                title: document.title ? document.title.trim() : '',
                url: window.location.href,
                containers: containers,
                headings: headings,
                total_images: document.querySelectorAll('img').length,
                total_links: document.querySelectorAll('a').length,
            };
        }""")

        return dom_summary

    async def get_image_candidates(self) -> List[DOMCandidateInfo]:
        """
        Extracts all image elements with extensive lazy-loading resolution,
        deep scrolling to trigger intersection observers, container detection,
        and parent anchor extraction.
        """
        page = self.engine.main_page
        current_url = page.url

        # Multi-tier synchronous scroll to trigger all IntersectionObservers and lazy loaders
        try:
            await page.evaluate("""() => {
                const h = document.body.scrollHeight || 3000;
                window.scrollTo(0, Math.floor(h * 0.33));
                window.scrollTo(0, Math.floor(h * 0.66));
                window.scrollTo(0, h);
                window.scrollTo(0, 0);
            }""")
        except Exception:
            pass

        raw_candidates = await page.evaluate("""() => {
            const getBestSelector = (el) => {
                if (!el) return '';
                if (el.id) return '#' + el.id;
                let path = [];
                let curr = el;
                while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'body') {
                    let sel = curr.tagName.toLowerCase();
                    if (curr.id) {
                        path.unshift('#' + curr.id);
                        break;
                    }
                    if (curr.className && typeof curr.className === 'string' && curr.className.trim().length > 0) {
                        const cls = curr.className.trim().split(/\\s+/)[0];
                        if (cls) sel += '.' + cls;
                    }
                    path.unshift(sel);
                    curr = curr.parentElement;
                }
                return path.join(' > ');
            };

            const isDynamicId = (id) => {
                if (!id) return true;
                return /^[a-zA-Z]*[0-9]{3,}$/.test(id) || /^(item|post|thumb|img|pic|card|node|ah|media)[-_]?[0-9]+/i.test(id) || /^[0-9]+$/.test(id);
            };

            const findContainer = (img) => {
                let curr = img.parentElement;
                while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'body') {
                    if (curr.className && typeof curr.className === 'string' && curr.className.trim().length > 0) {
                        const classes = curr.className.trim().split(/\\s+/);
                        for (const cls of classes) {
                            const clsLower = cls.toLowerCase();
                            if (clsLower.includes('grid') || clsLower.includes('gallery') || clsLower.includes('album') || 
                                clsLower.includes('tiles') || clsLower.includes('thumb') || clsLower.includes('photo') || 
                                clsLower.includes('items') || clsLower.includes('list') || clsLower.includes('container') ||
                                clsLower.includes('wrapper') || clsLower.includes('mb-') || clsLower.includes('col-')) {
                                return '.' + cls;
                            }
                        }
                    }
                    if (curr.id && !isDynamicId(curr.id)) {
                        return '#' + curr.id;
                    }
                    curr = curr.parentElement;
                }
                const p = img.parentElement;
                if (p) {
                    if (p.className && typeof p.className === 'string' && p.className.trim().length > 0) {
                        return '.' + p.className.trim().split(/\\s+/)[0];
                    }
                    return p.tagName.toLowerCase();
                }
                return 'body';
            };

            const images = document.querySelectorAll('img');
            const list = [];

            images.forEach((img, idx) => {
                const rect = img.getBoundingClientRect();
                const dataset = {};
                for (const k in img.dataset) {
                    dataset[k] = img.dataset[k];
                }

                // Check parent anchor
                let parentAnchor = null;
                let p = img.parentElement;
                while (p && p.tagName && p.tagName.toLowerCase() !== 'body') {
                    if (p.tagName.toLowerCase() === 'a') {
                        parentAnchor = p;
                        break;
                    }
                    p = p.parentElement;
                }

                // Sibling info
                const parent = img.parentElement;
                const siblings = parent ? Array.from(parent.children) : [];
                const siblingIdx = siblings.indexOf(img);

                // Surrounding text context
                let surroundingText = '';
                if (img.parentElement) {
                    surroundingText = img.parentElement.innerText ? img.parentElement.innerText.trim().slice(0, 100) : '';
                }

                // Exhaustive Lazy-Load Attribute Inspection
                let bestSrc = '';
                const candidates_urls = [
                    img.getAttribute('src'),
                    img.currentSrc,
                    img.getAttribute('data-src'),
                    img.getAttribute('data-lazy-src'),
                    img.getAttribute('data-lazy'),
                    img.getAttribute('data-original'),
                    img.getAttribute('data-full'),
                    img.getAttribute('data-large'),
                    img.getAttribute('data-thumb'),
                    img.getAttribute('data-url'),
                    img.dataset['src'],
                    img.dataset['lazySrc'],
                    img.dataset['original'],
                    img.dataset['full'],
                    img.dataset['large'],
                    img.dataset['thumb'],
                    img.dataset['image'],
                    img.src
                ];

                for (const u of candidates_urls) {
                    if (u && typeof u === 'string' && u.trim().length > 4) {
                        const clean = u.trim();
                        const lower = clean.toLowerCase();
                        if (!clean.startsWith('data:image') && 
                            !lower.includes('1px.png') && 
                            !lower.includes('1px.gif') && 
                            !lower.includes('blank.gif') && 
                            !lower.includes('spacer.gif') && 
                            !lower.includes('pixel.gif') && 
                            !lower.includes('transparent.png')) {
                            bestSrc = clean;
                            break;
                        }
                    }
                }

                if (!bestSrc || bestSrc.includes('1px.png')) {
                    if (parentAnchor && parentAnchor.href && parentAnchor.href.match(/\.(jpg|jpeg|png|webp)/i)) {
                        bestSrc = parentAnchor.href;
                    } else {
                        bestSrc = img.src || img.getAttribute('src') || '';
                    }
                }

                list.push({
                    candidate_id: 'img_' + idx,
                    selector: getBestSelector(img),
                    src: bestSrc,
                    current_src: img.currentSrc || '',
                    width: Math.round(rect.width || img.naturalWidth || parseInt(img.getAttribute('width')) || 300),
                    height: Math.round(rect.height || img.naturalHeight || parseInt(img.getAttribute('height')) || 450),
                    alt: img.alt || '',
                    title: img.title || '',
                    classes: img.className && typeof img.className === 'string' ? img.className.trim().split(/\\s+/) : [],
                    parent_tag: img.parentElement ? img.parentElement.tagName.toLowerCase() : null,
                    parent_href: parentAnchor ? parentAnchor.href : null,
                    container_selector: findContainer(img),
                    container_id: img.closest('[id]') ? img.closest('[id]').id : null,
                    container_class: img.closest('[class]') ? img.closest('[class]').className : null,
                    sibling_index: siblingIdx >= 0 ? siblingIdx : 0,
                    total_siblings: siblings.length,
                    dataset: dataset,
                    srcset: img.getAttribute('srcset') || null,
                    is_displayed: rect.width > 0 && rect.height > 0 && window.getComputedStyle(img).display !== 'none',
                    surrounding_text: surroundingText,
                    media_type: (bestSrc && (bestSrc.toLowerCase().includes('.gif') || bestSrc.toLowerCase().startsWith('data:image/gif'))) ? 'gif' : 'image',
                    is_animated: !!(bestSrc && (bestSrc.toLowerCase().includes('.gif') || bestSrc.toLowerCase().startsWith('data:image/gif')))
                });
            });

            return list;
        }""")

        candidates: List[DOMCandidateInfo] = []
        for raw in raw_candidates:
            # Resolve relative src to absolute URL
            src = raw.get("src") or ""
            if src and not (src.startswith("http://") or src.startswith("https://") or src.startswith("data:")):
                src = urljoin(current_url, src)
                raw["src"] = src

            parent_href = raw.get("parent_href") or ""
            if parent_href and not (parent_href.startswith("http://") or parent_href.startswith("https://")):
                parent_href = urljoin(current_url, parent_href)
                raw["parent_href"] = parent_href

            candidates.append(DOMCandidateInfo(**raw))

        return candidates

    async def get_video_candidates(self) -> List[DOMCandidateInfo]:
        """
        Discovers all HTML5 <video> elements, direct video download links, iframe embeds,
        and sniffed media streams on the active page.
        """
        page = self.engine.main_page
        current_url = page.url

        raw_videos = await self._safe_eval(page, """() => {
            const list = [];
            const seenUrls = new Set();

            const getBestSelector = (el) => {
                if (!el) return '';
                if (el.id) return '#' + el.id;
                let path = [];
                let curr = el;
                while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'body') {
                    let sel = curr.tagName.toLowerCase();
                    if (curr.id) {
                        path.unshift('#' + curr.id);
                        break;
                    }
                    if (curr.className && typeof curr.className === 'string' && curr.className.trim().length > 0) {
                        const cls = curr.className.trim().split(/\\s+/)[0];
                        if (cls) sel += '.' + cls;
                    }
                    path.unshift(sel);
                    curr = curr.parentElement;
                }
                return path.join(' > ');
            };

            // 1. HTML5 <video> elements
            document.querySelectorAll('video').forEach((vid, idx) => {
                const rect = vid.getBoundingClientRect();
                const sources = [];

                if (vid.src) sources.push(vid.src);
                if (vid.currentSrc) sources.push(vid.currentSrc);

                // Standard data attributes for lazy/deferred video loading
                [
                    'data-src', 'data-video-url', 'data-url', 'data-mp4',
                    'data-video-src', 'data-stream-url', 'data-file',
                    'data-hls', 'data-manifest', 'data-hlssrc'
                ].forEach(attr => {
                    const val = vid.getAttribute(attr);
                    if (val) sources.push(val);
                });

                // data-vid is common in video streaming players - store as extra hint
                const dataVid = vid.getAttribute('data-vid') || vid.getAttribute('data-id') ||
                                vid.getAttribute('data-hash') || vid.getAttribute('data-videoid') || '';

                vid.querySelectorAll('source').forEach(s => {
                    if (s.src) sources.push(s.src);
                    ['data-src', 'data-url'].forEach(attr => {
                        const val = s.getAttribute(attr);
                        if (val) sources.push(val);
                    });
                });

                const cleanSources = Array.from(new Set(sources.filter(s => s && typeof s === 'string' && s.trim().length > 5)));
                const primarySrc = cleanSources[0] || '';
                const poster = vid.poster || vid.getAttribute('data-poster') || vid.getAttribute('data-thumb') ||
                               vid.getAttribute('data-preview') || vid.getAttribute('data-image') || '';

                // Include if any usable source OR poster OR data-vid hint present
                if (!primarySrc && !poster && !dataVid) return;

                // Ignore recommendation preview teaser clips (hover snippets from recommendation sidebars)
                const isPreviewSnippet = /video-preview\.s3\.yandex\.net|heat-preview|preview_.*\.mp4/i.test(primarySrc || '');
                if (isPreviewSnippet) return;

                const isLoopMuted = vid.hasAttribute('loop') && (vid.hasAttribute('muted') || vid.muted);

                list.push({
                    candidate_id: 'vid_' + idx,
                    selector: getBestSelector(vid),
                    tag_name: 'video',
                    src: primarySrc || poster,
                    current_src: vid.currentSrc || primarySrc,
                    width: Math.round(rect.width || vid.videoWidth || 640),
                    height: Math.round(rect.height || vid.videoHeight || 360),
                    title: vid.title || vid.getAttribute('aria-label') || ('Vídeo #' + (idx + 1)),
                    poster_url: poster,
                    duration_seconds: vid.duration && !isNaN(vid.duration) ? vid.duration : null,
                    is_animated: isLoopMuted,
                    media_type: 'video',
                    video_sources: cleanSources,
                    is_displayed: rect.width > 0 && rect.height > 0,
                    data_vid: dataVid
                });
                if (primarySrc) seenUrls.add(primarySrc);
            });

            // 2. Direct Video Links <a href="...mp4"> or download links
            const videoExtRegex = /\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i;
            document.querySelectorAll('a[href]').forEach((a, idx) => {
                const href = a.href;
                const isDirectDload = href.includes('/dload/') || href.includes('/download/') || a.hasAttribute('download');
                if (href && (videoExtRegex.test(href) || isDirectDload) && !seenUrls.has(href)) {
                    seenUrls.add(href);
                    const imgChild = a.querySelector('img');
                    const poster = imgChild ? (imgChild.currentSrc || imgChild.src || '') : '';
                    let rawTitle = a.innerText ? a.innerText.trim() : (imgChild?.alt || ('Vídeo Link #' + (idx + 1)));

                    // Extract quality label (e.g. 2160p / 4K, 1080p, 720p, 480p, 360p, 240p)
                    let quality = '';
                    const matchQ = (href + ' ' + rawTitle).match(/(2160p|1440p|1080p|720p|480p|360p|240p|4k|2k|fhd|hd)/i);
                    if (matchQ) {
                        quality = matchQ[1].toUpperCase();
                    }

                    let w = 1280, h = 720;
                    if (quality.includes('2160') || quality === '4K') { w = 3840; h = 2160; }
                    else if (quality.includes('1440') || quality === '2K') { w = 2560; h = 1440; }
                    else if (quality.includes('1080') || quality === 'FHD') { w = 1920; h = 1080; }
                    else if (quality.includes('720') || quality === 'HD') { w = 1280; h = 720; }
                    else if (quality.includes('480')) { w = 854; h = 480; }
                    else if (quality.includes('360')) { w = 640; h = 360; }
                    else if (quality.includes('240')) { w = 426; h = 240; }

                    const titleWithQuality = quality && !rawTitle.toUpperCase().includes(quality)
                        ? `[${quality}] ${rawTitle}`
                        : rawTitle;

                    list.push({
                        candidate_id: 'vlink_' + idx,
                        selector: getBestSelector(a),
                        tag_name: 'a',
                        src: href,
                        current_src: href,
                        width: w,
                        height: h,
                        title: titleWithQuality || 'Vídeo Link',
                        poster_url: poster,
                        media_type: 'video',
                        video_sources: [href],
                        is_displayed: true
                    });
                }
            });

            // 3. Video Iframes (YouTube, Vimeo, Twitter, Streamable, etc.)
            const embedDomains = ['youtube.com/embed', 'player.vimeo.com', 'streamable.com', 'dailymotion.com/embed', 'redgifs.com/ifr', 'gfycat.com/ifr'];
            document.querySelectorAll('iframe[src]').forEach((iframe, idx) => {
                const src = iframe.src;
                if (src && embedDomains.some(d => src.includes(d)) && !seenUrls.has(src)) {
                    seenUrls.add(src);
                    list.push({
                        candidate_id: 'embed_' + idx,
                        selector: getBestSelector(iframe),
                        tag_name: 'iframe',
                        src: src,
                        current_src: src,
                        width: Math.round(iframe.clientWidth || 640),
                        height: Math.round(iframe.clientHeight || 360),
                        title: iframe.title || ('Vídeo Embed #' + (idx + 1)),
                        poster_url: '',
                        media_type: 'video',
                        video_sources: [src],
                        is_displayed: true
                    });
                }
            });

            return list;
        }""")

        candidates: List[DOMCandidateInfo] = []
        for raw in raw_videos:
            src = raw.get("src") or ""
            data_vid = raw.pop("data_vid", "")  # extract extra hint, not in model

            if src and not (src.startswith("http://") or src.startswith("https://")):
                src = urljoin(current_url, src)
                raw["src"] = src

            poster = raw.get("poster_url") or ""
            if poster and not (poster.startswith("http://") or poster.startswith("https://") or poster.startswith("data:")):
                poster = urljoin(current_url, poster)
                raw["poster_url"] = poster

            abs_sources = []
            for s in raw.get("video_sources", []):
                if s and not (s.startswith("http://") or s.startswith("https://")):
                    s = urljoin(current_url, s)
                abs_sources.append(s)
            raw["video_sources"] = abs_sources

            # If we have a data-vid path hint, try to build a direct CDN URL
            # Player pattern: data-vid="hash/hash.mp4" -> build URL from page domain hint
            if data_vid and not raw.get("src") and not raw.get("video_sources"):
                # will be resolved via network sniff fallback below
                raw["src"] = raw.get("poster_url", "")

            candidates.append(DOMCandidateInfo(**raw))

        # 4. Check intercepted network media resources — prefer HLS master manifests
        seen_srcs = set(c.src for c in candidates)

        # Collect all HLS URLs and deduplicate to master manifests
        hls_urls = {}
        mp4_urls_net = {}
        for res in self.engine.network_resources:
            r_url = res.get("url", "")
            c_type = res.get("content_type", "")
            if not r_url or r_url.startswith("data:"):
                continue

            is_hls = ".m3u8" in r_url.lower() or "mpegurl" in c_type
            is_mp4 = "video/mp4" in c_type or r_url.lower().endswith(".mp4")
            is_webm = "video/webm" in c_type or r_url.lower().endswith(".webm")

            if is_hls:
                # Prefer master manifests (no quality suffix like _240p, _360p) and deduplicate by base video ID
                # Extract a key from URL to group variants of the same video
                import re as _re
                vid_id_match = _re.search(r'/(\d+)/', r_url)
                vid_key = vid_id_match.group(1) if vid_id_match else r_url
                is_init = "_init_" in r_url or "_h264_init" in r_url
                is_segment = _re.search(r'_h264_\d+_', r_url)
                is_240p_only = "_240p" in r_url and ("_480p" not in r_url and "_720p" not in r_url and "_1080p" not in r_url)

                if not is_init and not is_segment:
                    # This is a manifest (master or quality)
                    if vid_key not in hls_urls:
                        hls_urls[vid_key] = r_url
                    else:
                        # Prefer higher quality: replace 240p with better if found
                        existing = hls_urls[vid_key]
                        if "_240p" in existing and "_240p" not in r_url:
                            hls_urls[vid_key] = r_url

            elif is_mp4 or is_webm:
                # Only keep init segments or short clips, skip HLS fragments
                is_segment = "_h264_" in r_url and any(
                    f"_{q}p_h264_" in r_url for q in ["240", "360", "480", "720", "1080"]
                ) and not "_init_" in r_url
                if not is_segment:
                    mp4_urls_net[r_url] = c_type

        # Add best HLS stream per video
        for idx, (vid_key, hls_url) in enumerate(hls_urls.items()):
            if hls_url not in seen_srcs:
                seen_srcs.add(hls_url)
                candidates.append(DOMCandidateInfo(
                    candidate_id=f"hls_{idx}",
                    selector="network_resource",
                    tag_name="network",
                    src=hls_url,
                    current_src=hls_url,
                    width=1280,
                    height=720,
                    title=f"HLS Stream #{idx + 1}",
                    poster_url="",
                    media_type="video",
                    video_sources=[hls_url],
                    is_displayed=True
                ))

        # Add direct MP4s from network
        for idx, (mp4_url, ctype) in enumerate(mp4_urls_net.items()):
            if mp4_url not in seen_srcs:
                seen_srcs.add(mp4_url)
                candidates.append(DOMCandidateInfo(
                    candidate_id=f"net_mp4_{idx}",
                    selector="network_resource",
                    tag_name="network",
                    src=mp4_url,
                    current_src=mp4_url,
                    width=640,
                    height=360,
                    title=f"Vídeo Detectado #{len(candidates) + 1}",
                    poster_url="",
                    media_type="video",
                    video_sources=[mp4_url],
                    is_displayed=True
                ))

        # If we found HLS streams via network but the DOM <video> had empty src,
        # enrich the DOM candidate with the best HLS URL found
        if hls_urls:
            best_hls = list(hls_urls.values())[0]
            for c in candidates:
                if c.tag_name == "video" and (not c.src or c.src == c.poster_url):
                    c.src = best_hls
                    c.current_src = best_hls
        # Sort video candidates: Highest quality first (4K > 1440p > 1080p > 720p > 480p > 360p > 240p)
        def quality_score(c: DOMCandidateInfo) -> int:
            text = (c.src + " " + c.title + " " + " ".join(c.video_sources)).lower()
            if "2160" in text or "4k" in text:
                return 2160
            if "1440" in text or "2k" in text:
                return 1440
            if "1080" in text or "fhd" in text:
                return 1080
            if "720" in text or "hd" in text:
                return 720
            if ".m3u8" in text:
                return 700
            if "480" in text:
                return 480
            if "360" in text:
                return 360
            if "240" in text:
                return 240
            return c.height or c.width or 500

        candidates.sort(key=quality_score, reverse=True)
        return candidates

    async def get_all_media_candidates(self, media_filter: str = "all") -> List[DOMCandidateInfo]:
        """
        Returns media candidates filtered by requested type: 'all', 'images', 'videos', or 'gifs'.
        """
        if media_filter == "videos":
            return await self.get_video_candidates()

        img_candidates = await self.get_image_candidates()

        if media_filter == "images":
            return img_candidates  # Binary validation decides which image containers animate.

        if media_filter == "gifs":
            # URLs cannot tell whether WebP/PNG/AVIF (or an extensionless endpoint)
            # is animated. Keep image candidates until binary validation decides.
            gifs = img_candidates
            videos = await self.get_video_candidates()
            loop_videos = [v for v in videos if v.media_type == "gif" or v.is_animated]
            return gifs + loop_videos

        # 'all' -> combine both
        vid_candidates = await self.get_video_candidates()
        return img_candidates + vid_candidates

    async def get_dom_context(self, container_selector: str) -> Dict[str, Any]:
        """
        Analyzes a specific container in detail (homogeneity, child count, repetition).
        """
        page = self.engine.main_page
        return await page.evaluate(f"""() => {{
            const el = document.querySelector('{container_selector}');
            if (!el) return null;
            return {{
                selector: '{container_selector}',
                child_count: el.children.length,
                images_count: el.querySelectorAll('img').length,
                links_count: el.querySelectorAll('a').length,
                classes: el.className || '',
                id: el.id || '',
            }};
        }}""")

    async def get_links(self) -> List[LinkCandidate]:
        """
        Extracts link candidates with anchor text, position, surrounding context,
        and heuristics for album leads.
        """
        page = self.engine.main_page
        current_url = page.url

        raw_links = await page.evaluate("""() => {
            const links = [];
            const anchors = document.querySelectorAll('a[href]');
            const baseHost = window.location.host;

            anchors.forEach((a, idx) => {
                const text = a.innerText.trim();
                const href = a.href;
                const rect = a.getBoundingClientRect();
                const hasImg = a.querySelector('img') !== null;

                let isExternal = false;
                try {
                    const u = new URL(href);
                    isExternal = (u.host !== baseHost);
                } catch(e) {}

                links.push({
                    text: text,
                    url: href,
                    has_child_image: hasImg,
                    is_external: isExternal,
                    parent_tag: a.parentElement ? a.parentElement.tagName.toLowerCase() : null,
                    position: idx + 1,
                    surrounding_text: a.parentElement ? a.parentElement.innerText.trim().slice(0, 120) : '',
                    is_displayed: rect.width > 0 && rect.height > 0
                });
            });
            return links;
        }""")

        results: List[LinkCandidate] = []
        for lk in raw_links:
            url = lk.get("url") or ""
            text = lk.get("text") or ""
            surrounding = lk.get("surrounding_text") or ""

            # Score link as album candidate
            score = 0.5
            is_album = False

            # Positive indicators
            for kw in ["album", "gallery", "photoset", "vol.", "vol ", "chapter", "set", "view", "full"]:
                if kw in text.lower() or kw in url.lower() or kw in surrounding.lower():
                    score += 0.2
                    is_album = True

            # External links in forum threads
            if lk.get("is_external"):
                score += 0.15

            # Penalty for navigation links
            for nav in ["home", "login", "register", "contact", "about", "terms", "privacy", "faq", "rules"]:
                if nav in text.lower() or nav in url.lower():
                    score -= 0.4
                    is_album = False

            results.append(LinkCandidate(
                text=text,
                url=url,
                has_child_image=lk.get("has_child_image", False),
                is_external=lk.get("is_external", False),
                parent_tag=lk.get("parent_tag"),
                position=lk.get("position", 0),
                surrounding_text=surrounding,
                is_album_candidate=is_album,
                score=round(max(0.0, min(1.0, score)), 2)
            ))

        return results

    async def open_detail_page(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Opens link in a background tab via concurrency limiter, extracts DOM & media facts,
        and closes the tab cleanly.
        """
        return await self.engine.open_tab_and_inspect(url)

    async def extract_json_state(self) -> Dict[str, Any]:
        """
        Extracts JSON-LD scripts and window.__INITIAL_STATE__ / NEXT_DATA / NUXT from the page.
        """
        page = self.engine.main_page
        return await page.evaluate("""() => {
            const results = {
                json_ld: [],
                initial_state: null,
                next_data: null,
                nuxt_data: null
            };

            // 1. JSON-LD
            document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
                try {
                    results.json_ld.push(JSON.parse(s.innerText));
                } catch(e) {}
            });

            // 2. Window state
            if (window.__INITIAL_STATE__) {
                results.initial_state = window.__INITIAL_STATE__;
            }
            if (window.__NEXT_DATA__) {
                results.next_data = window.__NEXT_DATA__;
            }
            if (window.__NUXT__) {
                results.nuxt_data = window.__NUXT__;
            }

            return results;
        }""")
