"""
Observability & Telemetry Debugger.
Formats structured telemetry, candidate decision traces,
and evidence trails for logging and UI streaming.
"""

from typing import List, Dict, Any
from ..core.models import Album, StructuredAuditTrail, TelemetryMetrics
from ..core.media_classification import media_category


class AgentDebugger:
    """
    Renders structured, readable audit reports and UI payloads
    without leaking private LLM chain-of-thought.
    """

    @staticmethod
    def format_console_report(album: Album) -> str:
        """Generates a structured human-readable text audit report."""
        t: TelemetryMetrics = album.telemetry
        lines = []
        lines.append("=" * 60)
        lines.append("PAGE ANALYSIS & DISCOVERY REPORT")
        lines.append("=" * 60)
        lines.append(f"Title: {album.title}")
        lines.append(f"Source Page: {album.source_page}")
        lines.append(f"Source Type: {album.source_type}")
        if album.forum_thread_url:
            lines.append(f"Forum Thread: {album.forum_thread_url}")
            lines.append(f"External Album Target: {album.external_album_url}")
        lines.append("-" * 60)
        lines.append("TELEMETRY METRICS:")
        lines.append(f"  AI Actions Count: {t.ai_actions_count}")
        lines.append(f"  Browser Actions Count: {t.browser_actions_count}")
        lines.append(f"  Candidates Discovered: {t.candidates_discovered}")
        lines.append(f"  Candidates Investigated: {t.candidates_investigated}")
        lines.append(f"  Originals Resolved: {t.originals_resolved}")
        lines.append(f"  Originals Unresolved: {t.originals_unresolved}")
        lines.append(f"  Banners Rejected: {t.banners_rejected}")
        lines.append(f"  Related Items Rejected: {t.related_rejected}")
        lines.append(f"  Site-Wide Items Rejected: {t.site_wide_rejected}")
        lines.append(f"  Resolution Methods: {t.resolution_methods}")
        lines.append("-" * 60)
        lines.append("CANDIDATE AUDIT TRAILS:")

        for i, audit in enumerate(album.audit_trails):
            lines.append(f"\nCandidate #{i+1} ({audit.candidate_id})")
            lines.append(f"  Classification: {audit.classification.value}")
            lines.append("  Evidence:")
            for ev in audit.classification_evidence:
                lines.append(f"    - {ev}")
            lines.append("  Investigation Actions:")
            for act in audit.actions:
                lines.append(f"    -> {act}")
            lines.append(f"  Validation Verdict: {audit.validation_verdict.value if audit.validation_verdict else 'N/A'}")
            if audit.failure_reason:
                lines.append(f"  Reason: {audit.failure_reason}")
            if audit.resolved_url:
                lines.append(f"  Resolved Original URL: {audit.resolved_url}")
                lines.append(f"  Resolution Method: {audit.resolution_method.value}")
                lines.append(f"  Dimensions: {audit.dimensions}")
            lines.append(f"  Final Status: {'ACCEPTED' if audit.result == 'resolved' else 'UNRESOLVED'}")

        lines.append("=" * 60)
        return "\n".join(lines)

    @staticmethod
    def get_ui_summary(album: Album) -> Dict[str, Any]:
        """Returns clean structured JSON summary for web UI."""
        def _dump(obj):
            if hasattr(obj, "model_dump"):
                return obj.model_dump()
            elif hasattr(obj, "dict"):
                return obj.dict()
            return obj

        return {
            "album_id": album.album_id,
            "title": album.title,
            "original_title": album.original_title,
            "source_page": album.source_page,
            "source_type": album.source_type,
            "cover_image_url": album.cover_image_url,
            "cover_color_palette": getattr(album, "cover_color_palette", None) or (album.images[0].color_palette if album.images and album.images[0].color_palette else None),
            "total_images": len(album.images),
            "telemetry": _dump(album.telemetry) if album.telemetry else {},
            "images": [_dump(img) for img in album.images],
            "audit_trails": [_dump(audit) for audit in album.audit_trails],
            "source_origin": getattr(album, "source_origin", None) or (album.metadata.get("source_origin") if isinstance(album.metadata, dict) else None) or "remote",
            "folder": getattr(album, "folder", None) or (album.metadata.get("folder") if isinstance(album.metadata, dict) else None) or "Geral",
            "tags": getattr(album, "tags", []) or [],
            "has_gifs": any(media_category(i) == "gif" for i in album.images),
            "gif_count": sum(media_category(i) == "gif" for i in album.images),
            "created_at": getattr(album, "created_at", None) or (album.metadata.get("created_at") if isinstance(album.metadata, dict) else None) or (album.metadata.get("saved_at") if isinstance(album.metadata, dict) else None),
            "updated_at": getattr(album, "updated_at", None) or (album.metadata.get("updated_at") if isinstance(album.metadata, dict) else None),
            "is_favorite": getattr(album, "is_favorite", False) or (album.metadata.get("is_favorite", False) if isinstance(album.metadata, dict) else False),
            "metadata": album.metadata if isinstance(album.metadata, dict) else {},
        }

