"""
Video storage management service on disk (data/videos/).
Physical manipulation of files, folders, metadata, and favorites.
"""

import os
import sys
import re
import json
import shutil
import hashlib
import time
import threading
import logging
import subprocess

# Evita abertura de janelas de terminal piscando no Windows ao executar FFmpeg/FFprobe
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
from typing import Dict, Any, List, Optional
import unicodedata
import httpx
import urllib.parse
from pathlib import Path


def sanitize_folder_name(name: Optional[str], default: str = "Extraídos") -> str:
    """Sanitizes folder name for Windows/Unix compatibility, stripping invalid chars like :*?\"<>|/\\."""
    if not name or not isinstance(name, str):
        return default
    # Remove chars forbidden on Windows filesystems
    clean = re.sub(r'[\\/*?:"<>|]', '', name)
    # Remove non-printable / control chars
    clean = "".join(ch for ch in clean if ord(ch) >= 32)
    # Collapse multiple spaces and strip trailing/leading spaces and dots
    clean = re.sub(r'\s+', ' ', clean).strip(' ._')
    if not clean:
        return default
    # Reserved Windows device names
    reserved = {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}
    if clean.upper() in reserved:
        clean = f"{clean}_folder"
    return clean[:120]

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

try:
    from .smart_shorts_detector import analyze_video_smart_highlights
except ImportError:
    try:
        from src.server.smart_shorts_detector import analyze_video_smart_highlights
    except ImportError:
        from smart_shorts_detector import analyze_video_smart_highlights


