"""
Core Data Models for AI-First Browser Agent.
Defines models for semantic classification, candidate investigation,
validation results, telemetry, audit trails, and structured album entities.
"""

from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class PageClassification(str, Enum):
    ALBUM = "album"
    GALLERY = "gallery"
    PROFILE = "profile"
    FORUM = "forum"
    THREAD = "thread"
    ARTICLE = "article"
    SEARCH = "search"
    UNKNOWN = "unknown"


class CandidateClassification(str, Enum):
    ALBUM_IMAGE_CANDIDATE = "album_image_candidate"
    THUMBNAIL_CANDIDATE = "thumbnail_candidate"
    RELATED_IMAGE = "related_image"
    SITE_WIDE_IMAGE = "site_wide_image"
    BANNER = "banner"
    LOGO = "logo"
    AVATAR = "avatar"
    DECORATIVE_IMAGE = "decorative_image"
    UNKNOWN = "unknown"


class SemanticRegionType(str, Enum):
    MAIN_CONTENT = "main_content"
    ALBUM_CONTENT = "album_content"
    RELATED_CONTENT = "related_content"
    NAVIGATION = "navigation"
    HEADER = "header"
    FOOTER = "footer"
    ADVERTISEMENT = "advertisement"
    SIDEBAR = "sidebar"
    COMMENTS = "comments"
    EXTERNAL_LINKS = "external_links"


class ResolutionMethod(str, Enum):
    SRCSET = "srcset"
    DATA_ATTRIBUTE = "data_attribute"
    INDIVIDUAL_PAGE = "individual_page"
    EMBEDDED_JSON = "embedded_json"
    NETWORK = "network"
    VERIFIED_CDN_CANDIDATE = "verified_cdn_candidate"
    PARENT_ANCHOR = "parent_anchor"
    PARENT_LINK = "parent_link"
    DIRECT = "direct"
    NONE = "none"


class ValidationVerdict(str, Enum):
    PASS = "PASS"
    REJECT = "REJECT"
    UNRESOLVED = "UNRESOLVED"


class ValidationResult(BaseModel):
    verdict: ValidationVerdict
    target_url: str = ""
    status_code: Optional[int] = None
    content_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: Optional[str] = None
    file_size: Optional[int] = None
    aspect_ratio: Optional[float] = None
    aspect_ratio_diff: Optional[float] = None
    reason: Optional[str] = None
    is_valid: bool = False
    color_palette: Optional[List[str]] = None
    is_animated: bool = False
    animation_checked: bool = False


class DOMCandidateInfo(BaseModel):
    candidate_id: str
    selector: str
    tag_name: str = "img"
    src: Optional[str] = None
    current_src: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    alt: Optional[str] = None
    title: Optional[str] = None
    classes: List[str] = Field(default_factory=list)
    parent_tag: Optional[str] = None
    parent_href: Optional[str] = None
    container_selector: Optional[str] = None
    container_id: Optional[str] = None
    container_class: Optional[str] = None
    sibling_index: int = 0
    total_siblings: int = 1
    dataset: Dict[str, str] = Field(default_factory=dict)
    srcset: Optional[str] = None
    is_displayed: bool = True
    surrounding_text: Optional[str] = None
    media_type: str = "image"  # "image", "video", "gif"
    poster_url: Optional[str] = None
    duration_seconds: Optional[float] = None
    is_animated: bool = False
    video_sources: List[str] = Field(default_factory=list)


class StructuredAuditTrail(BaseModel):
    candidate_id: str
    classification: CandidateClassification
    classification_evidence: List[str] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)
    result: str = "unresolved"  # "resolved", "rejected", "unresolved"
    resolution_method: ResolutionMethod = ResolutionMethod.NONE
    validation_verdict: Optional[ValidationVerdict] = None
    failure_reason: Optional[str] = None
    resolved_url: Optional[str] = None
    dimensions: Optional[str] = None


class TelemetryMetrics(BaseModel):
    ai_actions_count: int = 0
    browser_actions_count: int = 0
    candidates_discovered: int = 0
    candidates_investigated: int = 0
    originals_resolved: int = 0
    originals_unresolved: int = 0
    banners_rejected: int = 0
    related_rejected: int = 0
    site_wide_rejected: int = 0
    resolution_methods: Dict[str, int] = Field(default_factory=dict)
    duration_seconds: float = 0.0


class AlbumImage(BaseModel):
    id: Optional[str] = None
    position: int
    candidate_id: Optional[str] = None
    thumbnail_url: str
    original_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: Optional[str] = None
    file_size: Optional[int] = None
    resolution_method: ResolutionMethod = ResolutionMethod.NONE
    confidence: float = 1.0
    validation_status: str = "PASS"  # "PASS" or "UNRESOLVED"
    source_page: Optional[str] = None
    color_palette: Optional[List[str]] = None
    media_type: str = "image"  # "image", "video", "gif"
    is_animated: bool = False
    animation_checked: bool = False
    video_stream_url: Optional[str] = None
    poster_url: Optional[str] = None
    duration_seconds: Optional[float] = None
    title: Optional[str] = None


class LinkCandidate(BaseModel):
    url: str
    text: str
    context_text: Optional[str] = None
    is_external: bool = False
    is_album_candidate: bool = False
    score: float = 0.0


class Album(BaseModel):
    album_id: str
    title: str
    original_title: str
    artist: Optional[str] = None
    source_page: str
    source_type: str = "gallery"  # "gallery" or "forum"
    forum_thread_url: Optional[str] = None
    external_album_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    cover_color_palette: Optional[List[str]] = None
    images: List[AlbumImage] = Field(default_factory=list)
    telemetry: TelemetryMetrics = Field(default_factory=TelemetryMetrics)
    audit_trails: List[StructuredAuditTrail] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    source_origin: Optional[str] = "remote"
    folder: Optional[str] = "Geral"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    is_favorite: Optional[bool] = False

