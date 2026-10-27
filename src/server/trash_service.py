"""
Unified Trash Service for AI-First Album & Media Studio.
Manages soft-deletion, restoration, permanent deletion, and empty-trash functionality
across photos, albums, and videos.
"""

import os
import sys
import shutil
import json
import time
import threading
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

# Determina a pasta raiz garantindo funcionamento dentro do executável (.exe) ou script Python
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    if os.path.basename(BASE_DIR).lower() == "dist":
        BASE_DIR = os.path.dirname(BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")


class TrashService:
    def __init__(self, data_dir: Optional[str] = None):
        if data_dir is None:
            data_dir = DEFAULT_DATA_DIR
        self.data_dir = os.path.abspath(data_dir)
        self.trash_dir = os.path.join(self.data_dir, "trash")
        self.trash_videos_dir = os.path.join(self.trash_dir, "videos")
        self.trash_albums_dir = os.path.join(self.trash_dir, "albums")
        self.trash_meta_file = os.path.join(self.trash_dir, "trash_metadata.json")

        self.videos_dir = os.path.join(self.data_dir, "videos")
        self.albums_dir = os.path.join(self.data_dir, "albums")

        os.makedirs(self.trash_videos_dir, exist_ok=True)
        os.makedirs(self.trash_albums_dir, exist_ok=True)
        self._last_hf_sync = 0.0

        # Restaura metadados da lixeira do Hugging Face se o disco do Render tiver resetado
        self._ensure_trash_restored()

        if not os.path.exists(self.trash_meta_file):
            self._save_meta({})

    def _ensure_trash_restored(self):
        """Restores trash metadata from Hugging Face if local file was wiped by Render restart."""
        try:
            from .video_service import cloud_storage
            if cloud_storage.is_connected():
                if not os.path.exists(self.trash_meta_file) or os.path.getsize(self.trash_meta_file) < 5:
                    remote_meta = cloud_storage.download_json("metadata/trash_metadata.json")
                    if remote_meta and isinstance(remote_meta, dict):
                        os.makedirs(os.path.dirname(self.trash_meta_file), exist_ok=True)
                        with open(self.trash_meta_file, "w", encoding="utf-8") as f:
                            json.dump(remote_meta, f, indent=2, ensure_ascii=False)
                        print(f"[TrashService] Trash restored from HF: {len(remote_meta)} items.")
        except Exception as e:
            print(f"[TrashService] Error restoring trash from HF: {e}")

    def _load_meta(self) -> Dict[str, Any]:
        try:
            if os.path.exists(self.trash_meta_file):
                with open(self.trash_meta_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading trash metadata: {e}")
        return {}

    def _save_meta(self, data: Dict[str, Any]):
        tmp_path = f"{self.trash_meta_file}.{os.getpid()}.{threading.get_ident()}.tmp"
        try:
            os.makedirs(os.path.dirname(self.trash_meta_file), exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, self.trash_meta_file)
        except Exception as e:
            print(f"Error saving trash metadata: {e}")
            return False
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        # Espelha metadados da lixeira no Hugging Face apenas se auto-sync estiver ativo
        try:
            from .video_service import cloud_storage, is_auto_cloud_sync_enabled
            now = time.time()
            if is_auto_cloud_sync_enabled() and cloud_storage.is_connected() and (now - getattr(self, "_last_hf_sync", 0.0) >= 30.0):
                self._last_hf_sync = now
                snapshot = dict(data)
                def _sync_trash():
                    cloud_storage.upload_json(snapshot, "metadata/trash_metadata.json")
                t = threading.Thread(target=_sync_trash, daemon=True)
                t.start()
        except Exception as e:
            print(f"[TrashService] Error syncing trash with HF: {e}")
        return True

    def list_all_items(self) -> List[Dict[str, Any]]:
        """Returns all items in the trash sorted newest deletion first."""
        meta = self._load_meta()
        items = list(meta.values())
        items.sort(key=lambda x: x.get("deleted_at", ""), reverse=True)
        return items

    def get_stats(self) -> Dict[str, Any]:
        """Calculates statistics for the Trash Bin."""
        items = self.list_all_items()
        photos_count = sum(1 for i in items if i.get("type") == "photo")
        videos_count = sum(1 for i in items if i.get("type") == "video")
        albums_count = sum(1 for i in items if i.get("type") == "album")
        total_size = sum(i.get("file_size_bytes", 0) for i in items)

        return {
            "total_items": len(items),
            "photos_count": photos_count,
            "videos_count": videos_count,
            "albums_count": albums_count,
            "total_size_bytes": total_size,
        }

    # -------------------------------------------------------------
    # MOVE TO TRASH
    # -------------------------------------------------------------

    def _prepare_video_trash_item(self, video_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Prepares a video trash dictionary and moves local file if present, without persisting metadata."""
        video_id = video_dict.get("id")
        if not video_id:
            return None

        src_path = video_dict.get("full_path")
        if not src_path or not os.path.exists(src_path):
            # Fallback path lookup
            rel = video_dict.get("rel_path", "")
            src_path = os.path.join(self.videos_dir, rel.replace("/", os.sep))

        filename = video_dict.get("filename", os.path.basename(src_path or "video.mp4"))
        trash_filename = f"{video_id}_{filename}"
        dst_path = os.path.join(self.trash_videos_dir, trash_filename)

        # Se existir arquivo físico local, move. Se for remoto (HF/cloud) ou stream_url, apenas registra na lixeira
        if src_path and os.path.isfile(src_path):
            if os.path.exists(dst_path):
                return None
            try:
                shutil.move(src_path, dst_path)
            except Exception as e:
                print(f"Error moving video file to trash: {e}")
                return None
        else:
            dst_path = ""
            trash_filename = None
            if video_dict.get("storage_location") in ("local", "render_local") and not (video_dict.get("cloud_url") or video_dict.get("custom_stream_url")):
                return None

        # Safe computation of file_size_bytes: avoid calling os.path.getsize when dst_path is empty or missing
        size_bytes = video_dict.get("file_size_bytes") or 0
        if not size_bytes and dst_path and os.path.exists(dst_path):
            try:
                size_bytes = os.path.getsize(dst_path)
            except Exception:
                size_bytes = 0

        storage_loc = video_dict.get("storage_location") or (
            "local" if dst_path and os.path.exists(dst_path) else "stream_url" if video_dict.get("custom_stream_url") or video_dict.get("stream_url") else "huggingface"
        )

        trash_id = f"trash_vid_{video_id}"
        item: Dict[str, Any] = {
            "id": trash_id,
            "type": "video",
            "title": video_dict.get("title", filename),
            "original_location": f"Folder: {video_dict.get('folder', 'General')}",
            "file_size_bytes": size_bytes,
            "thumbnail_url": video_dict.get("thumbnail_url") or f"/api/videos/{video_id}/thumbnail",
            "stream_url": f"/api/trash/videos/{trash_id}/stream",
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "original_video_id": video_id,
                "folder": video_dict.get("folder", "Geral"),
                "filename": filename,
                "trash_filename": trash_filename,
                "is_favorite": video_dict.get("is_favorite", False),
                "created_at": video_dict.get("created_at", ""),
                "width": video_dict.get("width", 0),
                "height": video_dict.get("height", 0),
                "fps": video_dict.get("fps", 0),
                "duration": video_dict.get("duration") or video_dict.get("duration_seconds", 0),
                "duration_seconds": video_dict.get("duration_seconds") or video_dict.get("duration", 0),
                "intro_end": video_dict.get("intro_end", 0.0),
                "highlight_start": video_dict.get("highlight_start", 0.0),
                "highlight_end": video_dict.get("highlight_end", 0.0),
                "highlight_score": video_dict.get("highlight_score", 0.0),
                "highlights": video_dict.get("highlights", []),
                "heatmap_data": video_dict.get("heatmap_data"),
                "storage_location": storage_loc,
                "cloud_url": video_dict.get("cloud_url"),
                "custom_stream_url": video_dict.get("custom_stream_url") or video_dict.get("stream_url"),
                "source_url": video_dict.get("source_url"),
                "source_id": video_dict.get("source_id"),
                "source_thumbnail_url": video_dict.get("source_thumbnail_url"),
                "source_origin": video_dict.get("source_origin") or ("web" if storage_loc == "stream_url" else "pc"),
                "rel_path": video_dict.get("rel_path", f"{video_dict.get('folder', 'Geral')}/{filename}"),
            },
        }
        return item

    def move_video_to_trash(self, video_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Moves a physical video file into data/trash/videos/ and registers it in trash metadata."""
        meta = self._load_meta()
        if f"trash_vid_{video_dict.get('id')}" in meta:
            return None
        item = self._prepare_video_trash_item(video_dict)
        if not item:
            return None

        meta[item["id"]] = item
        if self._save_meta(meta) is False:
            trash_filename = item["metadata"].get("trash_filename")
            if trash_filename:
                source = os.path.join(self.trash_videos_dir, trash_filename)
                original = video_dict.get("full_path") or os.path.join(self.videos_dir, video_dict.get("rel_path", "").replace("/", os.sep))
                try:
                    if os.path.exists(original):
                        raise FileExistsError(original)
                    shutil.move(source, original)
                except Exception as e:
                    print(f"Error rolling back video move; recoverable copy remains at {source}: {e}")
            return None
        return item

    def move_videos_to_trash_batch(self, video_dicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Moves multiple videos to trash atomically in a single metadata save."""
        meta = self._load_meta()
        created_items = []
        for v in video_dicts:
            item = self._prepare_video_trash_item(v)
            if item:
                meta[item["id"]] = item
                created_items.append(item)
        if created_items:
            self._save_meta(meta)
        return created_items

    def move_album_to_trash(self, session_id: str, album_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Moves an entire album JSON into data/trash/albums/ and registers it in trash metadata."""
        src_path = os.path.join(self.albums_dir, f"{session_id}.json")
        dst_path = os.path.join(self.trash_albums_dir, f"{session_id}.json")

        if not os.path.isfile(src_path) or os.path.exists(dst_path):
            return None

        trash_id = f"trash_album_{session_id}"
        total_size = sum(img.get("file_size") or 0 for img in album_summary.get("images", []))
        cover = album_summary.get("cover_image_url") or ""
        if not cover and album_summary.get("images"):
            cover = album_summary["images"][0].get("thumbnail_url") or album_summary["images"][0].get("original_url") or ""

        item: Dict[str, Any] = {
            "id": trash_id,
            "type": "album",
            "title": album_summary.get("title") or album_summary.get("original_title") or f"Álbum {session_id}",
            "original_location": f"Album Gallery ({len(album_summary.get('images', []))} photos)",
            "file_size_bytes": total_size,
            "thumbnail_url": cover,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "session_id": session_id,
                "album_title": album_summary.get("title") or album_summary.get("original_title"),
                "total_images": len(album_summary.get("images", [])),
                "source_page": album_summary.get("source_page", ""),
            },
        }

        meta = self._load_meta()
        meta[trash_id] = item
        try:
            shutil.move(src_path, dst_path)
        except Exception as e:
            print(f"Error moving album to trash: {e}")
            return None
        if self._save_meta(meta) is False:
            try:
                shutil.move(dst_path, src_path)
            except Exception as e:
                print(f"Error rolling back album move; recoverable copy remains at {dst_path}: {e}")
            return None
        return item

    def move_photos_to_trash(
        self, session_id: str, album_title: str, photos: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Registers individually deleted photos from an album into trash metadata."""
        meta = self._load_meta()
        created_items = []
        now_iso = datetime.now(timezone.utc).isoformat()

        for idx, photo in enumerate(photos):
            photo_id = photo.get("candidate_id") or photo.get("id") or f"{session_id}_{int(time.time())}_{idx}"
            trash_id = f"trash_photo_{session_id}_{photo_id}"
            if trash_id in meta:
                trash_id = f"{trash_id}_{time.time_ns()}_{idx}"

            w = photo.get("width", 0)
            h = photo.get("height", 0)
            dim_str = f" ({w}x{h})" if w and h else ""
            pos = photo.get("position", idx + 1)
            title = f"Foto #{pos}{dim_str}"

            thumb = photo.get("thumbnail_url") or photo.get("original_url") or ""

            item: Dict[str, Any] = {
                "id": trash_id,
                "type": "photo",
                "title": title,
                "original_location": f"Album: {album_title or session_id}",
                "file_size_bytes": photo.get("file_size") or 0,
                "thumbnail_url": thumb,
                "deleted_at": now_iso,
                "metadata": {
                    "session_id": session_id,
                    "album_title": album_title,
                    "photo_data": photo,
                    "original_position": pos,
                },
            }
            meta[trash_id] = item
            created_items.append(item)

        if self._save_meta(meta) is False:
            return []
        return created_items

    # -------------------------------------------------------------
    # RESTORE
    # -------------------------------------------------------------

    def restore_item(self, trash_id: str) -> Optional[Dict[str, Any]]:
        """Restores a single item (photo, video, or album) back to its original location."""
        meta = self._load_meta()
        item = meta.get(trash_id)
        if not item:
            return None

        item_type = item.get("type")
        item_meta = item.get("metadata", {})
        restored_album_paths = None

        if item_type == "video":
            # Restore video file
            trash_filename = item_meta.get("trash_filename")
            orig_filename = item_meta.get("filename")
            folder = item_meta.get("folder", "Geral")
            orig_id = item_meta.get("original_video_id")

            src_path = os.path.join(self.trash_videos_dir, trash_filename) if trash_filename else ""
            dst_folder = os.path.join(self.videos_dir, folder)
            os.makedirs(dst_folder, exist_ok=True)
            dst_path = os.path.join(dst_folder, orig_filename) if orig_filename else ""

            if src_path and os.path.exists(src_path) and dst_path:
                try:
                    shutil.move(src_path, dst_path)
                except Exception as e:
                    print(f"Error restoring video file: {e}")
                    return None

            # Re-register video in video_service metadata
            from .video_service import video_service

            v_meta = video_service._load_metadata()
            rel_path = item_meta.get("rel_path") or f"{folder}/{orig_filename}"
            storage_loc = item_meta.get("storage_location") or (
                "local" if dst_path and os.path.exists(dst_path) else "stream_url" if item_meta.get("custom_stream_url") else "huggingface"
            )

            v_meta[orig_id] = {
                "id": orig_id,
                "title": item.get("title", orig_filename),
                "rel_path": rel_path,
                "folder": folder,
                "is_favorite": item_meta.get("is_favorite", False),
                "created_at": item_meta.get("created_at", datetime.now(timezone.utc).isoformat()),
                "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                "width": item_meta.get("width", 0),
                "height": item_meta.get("height", 0),
                "fps": item_meta.get("fps", 0),
                "duration": item_meta.get("duration", 0),
                "duration_seconds": item_meta.get("duration_seconds") or item_meta.get("duration", 0),
                "intro_end": item_meta.get("intro_end", 0.0),
                "highlight_start": item_meta.get("highlight_start", 0.0),
                "highlight_end": item_meta.get("highlight_end", 0.0),
                "highlight_score": item_meta.get("highlight_score", 0.0),
                "highlights": item_meta.get("highlights", []),
                "heatmap_data": item_meta.get("heatmap_data"),
                "storage_location": storage_loc,
                "cloud_url": item_meta.get("cloud_url"),
                "file_size_bytes": item.get("file_size_bytes", 0),
                "custom_stream_url": item_meta.get("custom_stream_url"),
                "source_url": item_meta.get("source_url"),
                "source_id": item_meta.get("source_id"),
                "source_thumbnail_url": item_meta.get("source_thumbnail_url"),
                "source_origin": item_meta.get("source_origin") or ("web" if storage_loc == "stream_url" else "pc"),
            }
            video_service._save_metadata(v_meta)

        elif item_type == "album":
            # Restore album JSON
            session_id = item_meta.get("session_id")
            src_path = os.path.join(self.trash_albums_dir, f"{session_id}.json")
            dst_path = os.path.join(self.albums_dir, f"{session_id}.json")

            if not os.path.isfile(src_path) or os.path.exists(dst_path):
                return None
            try:
                shutil.move(src_path, dst_path)
                restored_album_paths = (src_path, dst_path)
            except Exception as e:
                print(f"Error restoring album file: {e}")
                return None

        elif item_type == "photo":
            # Restore photo into album JSON
            session_id = item_meta.get("session_id")
            photo_data = item_meta.get("photo_data")
            if not session_id or not isinstance(photo_data, dict) or not photo_data:
                return None
            if session_id and photo_data:
                album_path = os.path.join(self.albums_dir, f"{session_id}.json")
                # If album is not in data/albums/, check if it's currently in trash
                if not os.path.exists(album_path):
                    trashed_album_path = os.path.join(self.trash_albums_dir, f"{session_id}.json")
                    if os.path.exists(trashed_album_path):
                        album_path = trashed_album_path

                if not os.path.isfile(album_path):
                    return None
                if os.path.exists(album_path):
                    try:
                        with open(album_path, "r", encoding="utf-8") as f:
                            alb = json.load(f)
                        images = alb.get("images", [])
                        # Empty IDs are not identities: extracted/uploaded images may only
                        # carry a candidate ID or their source URL.
                        identity_field = next((field for field in (
                            "id", "candidate_id", "original_url", "thumbnail_url"
                        ) if photo_data.get(field)), None)
                        already_present = bool(identity_field) and any(
                            img.get(identity_field) == photo_data[identity_field] for img in images
                        )
                        if not already_present:
                            images.append(photo_data)
                            for new_p, img in enumerate(images):
                                img["position"] = new_p + 1
                            alb["images"] = images
                            now_ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                            alb["updated_at"] = now_ts
                            if "metadata" in alb and isinstance(alb["metadata"], dict):
                                alb["metadata"]["updated_at"] = now_ts
                            tmp_path = f"{album_path}.{os.getpid()}.{threading.get_ident()}.tmp"
                            try:
                                with open(tmp_path, "w", encoding="utf-8") as f:
                                    json.dump(alb, f, indent=2, ensure_ascii=False)
                                os.replace(tmp_path, album_path)
                            finally:
                                if os.path.exists(tmp_path):
                                    os.remove(tmp_path)
                    except Exception as e:
                        print(f"Error inserting restored photo into album: {e}")
                        return None

        # Remove from trash metadata
        del meta[trash_id]
        if self._save_meta(meta) is False:
            if restored_album_paths:
                trash_path, album_path = restored_album_paths
                try:
                    if os.path.exists(trash_path):
                        raise FileExistsError(trash_path)
                    shutil.move(album_path, trash_path)
                except Exception as e:
                    print(f"Error rolling back album restore; recoverable copy remains at {album_path}: {e}")
            return None
        return item

    def restore_multiple(self, trash_ids: List[str]) -> List[str]:
        """Restores multiple items by their trash IDs."""
        restored = []
        for tid in trash_ids:
            res = self.restore_item(tid)
            if res:
                restored.append(tid)
        return restored

    # -------------------------------------------------------------
    # PERMANENT DELETE & EMPTY TRASH
    # -------------------------------------------------------------

    def permanent_delete_item(self, trash_id: str) -> bool:
        """Permanently deletes an item from disk, cloud storage, and trash metadata."""
        meta = self._load_meta()
        item = meta.get(trash_id)
        if not item:
            return False

        item_type = item.get("type")
        item_meta = item.get("metadata", {})

        if item_type == "video":
            # 1. Apaga arquivo físico local caso exista na pasta da lixeira
            trash_filename = item_meta.get("trash_filename")
            if trash_filename:
                vpath = os.path.join(self.trash_videos_dir, trash_filename)
                if os.path.exists(vpath):
                    try:
                        os.remove(vpath)
                    except Exception as e:
                        print(f"Error permanently deleting local video file: {e}")

            # 2. Apaga fisicamente do Hugging Face para liberar espaço na nuvem (se aplicável, ignorando stream_url puro)
            if item_meta.get("storage_location") != "stream_url":
                try:
                    from .video_service import cloud_storage
                    if cloud_storage.is_connected():
                        rel_path = item_meta.get("rel_path")
                        if rel_path:
                            hf_repo_path = f"videos/{rel_path}"
                            deleted_hf = cloud_storage.delete_file(hf_repo_path)
                            if deleted_hf:
                                print(f"[TrashService] Arquivo deletado permanentemente do HF: {hf_repo_path}")
                except Exception as e:
                    print(f"[TrashService] Error deleting file from Hugging Face: {e}")

            # 3. Deleta thumbnail em cache se houver (.jpg e .webp)
            orig_id = item_meta.get("original_video_id")
            if orig_id:
                for ext in [".jpg", ".webp"]:
                    thumb_path = os.path.join(self.videos_dir, ".thumbnails", f"{orig_id}{ext}")
                    if os.path.exists(thumb_path):
                        try:
                            os.remove(thumb_path)
                        except Exception:
                            pass

        elif item_type == "album":
            session_id = item_meta.get("session_id")
            if session_id:
                apath = os.path.join(self.trash_albums_dir, f"{session_id}.json")
                if os.path.exists(apath):
                    try:
                        os.remove(apath)
                    except Exception as e:
                        print(f"Error permanently deleting album file: {e}")

                # Também remove do Hugging Face se estiver lá
                try:
                    from .video_service import cloud_storage
                    if cloud_storage.is_connected():
                        cloud_storage.delete_file(f"albums/{session_id}.json")
                except Exception as e:
                    print(f"[TrashService] Error deleting album from HF: {e}")

        # Remove dos metadados da lixeira
        del meta[trash_id]
        self._save_meta(meta)
        return True

    def permanent_delete_multiple(self, trash_ids: List[str]) -> List[str]:
        """Permanently deletes multiple items by their trash IDs."""
        deleted = []
        for tid in trash_ids:
            if self.permanent_delete_item(tid):
                deleted.append(tid)
        return deleted

    def empty_trash(self) -> Dict[str, Any]:
        """Completely empties all items in the Trash Bin permanently (local and Hugging Face cloud)."""
        meta = self._load_meta()
        trash_ids = list(meta.keys())
        total_items = len(trash_ids)

        for tid in trash_ids:
            try:
                self.permanent_delete_item(tid)
            except Exception as e:
                print(f"[TrashService] Erro ao deletar permanentemente item {tid}: {e}")

        # Clear any remaining files in trash directories
        if os.path.exists(self.trash_videos_dir):
            for f in os.listdir(self.trash_videos_dir):
                fp = os.path.join(self.trash_videos_dir, f)
                if os.path.isfile(fp):
                    try:
                        os.remove(fp)
                    except Exception:
                        pass

        if os.path.exists(self.trash_albums_dir):
            for f in os.listdir(self.trash_albums_dir):
                fp = os.path.join(self.trash_albums_dir, f)
                if os.path.isfile(fp):
                    try:
                        os.remove(fp)
                    except Exception:
                        pass

        self._save_meta({})

        return {
            "success": True,
            "items_purged": total_items,
            "message": "Trash emptied successfully",
        }


trash_service = TrashService()