def get_ffmpeg_path() -> Optional[str]:
    """Returns absolute path to FFmpeg binary, trying imageio_ffmpeg first, then PATH."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    exe = shutil.which("ffmpeg")
    return exe if exe and os.path.exists(exe) else None


def get_video_duration(video_path: str) -> float:
    """Gets total duration in seconds from a video file."""
    if not video_path or not os.path.exists(video_path):
        return 0.0
    ffprobe_exe = shutil.which("ffprobe")
    if ffprobe_exe:
        try:
            cmd = [
                ffprobe_exe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5, creationflags=_NO_WINDOW)
            if res.returncode == 0 and res.stdout.strip():
                dur = float(res.stdout.strip())
                if dur > 0:
                    return dur
        except Exception:
            pass
    if HAS_OPENCV:
        try:
            cap = cv2.VideoCapture(video_path)
            if cap.isOpened():
                fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
                total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
                dur = (total_frames / fps) if fps > 0 else 0.0
                cap.release()
                if dur > 0:
                    return float(dur)
        except Exception:
            pass
    return 0.0


def _evaluate_frame_quality(img_path: str) -> float:
    """
    Evaluates image quality based on brightness and color standard deviation.
    Screens with black/intro/credits return a low score (< 40).
    Real colorful video action scenes return scores > 80.
    """
    try:
        from PIL import Image, ImageStat
        im = Image.open(img_path)
        stat = ImageStat.Stat(im)
        mean_b = sum(stat.mean) / len(stat.mean)
        std_b = sum(stat.stddev) / len(stat.stddev)
        if mean_b < 55 or mean_b > 245 or std_b < 18:
            return 10.0
        return std_b * 1.5 + (mean_b * 0.5)
    except Exception:
        return 50.0


def _safe_url_for_ffmpeg(url: str) -> str:
    """Escapes spaces and Unicode characters in URL paths so FFmpeg can parse them cleanly."""
    if not url:
        return ""
    try:
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.quote(parts.path, safe="/%")
        query = urllib.parse.quote(parts.query, safe="=&?%")
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))
    except Exception:
        return url


def _get_smart_candidate_timestamps(duration_sec: float, timestamp_sec: Optional[float] = None) -> List[float]:
    """
    Returns candidate timestamps in seconds for thumbnail extraction.
    GUARANTEE: Never extracts from the beginning of the video (avoids 0s, opening logos, black screens, credits).
    Prioritizes middle and action sections of the video content.
    """
    if timestamp_sec is not None and timestamp_sec > 5.0:
        return [timestamp_sec]

    dur = float(duration_sec or 0.0)
    if dur > 30.0:
        # Standard/Long video: 35%, 50%, 20%, 70% into duration
        return [dur * 0.35, dur * 0.50, dur * 0.20, dur * 0.70]
    elif dur > 10.0:
        # Medium clip (10s - 30s): 40%, 65%, 25%
        return [dur * 0.40, dur * 0.65, max(3.0, dur * 0.25)]
    elif dur > 4.0:
        # Short clip (4s - 10s): 50%, 70%, 35%
        return [dur * 0.50, dur * 0.70, dur * 0.35]
    else:
        # Unknown duration: probe representative action offsets (never beginning!)
        return [30.0, 45.0, 15.0, 60.0, 10.0, 4.0]


def generate_thumbnail_ffmpeg(video_path: str, thumb_path: str, timestamp_sec: Optional[float] = None) -> bool:
    """Extracts a sharp 640x360 thumbnail from the middle of the local video, strictly avoiding intros/vinhetas."""
    ffmpeg_exe = get_ffmpeg_path()
    if not ffmpeg_exe or not video_path or not os.path.exists(video_path):
        return False
    try:
        os.makedirs(os.path.dirname(os.path.abspath(thumb_path)), exist_ok=True)
        dur = get_video_duration(video_path)
        candidates_ts = _get_smart_candidate_timestamps(dur, timestamp_sec)

        best_score = -1.0
        best_temp_path = None
        temp_dir = os.path.dirname(os.path.abspath(thumb_path))

        for idx, ts in enumerate(candidates_ts):
            ts_val = max(1.0, float(ts))
            h = int(ts_val // 3600)
            m = int((ts_val % 3600) // 60)
            s = int(ts_val % 60)
            ts_str = f"{h:02d}:{m:02d}:{s:02d}"

            temp_candidate = os.path.join(temp_dir, f"tmp_th_{idx}_{os.path.basename(thumb_path)}")
            cmd = [
                ffmpeg_exe,
                "-y",
                "-ss", ts_str,
                "-i", video_path,
                "-vframes", "1",
                "-vf", "scale=640:-1",
                temp_candidate
            ]
            res = subprocess.run(cmd, capture_output=True, timeout=15, creationflags=_NO_WINDOW)
            if os.path.exists(temp_candidate) and os.path.getsize(temp_candidate) > 500:
                score = _evaluate_frame_quality(temp_candidate)
                if score > best_score:
                    if best_temp_path and os.path.exists(best_temp_path):
                        try:
                            os.remove(best_temp_path)
                        except Exception:
                            pass
                    best_score = score
                    best_temp_path = temp_candidate
                    if score >= 110.0:
                        break
                else:
                    try:
                        os.remove(temp_candidate)
                    except Exception:
                        pass

        if best_temp_path and os.path.exists(best_temp_path):
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except Exception:
                    pass
            os.replace(best_temp_path, thumb_path)
            return True

        # Fallback if specific seek failed: seek at 15s (still bypassing intro)
        cmd_fb = [
            ffmpeg_exe,
            "-y",
            "-ss", "00:00:15",
            "-i", video_path,
            "-vframes", "1",
            "-vf", "scale=640:-1",
            thumb_path
        ]
        subprocess.run(cmd_fb, capture_output=True, timeout=15, creationflags=_NO_WINDOW)
        return os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 500
    except Exception as e:
        logger.warning(f"FFmpeg thumbnail extraction failed for {video_path}: {e}")
        return False


def generate_thumbnail_remote_ffmpeg(
    video_url: str,
    thumb_path: str,
    token: Optional[str] = None,
    duration_sec: float = 0.0,
    timestamp_sec: Optional[float] = None
) -> bool:
    """
    Extracts a sharp 640x360 thumbnail directly from a remote video stream (e.g. Hugging Face),
    strictly avoiding the beginning of the video (intros, logos, black screens).
    Uses HTTP Range requests to seek directly into the action without downloading the full video.
    """
    ffmpeg_exe = get_ffmpeg_path()
    if not ffmpeg_exe or not video_url or not video_url.startswith("http"):
        return False

    try:
        os.makedirs(os.path.dirname(os.path.abspath(thumb_path)), exist_ok=True)
        safe_url = _safe_url_for_ffmpeg(video_url)
        candidates_ts = _get_smart_candidate_timestamps(duration_sec, timestamp_sec)

        best_score = -1.0
        best_temp_path = None
        temp_dir = os.path.dirname(os.path.abspath(thumb_path))

        headers_str = ""
        if token and "huggingface.co" in safe_url:
            headers_str = f"Authorization: Bearer {token}\r\n"

        for idx, ts in enumerate(candidates_ts):
            ts_val = max(1.0, float(ts))
            h = int(ts_val // 3600)
            m = int((ts_val % 3600) // 60)
            s = int(ts_val % 60)
            ts_str = f"{h:02d}:{m:02d}:{s:02d}"

            temp_candidate = os.path.join(temp_dir, f"tmp_rem_th_{idx}_{os.path.basename(thumb_path)}")
            cmd = [ffmpeg_exe, "-y"]
            if headers_str:
                cmd.extend(["-headers", headers_str])
            cmd.extend([
                "-ss", ts_str,
                "-i", safe_url,
                "-vframes", "1",
                "-vf", "scale=640:-1",
                temp_candidate
            ])

            try:
                res = subprocess.run(cmd, capture_output=True, timeout=12, creationflags=_NO_WINDOW)
                if os.path.exists(temp_candidate) and os.path.getsize(temp_candidate) > 500:
                    score = _evaluate_frame_quality(temp_candidate)
                    if score > best_score:
                        if best_temp_path and os.path.exists(best_temp_path):
                            try:
                                os.remove(best_temp_path)
                            except Exception:
                                pass
                        best_score = score
                        best_temp_path = temp_candidate
                        if score >= 95.0:
                            break
                    else:
                        try:
                            os.remove(temp_candidate)
                        except Exception:
                            pass
            except Exception:
                pass

        if best_temp_path and os.path.exists(best_temp_path):
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except Exception:
                    pass
            os.replace(best_temp_path, thumb_path)
            return True

        return False
    except Exception as e:
        logger.warning(f"Remote FFmpeg thumbnail extraction failed for {video_url}: {e}")
        return False


def download_thumbnail_from_url(
    url: str,
    thumb_path: str,
    referer: Optional[str] = None,
    token: Optional[str] = None
) -> bool:
    """Downloads remote thumbnail image and saves to disk cache, supporting Hugging Face auth."""
    if not url or not url.startswith("http"):
        return False
    try:
        os.makedirs(os.path.dirname(os.path.abspath(thumb_path)), exist_ok=True)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
        if referer:
            headers["Referer"] = referer
        if token and "huggingface.co" in url:
            headers["Authorization"] = f"Bearer {token}"
        with httpx.Client(timeout=10.0, follow_redirects=True, headers=headers) as client:
            resp = client.get(url)
            if resp.status_code == 200 and len(resp.content) > 500:
                with open(thumb_path, "wb") as f:
                    f.write(resp.content)
                return True
    except Exception as e:
        logger.debug(f"Failed to download thumbnail from {url}: {e}")
    return False

# Determina a pasta raiz do projeto ou executável com tolerância a ausência de pastas
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    if os.path.basename(BASE_DIR).lower() == "dist":
        BASE_DIR = os.path.dirname(BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATA_DIR = os.path.join(BASE_DIR, "data")
VIDEOS_DIR = os.path.join(DATA_DIR, "videos")
METADATA_FILE = os.path.join(VIDEOS_DIR, "videos_metadata.json")

# Criação automática garantida caso o executável seja movido sozinho
os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(os.path.join(VIDEOS_DIR, "Geral"), exist_ok=True)

SUPPORTED_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}

logger = logging.getLogger("VideoService")


def probe_video_file(file_path: str) -> Dict[str, Any]:
    """Probes a local video file using ffprobe (or cv2) to extract exact resolution, fps and duration."""
    info = {"width": 0, "height": 0, "fps": 0, "duration_seconds": 0.0}
    if not file_path or not os.path.exists(file_path):
        return info

    # Try ffprobe first (fast, precise, handles all containers)
    ffprobe_exe = shutil.which("ffprobe")
    if ffprobe_exe:
        try:
            cmd = [
                ffprobe_exe,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,r_frame_rate,duration:format=duration",
                "-of", "json",
                file_path
            ]
            r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8, creationflags=_NO_WINDOW)
            if r.returncode == 0 and r.stdout.strip():
                data = json.loads(r.stdout)
                streams = data.get("streams", [])
                if streams:
                    s = streams[0]
                    w = int(s.get("width") or 0)
                    h = int(s.get("height") or 0)
                    r_fps = str(s.get("r_frame_rate") or "24/1")
                    fps_val = 24
                    if "/" in r_fps:
                        try:
                            num, den = r_fps.split("/")
                            fps_val = round(float(num) / max(1.0, float(den)))
                        except Exception:
                            fps_val = 24
                    else:
                        try:
                            fps_val = round(float(r_fps))
                        except Exception:
                            fps_val = 24

                    raw_dur = s.get("duration") or data.get("format", {}).get("duration") or 0.0
                    try:
                        dur_val = float(raw_dur)
                    except Exception:
                        dur_val = 0.0

                    info["width"] = w
                    info["height"] = h
                    info["fps"] = fps_val
                    info["duration_seconds"] = round(dur_val, 2)
                    if w > 0 and h > 0:
                        return info
        except Exception as e_ffp:
            logger.debug(f"ffprobe failed for {file_path}: {e_ffp}")

    if HAS_OPENCV:
        try:
            cap = cv2.VideoCapture(file_path)
            if cap.isOpened():
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fps = round(cap.get(cv2.CAP_PROP_FPS))
                total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                dur = (total_frames / max(fps, 1)) if fps > 0 else 0.0
                cap.release()
                info["width"] = w
                info["height"] = h
                info["fps"] = fps
                info["duration_seconds"] = round(dur, 2)
        except Exception as e:
            logger.warning(f"Error probing video {file_path} with cv2: {e}")
    return info

# =====================================================================
# CLOUD STORAGE MANAGER (Hugging Face Datasets - 10GB+ Free / Sem Cartão)
# =====================================================================
class CloudStorageManager:
    """
    Gerenciador singleton de armazenamento de objetos usando Hugging Face Hub (Dataset LFS).
    Permite armazenamento gratuito de dezenas de GBs com autenticação por token Write.
    """
    def __init__(self):
        self.token = os.getenv("HF_TOKEN", "").strip()
        self.repo_id = os.getenv("HF_DATASET_REPO", "").strip()
        self.max_cloud_bytes = 10 * 1024 * 1024 * 1024  # 10 GB de referência
        self._api = None
        self._rate_limited_until = 0.0

    def _get_api(self):
        if not self.token or not self.repo_id:
            # 1. Tentar ler diretamente do arquivo .env da raiz do projeto
            try:
                env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
                if os.path.exists(env_path):
                    with open(env_path, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                k, v = k.strip(), v.strip().strip('"').strip("'")
                                if k == "HF_TOKEN" and not self.token:
                                    self.token = v
                                elif k == "HF_DATASET_REPO" and not self.repo_id:
                                    self.repo_id = v
            except Exception as e:
                print(f"[CloudStorage] Erro ao ler .env: {e}")

            if not self.token:
                self.token = os.getenv("HF_TOKEN", "").strip()
            if not self.repo_id:
                self.repo_id = os.getenv("HF_DATASET_REPO", "").strip()

        if not self.token or not self.repo_id:
            return None

        if self._api is None:
            try:
                from huggingface_hub import HfApi
                self._api = HfApi(token=self.token)
            except Exception as e:
                print(f"[CloudStorage] Erro ao inicializar HfApi: {e}")
                return None
        return self._api

    def is_connected(self) -> bool:
        conn, _ = self.get_connection_status()
        return conn

    def get_connection_status(self) -> tuple[bool, Optional[str]]:
        if not self.token:
            return False, None
        if self.token.startswith("HFAK"):
            return False, "Token S3 detectado (HFAK...). O Hugging Face Hub exige o User Access Token que comeca com 'hf_'."
        if not self.token.startswith("hf_"):
            return False, "Formato invalido. O User Access Token do Hugging Face deve comecar com 'hf_'."
        api = self._get_api()
        if not api:
            if not self.repo_id:
                return False, "Repositorio nao configurado."
            return False, "Falha ao inicializar HfApi."
        try:
            api.whoami()
            return True, None
        except Exception as e:
            return False, str(e)

    def upload_file(self, local_path_or_bytes, path_in_repo: str) -> Optional[str]:
        if time.time() < self._rate_limited_until:
            return None

        api = self._get_api()
        if not api:
            return None

        norm_path = path_in_repo.replace("\\", "/").lstrip("/")
        try:
            if isinstance(local_path_or_bytes, (str, Path)):
                api.upload_file(
                    path_or_fileobj=str(local_path_or_bytes),
                    path_in_repo=norm_path,
                    repo_id=self.repo_id,
                    repo_type="dataset",
                    commit_message=f"Upload {os.path.basename(norm_path)}"
                )
            elif isinstance(local_path_or_bytes, (bytes, bytearray)):
                import io
                api.upload_file(
                    path_or_fileobj=io.BytesIO(local_path_or_bytes),
                    path_in_repo=norm_path,
                    repo_id=self.repo_id,
                    repo_type="dataset",
                    commit_message=f"Upload {os.path.basename(norm_path)}"
                )
            else:
                api.upload_file(
                    path_or_fileobj=local_path_or_bytes,
                    path_in_repo=norm_path,
                    repo_id=self.repo_id,
                    repo_type="dataset",
                    commit_message=f"Upload {os.path.basename(norm_path)}"
                )

            resolve_url = f"https://huggingface.co/datasets/{self.repo_id}/resolve/main/{norm_path}"
            return resolve_url
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "401" in err_str or "rate limit" in err_str.lower() or "commit quota" in err_str.lower() or "invalid username or password" in err_str.lower():
                self._rate_limited_until = time.time() + 1500.0  # 25 min backoff
                print(f"[CloudStorage] Upload remoto pausado temporariamente ({err_str[:80]}).")
            else:
                print(f"[CloudStorage] Upload failed to Hugging Face ({norm_path}): {e}")
            return None


    def delete_file(self, path_in_repo: str) -> bool:
        api = self._get_api()
        if not api:
            return False

        norm_path = path_in_repo.replace("\\", "/").lstrip("/")
        try:
            api.delete_file(
                path_in_repo=norm_path,
                repo_id=self.repo_id,
                repo_type="dataset",
                commit_message=f"Delete {os.path.basename(norm_path)}"
            )
            return True
        except Exception as e:
            err_str = str(e)
            if "Entry Not Found" in err_str or "404" in err_str:
                return True
            print(f"[CloudStorage] Error deleting {norm_path}: {e}")
            return False

    def upload_json(self, data: Any, path_in_repo: str) -> bool:
        """Uploads a Python dict/list as a JSON file to HF."""
        try:
            import io
            raw = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
            result = self.upload_file(io.BytesIO(raw), path_in_repo)
            return result is not None
        except Exception as e:
            print(f"[CloudStorage] Erro ao enviar JSON {path_in_repo}: {e}")
            return False

    def download_json(self, path_in_repo: str) -> Optional[Any]:
        """Downloads a JSON file from HF and returns parsed content."""
        api = self._get_api()
        if not api:
            return None
        norm_path = path_in_repo.replace("\\", "/").lstrip("/")
        try:
            from huggingface_hub import hf_hub_download
            local = hf_hub_download(
                repo_id=self.repo_id,
                filename=norm_path,
                repo_type="dataset",
                token=self.token,
                force_download=True,
            )
            with open(local, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[CloudStorage] Error downloading JSON {norm_path}: {e}")
            return None

    def list_files_in_folder(self, folder_prefix: str) -> List[str]:
        """Lists all file paths inside a given folder prefix in the HF repo."""
        api = self._get_api()
        if not api:
            return []
        folder_prefix = folder_prefix.replace("\\", "/").rstrip("/")
        try:
            tree = list(api.list_repo_tree(
                repo_id=self.repo_id,
                repo_type="dataset",
                path_in_repo=folder_prefix,
                recursive=True
            ))
            return [getattr(item, "path", "") for item in tree
                    if not getattr(item, "path", "").endswith("/")]
        except Exception as e:
            print(f"[CloudStorage] Erro ao listar {folder_prefix}: {e}")
            return []

    def get_path_sizes_map(self) -> Dict[str, int]:
        """Returns a cached mapping of repo path and filename -> size in bytes from HF repo tree."""
        now = time.time()
        if hasattr(self, "_path_sizes_cache") and (now - getattr(self, "_cache_time", 0) < 60):
            return self._path_sizes_cache

        api = self._get_api()
        if not api:
            return getattr(self, "_path_sizes_cache", {})

        try:
            tree = list(api.list_repo_tree(repo_id=self.repo_id, repo_type="dataset", recursive=True))
            mapping = {}
            for item in tree:
                rpath = getattr(item, "path", "").replace("\\", "/").strip("/")
                sz = getattr(item, "size", 0) or 0
                if rpath and sz > 0:
                    mapping[rpath] = sz
                    mapping[os.path.basename(rpath)] = sz
            self._path_sizes_cache = mapping
            self._cache_time = now
            return mapping
        except Exception:
            return getattr(self, "_path_sizes_cache", {})

    def get_storage_stats(self) -> Dict[str, Any]:
        api = self._get_api()
        default_stats = {
            "is_connected": False,
            "provider": "Hugging Face Hub (Dataset LFS)",
            "repo_id": self.repo_id or "Not configured",
            "total_bytes_used": 0,
            "max_bytes_limit": self.max_cloud_bytes,
            "used_percentage": 0.0,
            "files_count": 0,
            "files": []
        }

        if not api:
            return default_stats

        try:
            tree = list(api.list_repo_tree(repo_id=self.repo_id, repo_type="dataset", recursive=True))
            total_bytes = 0
            file_items = []

            for item in tree:
                size = getattr(item, "size", 0) or 0
                rpath = getattr(item, "path", "")
                if rpath and not rpath.endswith("/"):
                    total_bytes += size
                    file_items.append({
                        "path": rpath,
                        "size_bytes": size
                    })

            pct = (total_bytes / self.max_cloud_bytes * 100) if self.max_cloud_bytes > 0 else 0.0
            return {
                "is_connected": True,
                "provider": "Hugging Face Hub (Dataset LFS)",
                "repo_id": self.repo_id,
                "total_bytes_used": total_bytes,
                "max_bytes_limit": self.max_cloud_bytes,
                "used_percentage": round(min(pct, 100.0), 2),
                "files_count": len(file_items),
                "files": file_items
            }
        except Exception as e:
            default_stats["error"] = str(e)
            return default_stats

cloud_storage = CloudStorageManager()


class VideoService:
    def __init__(self, base_dir: str = VIDEOS_DIR):
        self.base_dir = base_dir
        self.metadata_file = os.path.join(self.base_dir, "videos_metadata.json")
        self.thumbnails_dir = os.path.join(self.base_dir, ".thumbnails")
        self._meta_lock = threading.RLock()
        self._last_hf_meta_sync = 0.0
        self._ensure_storage_initialized()
        self._migrate_origins()

    def _ensure_storage_initialized(self):
        """Creates data/videos and default folders. On cloud restarts, restores metadata from HF."""
        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(self.thumbnails_dir, exist_ok=True)
        default_folder = os.path.join(self.base_dir, "Geral")
        os.makedirs(default_folder, exist_ok=True)

        # --- STEP 1: Restore or merge metadata from HF ---
        if cloud_storage.is_connected():
            self.restore_metadata_from_hf()

        if not os.path.exists(self.metadata_file):
            self._save_metadata({})

        # Recriar fisicamente as pastas de todos os vídeos conhecidos no metadata
        try:
            meta = self._load_metadata()
            for v in meta.values():
                folder = v.get("folder")
                if folder and not folder.startswith("."):
                    os.makedirs(os.path.join(self.base_dir, folder), exist_ok=True)
        except Exception:
            pass

        # If completely empty (no metadata entries AND no remote entries), show sample
        self._ensure_sample_video()

        # Auto-sincronizar qualquer vídeo local existente que ainda não esteja no Hugging Face
        self.sync_local_videos_to_cloud()

    def _migrate_origins(self):
        """Ensures all existing videos have an accurate source_origin ('web' vs 'pc')
        and heals missing/dynamic created_at timestamps so cloud videos never wrongly jump to the top."""
        try:
            from datetime import datetime
            meta = self._load_metadata()
            modified = False

            # Pre-load local albums for title/source matching
            albums_dir = os.path.join(os.path.dirname(self.base_dir), "albums")
            albums = []
            if os.path.exists(albums_dir):
                for fname in os.listdir(albums_dir):
                    if fname.endswith(".json"):
                        try:
                            with open(os.path.join(albums_dir, fname), "r", encoding="utf-8") as fp:
                                albums.append(json.load(fp))
                        except Exception:
                            pass

            def clean_words(s):
                if not s: return set()
                s = re.sub(r'[^a-zA-Z0-9]', ' ', s.lower())
                stop = {'the', 'and', 'com', 'mp4', '1080p', '720p', '360p', '480p', 'video', 'videos', 'para', 'que', 'dos', 'uma', 'seu', 'sua'}
                return {w for w in s.split() if len(w) > 3 and w not in stop}

            for vid_id, entry in meta.items():
                # 1. Recover/heal created_at
                cur_created = entry.get("created_at")
                date_recovered = None

                # Check local disk file
                rel_p = entry.get("rel_path")
                if rel_p:
                    loc = os.path.join(self.base_dir, rel_p.replace("/", os.sep))
                    if os.path.exists(loc):
                        try:
                            mtime = os.path.getmtime(loc)
                            date_recovered = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            pass

                # Check 10-digit unix timestamp in filename or title (e.g. 1790477465)
                if not date_recovered:
                    text_to_search = f"{entry.get('filename') or ''} {entry.get('title') or ''}"
                    m = re.search(r'(\b17\d{8}\b)', text_to_search)
                    if m:
                        try:
                            ts = int(m.group(1))
                            if 1500000000 < ts < 2000000000:
                                date_recovered = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            pass

                # Check matching album
                if not date_recovered:
                    v_words = clean_words(entry.get("title") or "") | clean_words(entry.get("folder") or "")
                    best_alb = None
                    best_overlap = 0
                    if len(v_words) >= 2:
                        for a in albums:
                            a_words = clean_words(a.get("title") or "")
                            overlap = len(v_words & a_words)
                            if overlap > best_overlap:
                                best_overlap = overlap
                                best_alb = a
                    if best_alb and best_overlap >= 2 and best_alb.get("created_at"):
                        date_recovered = best_alb.get("created_at").replace(" UTC", "")

                # If missing or it was generated with the dynamic fallback bug
                if not cur_created or cur_created.startswith("2026-10-26 23:") or cur_created.startswith("2026-10-27 00:"):
                    if date_recovered:
                        entry["created_at"] = date_recovered
                        modified = True
                    elif not cur_created:
                        entry["created_at"] = "2026-09-27 12:00:00"
                        modified = True

                # 2. Fix source_origin ('web' vs 'pc')
                curr = entry.get("source_origin")
                surl = entry.get("source_url") or ""
                sid = entry.get("source_id") or ""
                folder = entry.get("folder") or ""
                fn = entry.get("filename") or ""
                title = entry.get("title") or ""
                folder_norm = "".join(c for c in unicodedata.normalize("NFKD", folder) if not unicodedata.combining(c)).lower()
                text_check = f"{title} {folder} {fn}".lower()

                # Detect web extractions via streaming markers, web album matches, url signatures or resolution tags
                is_web = bool(
                    (surl and (surl.startswith("http://") or surl.startswith("https://"))) or
                    sid or
                    entry.get("custom_stream_url") or
                    entry.get("storage_location") == "stream_url" or
                    folder_norm.startswith("extra") or
                    re.search(r'_\d{3,4}p(?:_\d+)?\.(?:mp4|webm|m4v)', fn.lower()) or
                    re.search(r'\b17\d{8}\b', text_check)
                )

                if not is_web:
                    v_words = clean_words(title) | clean_words(folder)
                    if len(v_words) >= 2:
                        for a in albums:
                            a_words = clean_words(a.get("title") or "")
                            if len(v_words & a_words) >= 2:
                                if a.get("source_url") or a.get("source_domain") or a.get("source_page"):
                                    is_web = True
                                    break

                new_origin = "web" if is_web else "pc"
                if curr != new_origin:
                    entry["source_origin"] = new_origin
                    modified = True

            if modified:
                self._save_metadata(meta)
                logger.info(f"[VideoService] Migrated source_origin and healed created_at timestamps for {len(meta)} videos.")
        except Exception as e:
            logger.warning(f"[VideoService] Error migrating origins: {e}")

    def restore_metadata_from_hf(self) -> int:
        """Downloads remote videos_metadata.json from Hugging Face and merges into local metadata."""
        if not cloud_storage.is_connected():
            return 0
        try:
            remote_meta = cloud_storage.download_json("metadata/videos_metadata.json")
            if not remote_meta or not isinstance(remote_meta, dict):
                return 0
            with self._meta_lock:
                local_meta = self._load_metadata()
                modified = False
                added = 0
                for v_id, v_data in remote_meta.items():
                    if v_id not in local_meta:
                        local_meta[v_id] = v_data
                        modified = True
                        added += 1
                    else:
                        c_url = v_data.get("cloud_url")
                        if c_url and not local_meta[v_id].get("cloud_url"):
                            local_meta[v_id]["cloud_url"] = c_url
                            modified = True
                        if v_data.get("storage_location") == "huggingface" and local_meta[v_id].get("storage_location") != "huggingface":
                            rel_p = local_meta[v_id].get("rel_path") or ""
                            if not rel_p or not os.path.exists(os.path.join(self.base_dir, rel_p.replace("/", os.sep))):
                                local_meta[v_id]["storage_location"] = "huggingface"
                                modified = True
                if modified:
                    self._save_metadata(local_meta)
                    logger.info(f"[VideoService] Sincronizados {added} vídeos remotos do Hugging Face.")
                return added
        except Exception as e:
            logger.warning(f"[VideoService] Erro ao sincronizar metadados do HF: {e}")
            return 0

    def sync_local_videos_to_cloud(self):
        """Auto-discovers any local videos marked as 'render_local' and uploads them to Hugging Face sequentially."""
        import threading
        def _auto_sync():
            time.sleep(10)  # Aguarda startup completo
            try:
                if not cloud_storage.is_connected() or time.time() < cloud_storage._rate_limited_until:
                    return
                meta = self._load_metadata()
                for vid_id, data in list(meta.items()):
                    if time.time() < cloud_storage._rate_limited_until:
                        break
                    cloud_url = data.get("cloud_url")
                    storage_loc = data.get("storage_location", "render_local")
                    if not cloud_url or storage_loc != "huggingface":
                        rel_path = data.get("rel_path")
                        if rel_path:
                            local_fpath = os.path.join(self.base_dir, rel_path.replace("/", os.sep))
                            if os.path.exists(local_fpath):
                                folder = data.get("folder", "Geral")
                                filename = os.path.basename(local_fpath)
                                repo_path = f"videos/{folder}/{filename}"
                                logger.info(f"[AutoSync] Uploading pending local video to Hugging Face: {filename}")
                                c_url = cloud_storage.upload_file(local_fpath, repo_path)
                                if c_url:
                                    meta_cur = self._load_metadata()
                                    if vid_id in meta_cur:
                                        meta_cur[vid_id]["storage_location"] = "huggingface"
                                        meta_cur[vid_id]["cloud_url"] = c_url
                                        self._save_metadata(meta_cur)
                                time.sleep(15)  # Espaçamento seguro entre commits para não estourar taxa
            except Exception as e:
                logger.warning(f"[AutoSync] Automatic sync error to HF: {e}")

        threading.Thread(target=_auto_sync, daemon=True).start()


    def _ensure_sample_video(self):
        """Downloads a small royalty-free demo video only if no videos exist at all (local + remote)."""
        all_videos = self.list_all_videos()
        if not all_videos:
            sample_target = os.path.join(self.base_dir, "Geral", "Amostra_Ocean_Waves.mp4")
            if not os.path.exists(sample_target):
                try:
                    # Public sample from Google Cloud Storage demo bucket (~1.5 MB)
                    sample_url = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                        resp = client.get(sample_url)
                        if resp.status_code == 200 and len(resp.content) > 10000:
                            with open(sample_target, "wb") as fp:
                                fp.write(resp.content)
                            self._update_single_metadata(
                                file_path=sample_target,
                                title="Amostra Ocean Waves (Demo 4K)",
                                folder="Geral",
                                is_favorite=True
                            )
                except Exception:
                    pass

    def _load_metadata(self) -> Dict[str, Any]:
        """Loads videos metadata JSON."""
        with self._meta_lock:
            if not os.path.exists(self.metadata_file):
                return {}
            try:
                with open(self.metadata_file, "r", encoding="utf-8") as fp:
                    return json.load(fp)
            except Exception:
                return {}

    def _save_metadata(self, data: Dict[str, Any]):
        """Persists videos metadata to local disk AND mirrors to HF for persistence across restarts."""
        with self._meta_lock:
            try:
                tmp_path = f"{self.metadata_file}.{os.getpid()}.{threading.get_ident()}.tmp"
                with open(tmp_path, "w", encoding="utf-8") as fp:
                    json.dump(data, fp, indent=2, ensure_ascii=False)
                try:
                    os.replace(tmp_path, self.metadata_file)
                except PermissionError:
                    with open(self.metadata_file, "w", encoding="utf-8") as fp:
                        json.dump(data, fp, indent=2, ensure_ascii=False)
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
            except Exception as e:
                print(f"Error saving videos metadata locally: {e}")

        # Async-style: mirror to HF in background thread (throttled to avoid concurrent HF flood)
        try:
            now = time.time()
            if now - getattr(self, "_last_hf_meta_sync", 0.0) >= 5.0:
                self._last_hf_meta_sync = now
                snapshot = dict(data)
                def _sync():
                    cloud_storage.upload_json(snapshot, "metadata/videos_metadata.json")
                t = threading.Thread(target=_sync, daemon=True)
                t.start()
        except Exception as e:
            print(f"[VideoService] Error starting metadata sync to HF: {e}")

    def _get_video_id(self, rel_path: str) -> str:
        """Generates a stable deterministic ID from relative path."""
        norm = rel_path.replace("\\", "/").strip("/")
        return hashlib.md5(norm.encode("utf-8")).hexdigest()[:12]

    def _find_video_id(self, rel_path: str, meta: Dict[str, Any]) -> str:
        """Finds existing ID for a rel_path, or generates a stable ID."""
        norm = rel_path.replace("\\", "/").strip("/")
        for vid_id, data in meta.items():
            if data.get("rel_path", "").replace("\\", "/").strip("/") == norm:
                return vid_id
        return self._get_video_id(norm)

    def _find_disk_file_by_id(self, vid_id: str) -> Optional[str]:
        """Finds the relative path of a physical video file on disk matching vid_id."""
        if not vid_id:
            return None
        for root, dirs, files in os.walk(self.base_dir):
            for f in files:
                if f.lower().endswith(('.mp4', '.mkv', '.webm', '.mov', '.avi', '.ts')):
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, self.base_dir).replace('\\', '/').strip('/')
                    if hashlib.md5(rel.encode('utf-8')).hexdigest()[:12] == vid_id:
                        return rel
        return None

    def _update_single_metadata(
        self,
        file_path: Optional[str] = None,
        title: Optional[str] = None,
        folder: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        vid_id: Optional[str] = None,
        storage_location: Optional[str] = None,
        cloud_url: Optional[str] = None,
        stream_url: Optional[str] = None,
        file_size_bytes: Optional[int] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        source_url: Optional[str] = None,
        source_id: Optional[str] = None,
        source_thumbnail_url: Optional[str] = None,
        source_origin: Optional[str] = None,
        intro_end: Optional[float] = None,
        highlight_start: Optional[float] = None,
        highlight_end: Optional[float] = None,
        highlight_score: Optional[float] = None,
        highlights: Optional[List[Dict[str, Any]]] = None,
        heatmap_data: Optional[List[Dict[str, Any]]] = None
    ):
        with self._meta_lock:
            meta = self._load_metadata()
            entry = meta.get(vid_id, {}) if vid_id else {}
            if file_path:
                rel_path = os.path.relpath(file_path, self.base_dir).replace("\\", "/")
                if not vid_id:
                    vid_id = self._find_video_id(rel_path, meta)
                    entry = meta.get(vid_id, {})
            else:
                rel_path = entry.get("rel_path")
                if not rel_path or ("remote_" in rel_path and not entry.get("cloud_url")):
                    matched_disk = self._find_disk_file_by_id(vid_id) if vid_id else None
                    if matched_disk:
                        rel_path = matched_disk
                    else:
                        rel_path = rel_path or f"{folder or 'Geral'}/remote_{vid_id or int(time.time())}.mp4"
                if not vid_id:
                    vid_id = self._get_video_id(rel_path)
                    entry = meta.get(vid_id, {})

            if title is not None:
                entry["title"] = title
            if folder is not None:
                entry["folder"] = folder
            if is_favorite is not None:
                entry["is_favorite"] = is_favorite
            if storage_location is not None:
                entry["storage_location"] = storage_location
            elif "storage_location" not in entry or entry.get("storage_location") == "render_local":
                entry["storage_location"] = "local"
            if cloud_url is not None:
                entry["cloud_url"] = cloud_url
            if stream_url is not None:
                entry["custom_stream_url"] = stream_url
            if file_size_bytes is not None:
                entry["file_size_bytes"] = file_size_bytes
            if width is not None:
                entry["width"] = width
            if height is not None:
                entry["height"] = height
            if fps is not None:
                entry["fps"] = fps
            if duration_seconds is not None:
                entry["duration_seconds"] = duration_seconds
            if source_url is not None:
                entry["source_url"] = source_url
            if source_id is not None:
                entry["source_id"] = source_id
            if source_thumbnail_url is not None:
                entry["source_thumbnail_url"] = source_thumbnail_url

            if intro_end is not None:
                entry["intro_end"] = round(float(intro_end), 2)
            if highlight_start is not None:
                entry["highlight_start"] = round(float(highlight_start), 2)
            if highlight_end is not None:
                entry["highlight_end"] = round(float(highlight_end), 2)
            if highlight_score is not None:
                entry["highlight_score"] = round(float(highlight_score), 2)
            if highlights is not None:
                entry["highlights"] = highlights
            if heatmap_data is not None:
                entry["heatmap_data"] = heatmap_data

            if source_origin is not None:
                entry["source_origin"] = source_origin
            elif "source_origin" not in entry or entry.get("source_origin") is None:
                eff_surl = source_url or entry.get("source_url") or ""
                eff_sid = source_id or entry.get("source_id") or ""
                eff_folder = folder or entry.get("folder") or ""
                eff_f_norm = "".join(c for c in unicodedata.normalize("NFKD", eff_folder) if not unicodedata.combining(c)).lower()
                if (eff_surl and (eff_surl.startswith("http://") or eff_surl.startswith("https://"))) or eff_sid or eff_f_norm.startswith("extra"):
                    entry["source_origin"] = "web"
                else:
                    entry["source_origin"] = "pc"

            # Auto-probe if missing dimensions and local file exists
            if file_path and os.path.exists(file_path) and (not entry.get("width") or not entry.get("height")):
                p = probe_video_file(file_path)
                if p["width"] > 0:
                    entry["width"] = p["width"]
                    entry["height"] = p["height"]
                    entry["fps"] = p["fps"]
                    entry["duration_seconds"] = p["duration_seconds"]

            entry["id"] = vid_id
            entry["rel_path"] = rel_path
            if "created_at" not in entry or not entry["created_at"]:
                entry["created_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

            meta[vid_id] = entry
            self._save_metadata(meta)
            return vid_id

    def list_folders(self) -> List[Dict[str, Any]]:
        """Lists all physical and metadata folders, properly counting both local and HF cloud videos, deduplicating phantom variants."""
        import unicodedata
        default_geral = os.path.join(self.base_dir, "Geral")
        os.makedirs(default_geral, exist_ok=True)

        meta = self._load_metadata()
        all_videos = self.list_all_videos()

        def _clean_folder_name(name: str) -> str:
            if not name:
                return "Geral"
            n = unicodedata.normalize("NFC", name.strip())
            return n.rstrip(" -") or "Geral"

        def _folder_key(name: str) -> str:
            if not name:
                return "geral"
            n = unicodedata.normalize("NFKD", name)
            n = "".join(c for c in n if not unicodedata.combining(c))
            return n.strip(" -").lower() or "geral"

        # Coletar candidatos de pastas do disco e metadata
        candidate_folders: Dict[str, List[str]] = {}
        for entry in ["Geral"]:
            candidate_folders.setdefault(_folder_key(entry), []).append(entry)

        if os.path.exists(self.base_dir):
            for entry in os.listdir(self.base_dir):
                full_path = os.path.join(self.base_dir, entry)
                if os.path.isdir(full_path) and not entry.startswith("."):
                    clean = _clean_folder_name(entry)
                    candidate_folders.setdefault(_folder_key(clean), []).append(clean)

        for v in meta.values():
            f = v.get("folder")
            if f and not f.startswith("."):
                clean = _clean_folder_name(f)
                candidate_folders.setdefault(_folder_key(clean), []).append(clean)

        folders = []
        for key, variants in candidate_folders.items():
            # Agrupar todos os vídeos pertencentes a esta chave normalizada
            vids_in_folder = [v for v in all_videos if _folder_key(v.get("folder", "")) == key]
            total_bytes = sum(v.get("file_size_bytes", 0) for v in vids_in_folder)

            # Escolher o melhor nome canônico: preferir a variante usada pelos vídeos
            canonical_name = None
            if vids_in_folder:
                # Contar qual variante é mais frequente entre os vídeos
                variant_counts: Dict[str, int] = {}
                for v in vids_in_folder:
                    vf = _clean_folder_name(v.get("folder", ""))
                    variant_counts[vf] = variant_counts.get(vf, 0) + 1
                canonical_name = max(variant_counts.items(), key=lambda x: x[1])[0]
            else:
                # Se não há vídeos, usar a variante original mais limpa
                canonical_name = variants[0]

            # Garantir pasta física no disco com o nome canônico
            if canonical_name:
                os.makedirs(os.path.join(self.base_dir, canonical_name), exist_ok=True)

            folders.append({
                "id": canonical_name,
                "name": canonical_name,
                "video_count": len(vids_in_folder),
                "total_size_bytes": total_bytes
            })

        # Ordenar: Geral primeiro se tiver vídeos ou por ordem alfabética
        folders.sort(key=lambda x: (x["name"] != "Geral", x["name"]))
        return folders

    def list_all_videos(self) -> List[Dict[str, Any]]:
        """Scans all folders for video files and merges with saved metadata."""
        meta = self._load_metadata()
        videos = []

        for root, dirs, files in os.walk(self.base_dir):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in SUPPORTED_EXTENSIONS:
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, self.base_dir).replace("\\", "/")
                    parts = rel_path.split("/")
                    folder_name = parts[0] if len(parts) > 1 else "Geral"

                    vid_id = self._find_video_id(rel_path, meta)
                    entry_meta = meta.get(vid_id, {})

                    try:
                        stat = os.stat(full_path)
                        size_bytes = stat.st_size
                        mtime = stat.st_mtime
                        file_created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime))
                    except Exception:
                        size_bytes = 0
                        file_created = "2026-09-27 12:00:00"

                    created_at = entry_meta.get("created_at") or file_created
                    if not entry_meta.get("created_at"):
                        entry_meta["created_at"] = created_at

                    clean_title = entry_meta.get("title") or os.path.splitext(f)[0].replace("_", " ")
                    storage_loc = entry_meta.get("storage_location", "local")
                    if storage_loc == "render_local":
                        storage_loc = "local"

                    w = entry_meta.get("width") or 0
                    h = entry_meta.get("height") or 0
                    fps = entry_meta.get("fps") or 0
                    dur = entry_meta.get("duration_seconds") or 0.0


                    videos.append({
                        "id": vid_id,
                        "title": clean_title,
                        "filename": f,
                        "folder": folder_name,
                        "file_size_bytes": size_bytes,
                        "format": ext[1:].upper(),
                        "is_favorite": entry_meta.get("is_favorite", False),
                        "created_at": created_at,
                        "rel_path": rel_path,
                        "storage_location": storage_loc,
                        "source_origin": entry_meta.get("source_origin") or ("web" if (entry_meta.get("source_url") or entry_meta.get("source_id") or entry_meta.get("custom_stream_url") or "".join(c for c in unicodedata.normalize("NFKD", folder_name) if not unicodedata.combining(c)).lower().startswith("extra")) else "pc"),
                        "cloud_url": entry_meta.get("cloud_url"),
                        "stream_url": entry_meta.get("custom_stream_url") or f"/api/videos/{vid_id}/stream",
                        "download_url": f"/api/videos/{vid_id}/download",
                        "thumbnail_url": f"/api/videos/{vid_id}/thumbnail",
                        "width": w,
                        "height": h,
                        "fps": fps,
                        "duration_seconds": dur,
                        "intro_end": entry_meta.get("intro_end", 0.0),
                        "highlight_start": entry_meta.get("highlight_start", 0.0),
                        "highlight_end": entry_meta.get("highlight_end", dur),
                        "highlight_score": entry_meta.get("highlight_score", 0.0),
                        "highlights": entry_meta.get("highlights", []),
                        "source_url": entry_meta.get("source_url"),
                        "source_id": entry_meta.get("source_id"),
                        "source_thumbnail_url": entry_meta.get("source_thumbnail_url")
                    })


        # Adicionar vídeos puramente remotos (ex: stream externo cadastrado)
        # Também inclui vídeos cujo arquivo local sumiu mas que ainda têm cloud_url no HF
        seen_ids = {v["id"] for v in videos}
        for vid_id, entry_meta in meta.items():
            if vid_id not in seen_ids:
                has_remote = entry_meta.get("custom_stream_url") or entry_meta.get("cloud_url")
                if not has_remote:
                    continue
                storage_loc = entry_meta.get("storage_location", "huggingface")
                clean_title = entry_meta.get("title") or f"Vídeo Remoto {vid_id[:6]}"
                cloud_url = entry_meta.get("cloud_url")
                custom_stream = entry_meta.get("custom_stream_url")
                # IMPORTANT: stream_url ALWAYS goes through server proxy (browser has no HF token)
                # cloud_url is kept for "open in new tab" button (direct HF link)
                effective_stream = custom_stream or f"/api/videos/{vid_id}/stream"
                # Resgata o tamanho real em bytes se estiver zerado
                size_bytes = entry_meta.get("file_size_bytes", 0)
                if size_bytes == 0:
                    rel_p = entry_meta.get("rel_path", "")
                    if rel_p:
                        loc_p = os.path.join(self.base_dir, rel_p.replace("/", os.sep))
                        if os.path.exists(loc_p):
                            size_bytes = os.path.getsize(loc_p)
                    if size_bytes == 0 and cloud_url:
                        hf_sizes = cloud_storage.get_path_sizes_map()
                        folder_name = entry_meta.get("folder", "Geral")
                        fname = os.path.basename(rel_p) if rel_p else f"{clean_title}.mp4"
                        size_bytes = hf_sizes.get(f"videos/{folder_name}/{fname}") or hf_sizes.get(fname) or 0

                dur = entry_meta.get("duration_seconds") or 0.0
                created_at = entry_meta.get("created_at") or "2026-09-27 12:00:00"
                if not entry_meta.get("created_at"):
                    entry_meta["created_at"] = created_at

                videos.append({
                    "id": vid_id,
                    "title": clean_title,
                    "filename": f"{clean_title}.mp4",
                    "folder": entry_meta.get("folder", "Geral"),
                    "file_size_bytes": size_bytes,
                    "format": "MP4",
                    "is_favorite": entry_meta.get("is_favorite", False),
                    "created_at": created_at,
                    "rel_path": entry_meta.get("rel_path", ""),
                    "storage_location": storage_loc,
                    "source_origin": entry_meta.get("source_origin") or ("web" if (entry_meta.get("source_url") or entry_meta.get("source_id") or custom_stream or cloud_url or "".join(c for c in unicodedata.normalize("NFKD", entry_meta.get("folder", "")) if not unicodedata.combining(c)).lower().startswith("extra")) else "pc"),
                    "cloud_url": cloud_url,
                    "stream_url": effective_stream,
                    "download_url": f"/api/videos/{vid_id}/download",
                    "thumbnail_url": f"/api/videos/{vid_id}/thumbnail",
                    "width": entry_meta.get("width") or 0,
                    "height": entry_meta.get("height") or 0,
                    "fps": entry_meta.get("fps") or 0,
                    "duration_seconds": dur,
                    "intro_end": entry_meta.get("intro_end", 0.0),
                    "highlight_start": entry_meta.get("highlight_start", 0.0),
                    "highlight_end": entry_meta.get("highlight_end", dur),
                    "highlight_score": entry_meta.get("highlight_score", 0.0),
                    "highlights": entry_meta.get("highlights", []),
                    "source_url": entry_meta.get("source_url"),
                    "source_id": entry_meta.get("source_id"),
                    "source_thumbnail_url": entry_meta.get("source_thumbnail_url"),
                    "stream_status": entry_meta.get("stream_status"),
                    "stream_error": entry_meta.get("stream_error")
                })


        # Sort newest first
        videos.sort(key=lambda v: v.get("created_at", ""), reverse=True)
        return videos

    def get_video_by_id(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Finds a video item and its full filesystem path by ID with high-speed direct metadata lookup."""
        meta = self._load_metadata()
        entry = meta.get(video_id)
        if entry:
            rel_path = entry.get("rel_path", "")
            full_path = os.path.join(self.base_dir, rel_path.replace("/", os.sep))
            # Verify if local file exists, or if folder was renamed (skip disk walks for stream-only videos)
            is_remote_stream = (entry.get("storage_location") == "stream_url") or (rel_path and os.path.basename(rel_path).startswith("remote_"))
            if not os.path.exists(full_path) and not is_remote_stream:
                fname = entry.get("filename") or os.path.basename(rel_path)
                for root, dirs, files in os.walk(self.base_dir):
                    if fname in files and not fname.startswith("remote_"):
                        full_path = os.path.join(root, fname)
                        entry["rel_path"] = os.path.relpath(full_path, self.base_dir).replace("\\", "/")
                        break
                if not os.path.exists(full_path):
                    matched_disk = self._find_disk_file_by_id(video_id)
                    if matched_disk:
                        full_path = os.path.join(self.base_dir, matched_disk.replace("/", os.sep))
                        entry["rel_path"] = matched_disk
                        entry["filename"] = os.path.basename(matched_disk)
                        entry["folder"] = matched_disk.split("/")[0] if "/" in matched_disk else "Geral"
                        self._save_metadata(meta)

            exists = os.path.exists(full_path) if (full_path and not is_remote_stream) else False
            dur = entry.get("duration_seconds") or 0.0
            return {
                "id": video_id,
                "title": entry.get("title") or entry.get("filename", "").replace("_", " "),
                "filename": entry.get("filename") or os.path.basename(rel_path),
                "folder": entry.get("folder") or "Geral",
                "file_size_bytes": entry.get("file_size_bytes") or (os.path.getsize(full_path) if exists else 0),
                "format": entry.get("format") or (os.path.splitext(rel_path)[1][1:].upper() if rel_path else "MP4"),
                "is_favorite": entry.get("is_favorite", False),
                "created_at": entry.get("created_at") or "2026-09-27 12:00:00",
                "rel_path": rel_path,
                "storage_location": entry.get("storage_location", "local"),
                "source_origin": entry.get("source_origin") or ("web" if (entry.get("source_url") or entry.get("source_id") or entry.get("custom_stream_url") or "".join(c for c in unicodedata.normalize("NFKD", entry.get("folder", "")) if not unicodedata.combining(c)).lower().startswith("extra")) else "pc"),
                "cloud_url": entry.get("cloud_url"),
                "custom_stream_url": entry.get("custom_stream_url"),
                "stream_url": (f"/api/videos/{video_id}/stream" if exists else (entry.get("custom_stream_url") or f"/api/videos/{video_id}/stream")),
                "download_url": f"/api/videos/{video_id}/download",
                "thumbnail_url": f"/api/videos/{video_id}/thumbnail",
                "width": entry.get("width") or 0,
                "height": entry.get("height") or 0,
                "fps": entry.get("fps") or 0,
                "duration_seconds": dur,
                "intro_end": entry.get("intro_end", 0.0),
                "highlight_start": entry.get("highlight_start", 0.0),
                "highlight_end": entry.get("highlight_end", dur),
                "highlight_score": entry.get("highlight_score", 0.0),
                "highlights": entry.get("highlights", []),
                "heatmap_data": entry.get("heatmap_data"),
                "source_url": entry.get("source_url"),
                "source_id": entry.get("source_id"),
                "source_thumbnail_url": entry.get("source_thumbnail_url"),
                "stream_status": entry.get("stream_status"),
                "stream_error": entry.get("stream_error"),
                "full_path": full_path if exists else None
            }

        # Fallback to list_all_videos only if not in metadata
        for v in self.list_all_videos():
            if v["id"] == video_id:
                full_path = os.path.join(self.base_dir, v["rel_path"].replace("/", os.sep))
                v["full_path"] = full_path if os.path.exists(full_path) else None
                return v
        return None

    def get_or_detect_smart_highlight(
        self,
        video_id: str,
        heatmap_data: Optional[List[Dict[str, Any]]] = None,
        force_recompute: bool = False,
        desired_window: float = 35.0
    ) -> Dict[str, Any]:
        """
        Retrieves or dynamically computes the golden climax moment (15s-60s) and Top 3 highlights.
        Detects intro end, fast audio crescendo dynamics, and audience heatmap peaks.
        Persists results in metadata cache for zero-latency instant seeks in future plays.
        """
        meta = self._load_metadata()
        entry = meta.get(video_id, {})
        cached_start = entry.get("highlight_start")
        cached_end = entry.get("highlight_end")
        cached_highlights = entry.get("highlights")

        has_valid_hls = bool(cached_highlights and isinstance(cached_highlights, list) and len(cached_highlights) > 0)
        has_valid_start = (cached_start is not None and float(cached_start) > 0)
        if not force_recompute and has_valid_start and cached_end is not None and cached_end > 0 and has_valid_hls:
            return {
                "intro_end": entry.get("intro_end", 0.0),
                "highlight_start": float(cached_start),
                "highlight_end": float(cached_end),
                "highlight_score": entry.get("highlight_score", 0.0),
                "duration": entry.get("duration_seconds", 0.0),
                "highlights": cached_highlights
            }

        video_info = self.get_video_by_id(video_id)
        if not video_info:
            return {
                "intro_end": 0.0,
                "highlight_start": 0.0,
                "highlight_end": 0.0,
                "highlight_score": 0.0,
                "duration": 0.0,
                "highlights": []
            }

        full_path = video_info.get("full_path")
        dur = float(video_info.get("duration_seconds") or 0.0)

        # Execute smart analysis using intro detection, audio dynamics, or yt-dlp heatmap
        result = analyze_video_smart_highlights(
            video_path=full_path if (full_path and os.path.exists(full_path)) else None,
            duration=dur,
            heatmap_data=heatmap_data or entry.get("heatmap_data"),
            desired_window=desired_window
        )

        # Cache in video metadata
        self._update_single_metadata(
            file_path=full_path,
            vid_id=video_id,
            folder=video_info.get("folder"),
            title=video_info.get("title"),
            intro_end=result.get("intro_end", 0.0),
            highlight_start=result.get("highlight_start", 0.0),
            highlight_end=result.get("highlight_end", dur),
            highlight_score=result.get("highlight_score", 0.0),
            highlights=result.get("highlights", [])
        )
        return result

    def create_folder(self, folder_name: str) -> bool:
        """Creates a new folder on disk."""
        clean_name = sanitize_folder_name(folder_name, default="")
        if not clean_name:
            return False
        target_path = os.path.join(self.base_dir, clean_name)
        os.makedirs(target_path, exist_ok=True)
        return True

    def rename_folder(self, old_name: str, new_name: str) -> bool:
        """Renames a folder on disk and updates metadata paths while preserving video IDs."""
        clean_new = sanitize_folder_name(new_name, default="")
        if not clean_new or clean_new == old_name:
            return False

        old_path = os.path.join(self.base_dir, old_name)
        new_path = os.path.join(self.base_dir, clean_new)

        # Se a pasta antiga existir fisicamente, renomeia; se não, cria a nova
        if os.path.exists(old_path):
            try:
                os.rename(old_path, new_path)
            except Exception as e:
                print(f"Error renaming physical folder: {e}")
                return False
        else:
            os.makedirs(new_path, exist_ok=True)

        # Update metadata paths preserving IDs for both local and stream videos
        meta = self._load_metadata()
        for vid_id, v in meta.items():
            rp = v.get("rel_path", "")
            f_curr = v.get("folder", "")
            if rp.startswith(old_name + "/") or f_curr == old_name:
                fname = os.path.basename(rp) if rp else f"{v.get('title', 'video')}.mp4"
                v["rel_path"] = f"{clean_new}/{fname}"
                v["folder"] = clean_new
        self._save_metadata(meta)
        return True

    def delete_folder(self, folder_name: str) -> bool:
        """Deletes a folder from disk. Videos inside are moved to 'Geral' to prevent data loss."""
        if folder_name == "Geral":
            return False  # Cannot delete default folder

        folder_path = os.path.join(self.base_dir, folder_name)
        geral_path = os.path.join(self.base_dir, "Geral")
        os.makedirs(geral_path, exist_ok=True)

        # Move any existing physical video files to Geral
        if os.path.exists(folder_path):
            for f in os.listdir(folder_path):
                src_file = os.path.join(folder_path, f)
                if os.path.isfile(src_file):
                    dst_file = os.path.join(geral_path, f)
                    if os.path.exists(dst_file):
                        final_f = f"{int(time.time())}_{f}"
                        dst_file = os.path.join(geral_path, final_f)
                    try:
                        shutil.move(src_file, dst_file)
                    except Exception:
                        pass
            try:
                shutil.rmtree(folder_path)
            except Exception as e:
                print(f"Error removing physical folder: {e}")

        # Update metadata for all videos (including stream_url videos)
        meta = self._load_metadata()
        for vid_id, v in meta.items():
            rp = v.get("rel_path", "")
            f_curr = v.get("folder", "")
            if rp.startswith(folder_name + "/") or f_curr == folder_name:
                fname = os.path.basename(rp) if rp else f"{v.get('title', 'video')}.mp4"
                v["rel_path"] = f"Geral/{fname}"
                v["folder"] = "Geral"
        self._save_metadata(meta)
        return True

    def move_video(self, video_id: str, target_folder: str) -> Optional[Dict[str, Any]]:
        """Moves a video file to another folder on disk while preserving its ID."""
        video = self.get_video_by_id(video_id)
        if not video:
            return None

        clean_folder = target_folder.strip() or "Geral"
        dst_folder_path = os.path.join(self.base_dir, clean_folder)
        os.makedirs(dst_folder_path, exist_ok=True)

        filename = video.get("filename") or f"{video_id}.mp4"
        src_path = video.get("full_path")

        if src_path and os.path.exists(src_path):
            dst_path = os.path.join(dst_folder_path, filename)
            if src_path == dst_path:
                return video
            if os.path.exists(dst_path):
                base, ext = os.path.splitext(filename)
                dst_path = os.path.join(dst_folder_path, f"{base}_{int(time.time())}{ext}")
            try:
                shutil.move(src_path, dst_path)
                new_rel = os.path.relpath(dst_path, self.base_dir).replace("\\", "/")
            except Exception as e:
                print(f"Error moving physical video file: {e}")
                return None
        else:
            # Stream-only or remote video (no physical disk file)
            new_rel = f"{clean_folder}/{filename}"

        meta = self._load_metadata()
        entry = meta.get(video_id, {})
        entry["id"] = video_id
        entry["rel_path"] = new_rel
        entry["folder"] = clean_folder
        meta[video_id] = entry
        self._save_metadata(meta)
        return self.get_video_by_id(video_id)

    def rename_video(self, video_id: str, new_title: str) -> bool:
        """Renames a video's display title in metadata."""
        video = self.get_video_by_id(video_id)
        if not video:
            return False
        clean_title = new_title.strip()
        if not clean_title:
            return False

        meta = self._load_metadata()
        entry = meta.get(video_id, {})
        entry["title"] = clean_title
        entry["rel_path"] = video["rel_path"]
        entry["folder"] = video["folder"]
        meta[video_id] = entry
        self._save_metadata(meta)
        return True

    def toggle_favorite(self, video_id: str) -> bool:
        """Toggles the favorite state of a video."""
        video = self.get_video_by_id(video_id)
        if not video:
            return False

        meta = self._load_metadata()
        entry = meta.get(video_id, {})
        new_fav = not entry.get("is_favorite", False)
        entry["is_favorite"] = new_fav
        entry["rel_path"] = video["rel_path"]
        entry["folder"] = video["folder"]
        meta[video_id] = entry
        self._save_metadata(meta)
        return new_fav

    def delete_video(self, video_id: str) -> bool:
        """Deletes a video file from disk and cleans its metadata."""
        video = self.get_video_by_id(video_id)
        if not video:
            return False

        file_path = video.get("full_path")
        try:
            if file_path and os.path.exists(file_path):
                deleted = False
                for _ in range(3):
                    try:
                        os.remove(file_path)
                        deleted = True
                        break
                    except PermissionError:
                        time.sleep(0.15)
                        import gc
                        gc.collect()
                if not deleted and os.path.exists(file_path):
                    try:
                        temp_name = file_path + f".del_{int(time.time())}"
                        os.rename(file_path, temp_name)
                        os.remove(temp_name)
                    except Exception:
                        pass

            meta = self._load_metadata()
            entry_meta = meta.get(video_id, {})
            if entry_meta.get("storage_location") == "huggingface" or entry_meta.get("cloud_url"):
                try:
                    rel_p = entry_meta.get("rel_path") or (video.get("rel_path") if video else "")
                    if rel_p:
                        repo_p = f"videos/{rel_p}"
                        cloud_storage.delete_file(repo_p)
                except Exception as e:
                    print(f"[VideoService] Erro ao excluir do Hugging Face: {e}")

            if video_id in meta:
                del meta[video_id]
                self._save_metadata(meta)

            # Cleanup cached thumbnail
            thumb_path = os.path.join(self.thumbnails_dir, f"{video_id}.jpg")
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except Exception:
                    pass

            return True
        except Exception as e:
            print(f"Error deleting video {video_id}: {e}")
            return False

    def delete_multiple_videos(self, video_ids: list) -> list:
        """Deletes multiple videos from disk."""
        deleted = []
        for vid in video_ids:
            if self.delete_video(vid):
                deleted.append(vid)
        return deleted

    def move_multiple_videos(self, video_ids: list, target_folder: str) -> list:
        """Moves multiple videos to a target folder."""
        moved = []
        for vid in video_ids:
            res = self.move_video(vid, target_folder)
            if res:
                moved.append(vid)
        return moved

    def _trigger_background_upload(self, vid_id: str, local_path: str, folder: str, filename: str):
        """Uploads a video to Hugging Face asynchronously in background to prevent HTTP 504 timeout on Render."""
        import threading
        def _worker():
            try:
                if not cloud_storage.is_connected():
                    logger.warning(f"[VideoService] HF não conectado, mantendo {vid_id} apenas local.")
                    return
                repo_path = f"videos/{folder}/{filename}"
                logger.info(f"[VideoService] Iniciando upload em background para HF: {repo_path}")
                cloud_url = cloud_storage.upload_file(local_path, repo_path)
                if cloud_url:
                    logger.info(f"[VideoService] Upload para HF concluído com sucesso: {cloud_url}")
                    meta = self._load_metadata()
                    if vid_id in meta:
                        meta[vid_id]["storage_location"] = "huggingface"
                        meta[vid_id]["cloud_url"] = cloud_url
                        self._save_metadata(meta)
                else:
                    logger.warning(f"[VideoService] Upload para HF retornou vazio para {repo_path}")
            except Exception as e:
                logger.error(f"[VideoService] Erro no upload em background para HF ({vid_id}): {e}")

        t = threading.Thread(target=_worker, daemon=True)
        t.start()

    def save_uploaded_file(self, filename: str, content: bytes, folder: str = "Geral", source_origin: str = "pc", source_url: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Saves an uploaded video file to data/videos/{folder}/ and uploads to HF in background."""
        folder_path = os.path.join(self.base_dir, folder)
        os.makedirs(folder_path, exist_ok=True)

        clean_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_")).strip()
        if not clean_filename:
            clean_filename = f"video_{int(time.time())}.mp4"

        target_path = os.path.join(folder_path, clean_filename)
        if os.path.exists(target_path):
            base, ext = os.path.splitext(clean_filename)
            target_path = os.path.join(folder_path, f"{base}_{int(time.time())}{ext}")

        try:
            with open(target_path, "wb") as fp:
                fp.write(content)

            file_size = len(content)
            title = os.path.splitext(clean_filename)[0].replace("_", " ")
            rel_path = os.path.relpath(target_path, self.base_dir).replace("\\", "/")
            vid_id = self._get_video_id(rel_path)

            self._update_single_metadata(
                target_path,
                title=title,
                folder=folder,
                is_favorite=False,
                vid_id=vid_id,
                storage_location="render_local",
                file_size_bytes=file_size,
                source_origin=source_origin,
                source_url=source_url
            )

            # Upload assíncrono para Hugging Face sem travar a resposta HTTP
            self._trigger_background_upload(vid_id, target_path, folder, os.path.basename(target_path))

            # Gera thumbnail imediatamente
            try:
                self.get_or_generate_thumbnail(vid_id)
            except Exception as te:
                print(f"[VideoService] Falha ao gerar thumbnail: {te}")

            return self.get_video_by_id(vid_id)
        except Exception as e:
            print(f"Error saving uploaded video: {e}")
            return None

    def save_uploaded_file_stream(self, filename: str, file_obj: Any, folder: str = "Geral", source_origin: str = "pc") -> Optional[Dict[str, Any]]:
        """Saves an uploaded video stream directly to disk using 8MB chunks without loading whole file to RAM."""
        folder_path = os.path.join(self.base_dir, folder)
        os.makedirs(folder_path, exist_ok=True)

        clean_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_")).strip()
        if not clean_filename:
            clean_filename = f"video_{int(time.time())}.mp4"

        target_path = os.path.join(folder_path, clean_filename)
        if os.path.exists(target_path):
            base, ext = os.path.splitext(clean_filename)
            target_path = os.path.join(folder_path, f"{base}_{int(time.time())}{ext}")

        try:
            total_bytes = 0
            with open(target_path, "wb") as fp:
                while True:
                    chunk = file_obj.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    fp.write(chunk)
                    total_bytes += len(chunk)

            title = os.path.splitext(clean_filename)[0].replace("_", " ")
            rel_path = os.path.relpath(target_path, self.base_dir).replace("\\", "/")
            vid_id = self._get_video_id(rel_path)

            self._update_single_metadata(
                target_path,
                title=title,
                folder=folder,
                is_favorite=False,
                vid_id=vid_id,
                storage_location="render_local",
                file_size_bytes=total_bytes,
                source_origin=source_origin
            )

            # Upload assíncrono para Hugging Face sem travar a resposta HTTP
            self._trigger_background_upload(vid_id, target_path, folder, os.path.basename(target_path))

            # Gera thumbnail imediatamente
            try:
                self.get_or_generate_thumbnail(vid_id)
            except Exception as te:
                print(f"[VideoService] Falha ao gerar thumbnail: {te}")

            return self.get_video_by_id(vid_id)
        except Exception as e:
            print(f"Error saving uploaded video stream: {e}")
            return None

    def import_local_path(self, local_path: str, target_folder: str = "Geral", mode: str = "copy") -> List[Dict[str, Any]]:
        """
        Imports a video file or all videos from a local folder on the PC directly.
        Uses fast OS-level file copy/move, completing in fractions of a second.
        """
        clean_path = local_path.strip().strip('"').strip("'").strip()
        if not os.path.exists(clean_path):
            raise FileNotFoundError(f"Caminho não encontrado no computador: {clean_path}")

        dest_dir = os.path.join(self.base_dir, target_folder)
        os.makedirs(dest_dir, exist_ok=True)

        imported = []

        def _import_single_file(src_file: str):
            ext = os.path.splitext(src_file)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                return None
            fname = os.path.basename(src_file)
            target_dest = os.path.join(dest_dir, fname)
            if os.path.exists(target_dest):
                base, ext_ = os.path.splitext(fname)
                target_dest = os.path.join(dest_dir, f"{base}_{int(time.time())}{ext_}")

            if mode == "move":
                shutil.move(src_file, target_dest)
            else:
                shutil.copy2(src_file, target_dest)

            title = os.path.splitext(os.path.basename(target_dest))[0].replace("_", " ")
            rel_path = os.path.relpath(target_dest, self.base_dir).replace("\\", "/")
            vid_id = self._update_single_metadata(target_dest, title=title, folder=target_folder, is_favorite=False, source_origin="pc")
            self._trigger_background_upload(vid_id, target_dest, target_folder, os.path.basename(target_dest))
            try:
                self.get_or_generate_thumbnail(vid_id)
            except Exception:
                pass
            stat = os.stat(target_dest)
            return {
                "id": vid_id,
                "title": title,
                "filename": os.path.basename(target_dest),
                "folder": target_folder,
                "file_size_bytes": stat.st_size,
                "format": ext[1:].upper(),
                "is_favorite": False,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
                "rel_path": rel_path,
                "storage_location": "local",
                "source_origin": "pc",
                "stream_url": f"/api/videos/{vid_id}/stream",
                "download_url": f"/api/videos/{vid_id}/download",
                "thumbnail_url": f"/api/videos/{vid_id}/thumbnail"
            }

        if os.path.isfile(clean_path):
            item = _import_single_file(clean_path)
            if item:
                imported.append(item)
        elif os.path.isdir(clean_path):
            for root, dirs, files in os.walk(clean_path):
                for f in files:
                    full_f = os.path.join(root, f)
                    item = _import_single_file(full_f)
                    if item:
                        imported.append(item)

        return imported

    def open_in_explorer(self, folder: str = "Geral") -> bool:
        """Opens target video folder in Windows Explorer."""
        target_dir = os.path.join(self.base_dir, folder)
        os.makedirs(target_dir, exist_ok=True)
        if sys.platform == "win32":
            try:
                os.startfile(target_dir)
                return True
            except Exception as e:
                print(f"Error opening explorer: {e}")
                return False
        return False

    def _mirror_thumbnail_to_hf(self, video_id: str, thumb_path: str):
        """Mirrors generated thumbnail to Hugging Face dataset in background."""
        try:
            import threading
            threading.Thread(
                target=lambda: cloud_storage.upload_file(thumb_path, f"thumbnails/{video_id}.jpg"),
                daemon=True
            ).start()
        except Exception:
            pass

    def get_or_generate_thumbnail(self, video_id: str, thumbnail_url: Optional[str] = None) -> Optional[str]:
        """
        Retrieves, downloads or dynamically extracts a smart thumbnail for a video.
        1. Checks local cache in data/videos/.thumbnails/{video_id}.jpg.
        2. Tries to download from remote thumbnail_url (or metadata source_thumbnail_url).
        3. Uses FFmpeg to extract frame from local video file.
        4. Fallbacks to OpenCV if available.
        5. Mirrors generated thumbnail to Hugging Face dataset.
        """
        thumb_path = os.path.join(self.thumbnails_dir, f"{video_id}.jpg")
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 500:
            # Validar se o arquivo existente não é um frame preto/vinheta
            q = _evaluate_frame_quality(thumb_path)
            if q > 38.0:
                return thumb_path

        video = self.get_video_by_id(video_id)
        video_path = video.get("full_path") if video else None

        # 1. Tentar baixar a capa oficial do site original se tivermos a URL (da varredura ou metadados)
        target_thumb_url = thumbnail_url or (video.get("source_thumbnail_url") if video else None)
        if not target_thumb_url and video:
            candidate_thumb = video.get("thumbnail_url")
            if candidate_thumb and str(candidate_thumb).startswith("http") and "/api/videos/" not in str(candidate_thumb):
                target_thumb_url = candidate_thumb

        if target_thumb_url and str(target_thumb_url).startswith("http"):
            ref = (video.get("source_url") if video else None)
            if download_thumbnail_from_url(str(target_thumb_url), thumb_path, referer=ref):
                self._mirror_thumbnail_to_hf(video_id, thumb_path)
                return thumb_path

        # 2. Tentar extrair do miolo do arquivo de vídeo local usando FFmpeg (ignora vinhetas)
        if video_path and os.path.exists(video_path):
            if generate_thumbnail_ffmpeg(video_path, thumb_path):
                self._mirror_thumbnail_to_hf(video_id, thumb_path)
                return thumb_path

        # 3. Fallback: OpenCV se estiver instalado no ambiente
        if HAS_OPENCV and video_path and os.path.exists(video_path):
            try:
                cap = cv2.VideoCapture(video_path)
                if cap.isOpened():
                    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
                    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
                    duration = total_frames / fps if fps > 0 else 0

                    candidates = [1500, 3000, 5000, 800, 500]
                    if duration > 15:
                        candidates = [int(duration * 0.35 * 1000), int(duration * 0.50 * 1000), int(duration * 0.25 * 1000)]

                    best_frame = None
                    best_brightness = -1.0

                    for ms in candidates:
                        cap.set(cv2.CAP_PROP_POS_MSEC, ms)
                        ret, frame = cap.read()
                        if ret and frame is not None and frame.size > 0:
                            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                            brightness = float(np.mean(gray))
                            if brightness > best_brightness:
                                best_brightness = brightness
                                best_frame = frame
                            if brightness > 45:
                                break

                    if best_frame is None:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ret, frame = cap.read()
                        if ret and frame is not None:
                            best_frame = frame

                    cap.release()

                    if best_frame is not None:
                        h, w = best_frame.shape[:2]
                        target_w = 640
                        target_h = int(h * (target_w / w)) if w > 0 else 360
                        resized = cv2.resize(best_frame, (target_w, target_h), interpolation=cv2.INTER_AREA)

                        os.makedirs(self.thumbnails_dir, exist_ok=True)
                        cv2.imwrite(thumb_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        self._mirror_thumbnail_to_hf(video_id, thumb_path)
            except Exception as e:
                logger.warning(f"Error generating OpenCV thumbnail for {video_id}: {e}")

        # 4. Fallback para vídeos na nuvem / remotos (Hugging Face / web stream):
        cloud_url = (video.get("cloud_url") or video.get("stream_url") or video.get("source_url")) if video else None
        if cloud_url and str(cloud_url).startswith("http") and "/api/videos/" not in str(cloud_url):
            cloud_storage._get_api()
            hf_token = cloud_storage.token or os.getenv("HF_TOKEN")

            # 4a. Tentar baixar do HF se já existir na pasta thumbnails/
            if cloud_storage.repo_id:
                remote_hf_thumb = f"https://huggingface.co/datasets/{cloud_storage.repo_id}/resolve/main/thumbnails/{video_id}.jpg"
                if download_thumbnail_from_url(remote_hf_thumb, thumb_path, referer="https://huggingface.co", token=hf_token):
                    q = _evaluate_frame_quality(thumb_path)
                    if q > 38.0:
                        return thumb_path
                    else:
                        try:
                            os.remove(thumb_path)
                        except Exception:
                            pass

            # 4b. Extrair do stream remoto via FFmpeg inteligente (do miolo/ação do vídeo, evitando o começo)
            dur = float(video.get("duration_seconds") or 0.0)
            if generate_thumbnail_remote_ffmpeg(str(cloud_url), thumb_path, token=hf_token, duration_sec=dur):
                self._mirror_thumbnail_to_hf(video_id, thumb_path)
                return thumb_path

        return None

    def auto_heal_all_thumbnails(self, background: bool = False):
        """Scans all videos in the library and generates/regenerates thumbnails for any missing one or black/intro screens."""
        if background:
            import threading
            threading.Thread(target=self._run_auto_heal, daemon=True).start()
            return
        self._run_auto_heal()

    def _run_auto_heal(self):
        if getattr(self, "_is_healing", False):
            logger.info("Auto-heal thumbnails is already in progress, skipping duplicate call.")
            return

        self._is_healing = True
        try:
            all_vids = self.list_all_videos()
            missing = []
            for v in all_vids:
                vid_id = v.get("id")
                if not vid_id:
                    continue
                thumb_path = os.path.join(self.thumbnails_dir, f"{vid_id}.jpg")
                needs_healing = False
                if not os.path.exists(thumb_path) or os.path.getsize(thumb_path) < 500:
                    needs_healing = True
                else:
                    q = _evaluate_frame_quality(thumb_path)
                    if q <= 38.0:
                        needs_healing = True

                if needs_healing:
                    if os.path.exists(thumb_path):
                        try:
                            os.remove(thumb_path)
                        except Exception:
                            pass
                    missing.append(vid_id)

            if not missing:
                logger.info("Auto-heal: All videos have verified quality thumbnails.")
                return

            logger.info(f"Auto-heal: Generating thumbnails for {len(missing)} videos in background...")
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=3) as executor:
                list(executor.map(self.get_or_generate_thumbnail, missing))
            logger.info(f"Auto-heal: Successfully processed {len(missing)} videos.")
        except Exception as e:
            logger.warning(f"Error during auto_heal_all_thumbnails: {e}")
        finally:
            self._is_healing = False


video_service = VideoService()

