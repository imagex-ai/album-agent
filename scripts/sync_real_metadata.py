"""
Script de sincronização de metadados reais de imagens (Content-Length e dimensões binárias).
Nenhum valor simulado/fake: consulta diretamente os servidores de origem HTTP/CDN.
"""

import asyncio
import glob
import io
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional
import httpx
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from src.core.network_profiles import resolve_anti_hotlink_headers

ALBUMS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "albums")


async def probe_image(
    client: httpx.AsyncClient,
    img: Dict[str, Any],
    referer: str,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Probes origin CDN for Content-Length and dimensions."""
    url = img.get("original_url") or img.get("thumbnail_url")
    if not url or not url.startswith("http"):
        return False

    needs_size = not img.get("file_size") or img.get("file_size") == 0
    needs_dims = not img.get("width") or img.get("width") == 0

    if not needs_size and not needs_dims:
        return False

    headers = resolve_anti_hotlink_headers(url, referer=referer)

    async with semaphore:
        try:
            # First try quick HEAD if we only need size
            if needs_size and not needs_dims:
                resp = await client.head(url, headers=headers)
                cl = resp.headers.get("content-length")
                if cl and cl.isdigit() and int(cl) > 0:
                    img["file_size"] = int(cl)
                    return True

            # Otherwise, stream the first 65KB to get both Content-Length and binary image dimensions
            async with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code == 200:
                    cl = resp.headers.get("content-length")
                    if cl and cl.isdigit() and int(cl) > 0:
                        img["file_size"] = int(cl)

                    if needs_dims:
                        chunk = b""
                        async for c in resp.aiter_bytes():
                            chunk += c
                            if len(chunk) >= 65536:
                                break
                        if len(chunk) > 16:
                            try:
                                pil_im = Image.open(io.BytesIO(chunk))
                                img["width"] = pil_im.size[0]
                                img["height"] = pil_im.size[1]
                                if pil_im.size[1] > 0:
                                    img["aspect_ratio"] = round(pil_im.size[0] / pil_im.size[1], 2)
                            except Exception:
                                pass
                    return True
        except Exception:
            pass
    return False


async def process_album(
    fpath: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> Dict[str, int]:
    try:
        with open(fpath, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except Exception as e:
        return {"updated": 0, "total": 0, "failed": 0}

    images = data.get("images", [])
    if not images:
        return {"updated": 0, "total": 0, "failed": 0}

    source_page = data.get("source_page", "")
    tasks = [probe_image(client, img, source_page, semaphore) for img in images]
    results = await asyncio.gather(*tasks)

    updated_in_album = sum(1 for r in results if r)
    if updated_in_album > 0:
        try:
            with open(fpath, "w", encoding="utf-8") as fp:
                json.dump(data, fp, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving {fpath}: {e}")

    return {
        "updated": updated_in_album,
        "total": len(images),
        "failed": len(images) - updated_in_album,
    }


async def main():
    print(f"Buscando álbuns em: {ALBUMS_DIR}...")
    files = glob.glob(os.path.join(ALBUMS_DIR, "*.json"))
    print(f"Total de arquivos encontrados: {len(files)}")

    semaphore = asyncio.Semaphore(25)  # 25 requisições paralelas simultâneas
    t0 = time.time()

    total_images = 0
    total_updated = 0

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        # Process in chunks of albums to keep memory tight
        chunk_size = 15
        for i in range(0, len(files), chunk_size):
            chunk = files[i : i + chunk_size]
            album_tasks = [process_album(f, client, semaphore) for f in chunk]
            results = await asyncio.gather(*album_tasks)
            for res in results:
                total_images += res["total"]
                total_updated += res["updated"]
            pct = min(100, int((i + len(chunk)) / len(files) * 100))
            print(f"Progresso: {i + len(chunk)}/{len(files)} álbuns ({pct}%) - {total_updated} imagens atualizadas...")

    t1 = time.time()
    print(f"\n==========================================")
    print(f"SINCRONIZAÇÃO DE METADADOS REAIS CONCLUÍDA")
    print(f"Tempo total: {t1 - t0:.2f}s")
    print(f"Total de imagens processadas: {total_images}")
    print(f"Imagens atualizadas com Content-Length real: {total_updated}")
    print(f"==========================================")


if __name__ == "__main__":
    asyncio.run(main())
