"""
Semantic Brain & General-Purpose Autonomous AI Browser Agent.
Implements the AI-in-the-loop control architecture:
OBSERVE -> PLAN -> ACT -> OBSERVE RESULT -> REASON -> VALIDATE -> FINISH
Powered by InvestigationController (Section 24) and KnowledgeStore.
"""

import asyncio
import logging
import re
from typing import List, Dict, Any, Optional, Tuple, Callable, Awaitable
from urllib.parse import urlparse

from ..core.models import (
    Album,
    AlbumImage,
    PageClassification,
    CandidateClassification,
    ResolutionMethod,
    ValidationVerdict,
    ValidationResult,
    StructuredAuditTrail,
    TelemetryMetrics,
    DOMCandidateInfo,
)
from ..browser.engine import BrowserEngine
from ..browser.tools import BrowserTools
from ..validator.validator import ImageValidator
from ..core.media_classification import normalize_media_item, media_category
from ..investigator.investigator import OriginalImageInvestigator
from ..learning.knowledge_store import KnowledgeStore, SiteKnowledge
from ..learning.demonstration_analyzer import DemonstrationAnalyzer
from .llm_adapter import LLMAdapter
from .controller import InvestigationController, EvidenceLedger, CandidateGroup

logger = logging.getLogger(__name__)


def _safe_cover(imgs: List[AlbumImage]) -> Optional[str]:
    """Finds first valid non-placeholder image URL for album cover."""
    for i in imgs:
        for u in (i.original_url, i.thumbnail_url):
            if u and not any(p in u.lower() for p in ("1px.png", "1px.gif", "blank.gif", "spacer.gif", "transparent.png")):
                return u
    return None


class SemanticAgentBrain:
    """
    General-Purpose Autonomous AI Browser Agent.
    Orchestrates Qwen's semantic decisions over deterministic tools and state management.
    """

    def __init__(
        self,
        engine: BrowserEngine,
        tools: BrowserTools,
        validator: ImageValidator,
        investigator: OriginalImageInvestigator,
        llm_adapter: Optional[LLMAdapter] = None,
        knowledge_store: Optional[KnowledgeStore] = None,
        candidate_budget: int = 8,
        session_budget: int = 80,
    ):
        self.engine = engine
        self.tools = tools
        self.validator = validator
        self.investigator = investigator
        self.llm_adapter = llm_adapter or LLMAdapter()
        if not getattr(self.investigator, "llm_adapter", None):
            self.investigator.llm_adapter = self.llm_adapter
        self.knowledge_store = knowledge_store or KnowledgeStore()
        self.candidate_budget = candidate_budget
        self.session_budget = session_budget

    async def run(
        self,
        target_url: str,
        on_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        controller: Optional[InvestigationController] = None,
        media_type_filter: str = "all",
    ) -> Album:
        """
        Executes Mode 1 — Fully Autonomous Extraction:
        OBSERVE -> PLAN -> ACT -> OBSERVE RESULT -> REASON -> VALIDATE -> FINISH
        """
        controller = controller or InvestigationController(
            candidate_budget=self.candidate_budget,
            session_budget=self.session_budget,
        )
        telemetry = TelemetryMetrics()
        audit_trails: List[StructuredAuditTrail] = []
        domain = urlparse(target_url).netloc

        # Check for generalized learned prior
        learned_prior: Optional[SiteKnowledge] = self.knowledge_store.get_knowledge(domain)
        if learned_prior:
            logger.info(f"Loaded soft semantic prior for {domain} (Demonstrations: {learned_prior.demonstration_count})")

        # -------------------------------------------------------------
        # STEP 1: HIERARCHICAL PAGE OBSERVATION (24.9)
        # -------------------------------------------------------------
        telemetry.browser_actions_count += 1
        controller.record_action_execution("navigate", target_url)
        await self.engine.navigate(target_url)

        telemetry.browser_actions_count += 1
        controller.record_action_execution("wait_for_idle", target_url)
        await self.engine.wait_for_idle(2000)

        # Give dynamic media / JS video players extra time to load network streams
        if media_type_filter in ("videos", "all"):
            await asyncio.sleep(2.5)

        # Update validator session
        cookies = await self.engine.get_session_cookies()
        self.validator.update_session(cookies=cookies)

        telemetry.browser_actions_count += 1
        page_info = await self.tools.inspect_page()
        controller.record_action_execution("inspect_page", target_url, result_data=page_info)
        headings = page_info.get("headings", [])
        containers = page_info.get("containers", [])

        # -------------------------------------------------------------
        # STEP 2: QWEN REASON - Semantic Classification & Intent
        # -------------------------------------------------------------
        telemetry.ai_actions_count += 1
        classification_res = await self.llm_adapter.query_semantic_classification(
            page_info, containers, headings
        )
        page_type_str = classification_res.get("page_type", "gallery").lower()
        raw_title = page_info.get("title", "") or "Untitled Album"

        # Interstitial / age-gate guard: if title is age verification or ad splash, dismiss and re-inspect
        if any(w in raw_title.lower() for w in ("age verification", "verification", "disclaimer", "consent", "gate", "cookie", "robot")):
            await self.engine.dismiss_age_gates_and_popups(self.engine.main_page)
            await asyncio.sleep(1.0)
            page_info = await self.tools.inspect_page()
            raw_title = page_info.get("title", "") or "Untitled Album"

        if headings and len(headings[0].get("text", "")) > 0:
            h_text = headings[0]["text"].strip()
            if len(h_text) > 3 and (len(raw_title) < 5 or any(w in raw_title.lower() for w in ("gallery", "verification", "disclaimer", "consent"))):
                raw_title = h_text

        # -------------------------------------------------------------
        # STEP 3: TYPE B (FORUM THREAD) AUTONOMOUS FLOW
        # -------------------------------------------------------------
        if page_type_str in ("forum", "thread") or classification_res.get("is_forum_with_external_link"):
            telemetry.ai_actions_count += 1
            telemetry.browser_actions_count += 1
            thread_url = target_url
            dest_url = classification_res.get("external_album_url")

            if dest_url:
                logger.info(f"Forum thread points to external host: {dest_url}")
                telemetry.browser_actions_count += 1
                controller.record_action_execution("navigate_external_host", dest_url)
                await self.engine.navigate(dest_url)
                await self.engine.wait_for_idle(2000)
                ext_page_info = await self.tools.inspect_page()
                containers = ext_page_info.get("containers", [])
                target_url = dest_url
                raw_title = ext_page_info.get("title", raw_title)

            return await self._execute_investigation_loop(
                target_url=target_url,
                raw_title=raw_title,
                source_type="forum",
                forum_thread_url=thread_url,
                external_album_url=dest_url,
                containers=containers,
                learned_prior=learned_prior,
                controller=controller,
                telemetry=telemetry,
                audit_trails=audit_trails,
                on_event=on_event,
                media_type_filter=media_type_filter,
            )

        # -------------------------------------------------------------
        # STEP 4: TYPE A (GALLERY / ALBUM) AUTONOMOUS FLOW
        # -------------------------------------------------------------
        return await self._execute_investigation_loop(
            target_url=target_url,
            raw_title=raw_title,
            source_type="gallery",
            forum_thread_url=None,
            external_album_url=None,
            containers=containers,
            learned_prior=learned_prior,
            controller=controller,
            telemetry=telemetry,
            audit_trails=audit_trails,
            on_event=on_event,
            media_type_filter=media_type_filter,
        )

    async def _execute_investigation_loop(
        self,
        target_url: str,
        raw_title: str,
        source_type: str,
        forum_thread_url: Optional[str],
        external_album_url: Optional[str],
        containers: List[Dict[str, Any]],
        learned_prior: Optional[SiteKnowledge],
        controller: InvestigationController,
        telemetry: TelemetryMetrics,
        audit_trails: List[StructuredAuditTrail],
        on_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        media_type_filter: str = "all",
    ) -> Album:
        """
        Executes autonomous candidate grouping, classification, budget-guarded
        investigation, and validation loop.
        """
        telemetry.browser_actions_count += 1
        raw_candidates = await self.tools.get_all_media_candidates(media_filter=media_type_filter)
        controller.record_action_execution("get_all_media_candidates", target_url, result_data=len(raw_candidates))
        telemetry.candidates_discovered = len(raw_candidates)

        # 24.8 Group-Level Reasoning
        candidate_groups = controller.group_candidates(raw_candidates)
        primary_container, related_container = self._select_containers(candidate_groups, learned_prior)

        # Classify all candidates
        classified_candidates: List[Tuple[DOMCandidateInfo, CandidateClassification, List[str]]] = []
        for cand in raw_candidates:
            telemetry.ai_actions_count += 1
            cls, evidence = self._classify_candidate(
                cand=cand,
                primary_container=primary_container,
                related_container=related_container,
                learned_prior=learned_prior,
            )
            classified_candidates.append((cand, cls, evidence))

            if cls == CandidateClassification.BANNER:
                telemetry.banners_rejected += 1
            elif cls == CandidateClassification.RELATED_IMAGE:
                telemetry.related_rejected += 1
            elif cls in (
                CandidateClassification.SITE_WIDE_IMAGE,
                CandidateClassification.LOGO,
                CandidateClassification.AVATAR,
                CandidateClassification.DECORATIVE_IMAGE,
            ):
                telemetry.site_wide_rejected += 1

        # Queue only album and thumbnail candidates
        investigation_queue = [
            (cand, cls, ev)
            for cand, cls, ev in classified_candidates
            if cls in (CandidateClassification.THUMBNAIL_CANDIDATE, CandidateClassification.ALBUM_IMAGE_CANDIDATE)
        ]

        # Emit live initial event
        if on_event:
            await on_event({
                "type": "album_init",
                "title": raw_title,
                "original_title": raw_title,
                "source_page": target_url,
                "source_type": source_type,
                "forum_thread_url": forum_thread_url,
                "external_album_url": external_album_url,
                "total_candidates": len(investigation_queue),
                "telemetry": telemetry.model_dump(),
            })

        resolved_images: List[AlbumImage] = []
        proven_highres_urls: List[str] = []

        # -------------------------------------------------------------
        # ITERATIVE CONTROLLER-GUARDED INVESTIGATION LOOP
        # -------------------------------------------------------------
        for idx, (cand, cls, evidence) in enumerate(investigation_queue):
            position = idx + 1
            telemetry.candidates_investigated += 1

            if on_event:
                await on_event({
                    "type": "inspecting_candidate",
                    "position": position,
                    "candidate_id": cand.candidate_id,
                    "url": cand.src,
                    "selector": getattr(cand, "selector", None) or f"img#{cand.candidate_id}",
                })

            # Check candidate budget & loop prevention
            can_investigate, budget_reason = controller.can_investigate_candidate(cand.candidate_id)
            ledger = controller.get_or_create_ledger(cand.candidate_id)
            for ev in evidence:
                ledger.add_fact(ev)

            audit = StructuredAuditTrail(
                candidate_id=cand.candidate_id,
                classification=cls,
                classification_evidence=evidence,
                actions=["classify_candidate"],
            )

            resolved_url: Optional[str] = None
            method = ResolutionMethod.NONE
            validation_res: Optional[ValidationResult] = None

            if can_investigate:
                # 24.5 Score strategies for candidate
                strategies = controller.score_investigation_strategies(cand, ledger)

                # Iterate through scored strategies
                for action_name, score, reason in strategies:
                    # Check loop / cycle
                    if controller.detect_cycle():
                        logger.warning(f"Cycle detected on {cand.candidate_id}, forcing strategy pivot")
                        continue

                    if on_event:
                        await on_event({
                            "type": "ai_thought",
                            "stage": "SPECULATIVE_PROBING",
                            "thought": f"Testing strategy '{action_name}' on candidate #{position} (score: {score:.2f})",
                        })

                    telemetry.browser_actions_count += 1
                    ledger.record_action(action_name)
                    audit.actions.append(f"{action_name} (score: {score:.2f})")

                    resolved_url, method, validation_res = await self.investigator.investigate_candidate(
                        candidate=cand,
                        source_url=target_url,
                        audit=audit,
                        proven_sample_urls=proven_highres_urls,
                    )

                    # 24.6 Early Success Termination
                    if validation_res and validation_res.verdict == ValidationVerdict.PASS and resolved_url:
                        controller.register_early_success(cand.candidate_id, resolved_url, method, validation_res)
                        break

            # Process final candidate result
            if validation_res and validation_res.verdict == ValidationVerdict.PASS and resolved_url:
                telemetry.originals_resolved += 1
                telemetry.resolution_methods[method.value] = (
                    telemetry.resolution_methods.get(method.value, 0) + 1
                )
                audit.result = "resolved"
                audit.resolution_method = method
                audit.validation_verdict = ValidationVerdict.PASS
                audit.resolved_url = resolved_url
                audit.dimensions = f"{validation_res.width}x{validation_res.height}"

                if (validation_res.width or 0) >= 800 and resolved_url not in proven_highres_urls:
                    proven_highres_urls.append(resolved_url)

                if on_event:
                    await on_event({
                        "type": "ai_thought",
                        "stage": "ORIGINAL_RESOLVED",
                        "thought": f"Image #{position} confirmed in high resolution: {validation_res.width}x{validation_res.height} ({validation_res.format.upper() if validation_res.format else 'JPG'}) via {method.value}",
                    })

                is_anim = (
                    validation_res.is_animated if validation_res.animation_checked
                    else cand.is_animated or validation_res.format == "gif"
                )
                current_img = AlbumImage(
                    position=position,
                    candidate_id=cand.candidate_id,
                    thumbnail_url=cand.poster_url or cand.src or "",
                    original_url=resolved_url or cand.src,
                    width=validation_res.width if validation_res else cand.width,
                    height=validation_res.height if validation_res else cand.height,
                    format=validation_res.format if validation_res else ("mp4" if cand.media_type == "video" else ("gif" if is_anim else "jpg")),
                    file_size=validation_res.file_size if validation_res else None,
                    resolution_method=method,
                    confidence=0.98,
                    validation_status="PASS",
                    source_page=target_url,
                    media_type=cand.media_type,
                    is_animated=is_anim,
                    animation_checked=validation_res.animation_checked,
                    video_stream_url=resolved_url if cand.media_type == "video" else None,
                    poster_url=cand.poster_url,
                    duration_seconds=cand.duration_seconds,
                    color_palette=validation_res.color_palette if validation_res else None,
                )
                normalize_media_item(current_img)
                if media_type_filter in ("gifs", "images") and (
                    (media_type_filter == "gifs" and media_category(current_img) != "gif")
                    or (media_type_filter == "images" and media_category(current_img) != "photo")
                ):
                    telemetry.originals_resolved -= 1
                    telemetry.resolution_methods[method.value] -= 1
                    audit.result = "rejected"
                    audit.failure_reason = "Media does not match the selected filter after binary validation"
                    audit_trails.append(audit)
                    continue
                resolved_images.append(current_img)
            else:
                telemetry.originals_unresolved += 1
                audit.result = "unresolved"
                audit.resolution_method = ResolutionMethod.NONE
                audit.validation_verdict = ValidationVerdict.UNRESOLVED
                audit.failure_reason = validation_res.reason if validation_res else (budget_reason or "No original found")

                if on_event:
                    await on_event({
                        "type": "ai_thought",
                        "stage": "NOISE_FILTER",
                        "thought": f"Candidate #{position} filtered: {audit.failure_reason}",
                    })

                current_img = AlbumImage(
                    position=position,
                    candidate_id=cand.candidate_id,
                    thumbnail_url=cand.poster_url or cand.src or "",
                    original_url=None,
                    width=cand.width,
                    height=cand.height,
                    format=None,
                    file_size=None,
                    resolution_method=ResolutionMethod.NONE,
                    confidence=0.5,
                    validation_status="UNRESOLVED",
                    source_page=target_url,
                    media_type=cand.media_type,
                    is_animated=cand.is_animated,
                    video_stream_url=None,
                    poster_url=cand.poster_url,
                    duration_seconds=cand.duration_seconds,
                )
                resolved_images.append(current_img)

            audit_trails.append(audit)

            # Live SSE candidate streaming
            if on_event:
                await on_event({
                    "type": "candidate_processed",
                    "image": current_img.model_dump(),
                    "audit": audit.model_dump(),
                    "telemetry": telemetry.model_dump(),
                })

        cover_url = _safe_cover(resolved_images)

        return Album(
            album_id=re.sub(r'[^a-zA-Z0-9_-]', '_', raw_title[:32]).lower(),
            title=raw_title,
            original_title=raw_title,
            artist=None,
            source_page=target_url,
            source_type=source_type,
            forum_thread_url=forum_thread_url,
            external_album_url=external_album_url,
            cover_image_url=cover_url,
            images=resolved_images,
            telemetry=telemetry,
            audit_trails=audit_trails,
            metadata={
                "total_candidates": len(raw_candidates),
                "investigated": len(investigation_queue),
                "resolved": len([img for img in resolved_images if img.original_url is not None]),
                "unresolved": len([img for img in resolved_images if img.original_url is None]),
                "had_learned_prior": bool(learned_prior),
            },
        )

    # -------------------------------------------------------------
    # MODE 2: LEARNING BY DEMONSTRATION
    # -------------------------------------------------------------
    async def learn_from_demonstration(
        self,
        target_url: str,
        positive_candidate_ids: List[str],
        negative_candidate_ids: List[str],
        on_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        ground_truth_urls: Optional[Dict[str, str]] = None,
    ) -> Tuple[SiteKnowledge, Album]:
        """
        Executes Mode 2 — Learning by Demonstration:
        Generalizes positive and negative items and invokes Qwen LLM pattern induction
        if ground-truth Original URLs are provided for sample thumbnails.
        """
        domain = urlparse(target_url).netloc
        await self.engine.navigate(target_url)
        await self.engine.wait_for_idle(2000)

        # Extract DOM candidates
        raw_candidates = await self.tools.get_image_candidates()
        page_info = await self.tools.inspect_page()
        raw_title = page_info.get("title", "Demonstrated Album")

        pos_cands = [c for c in raw_candidates if c.candidate_id in positive_candidate_ids]
        neg_cands = [c for c in raw_candidates if c.candidate_id in negative_candidate_ids]

        # Initial generalization
        site_knowledge = DemonstrationAnalyzer.analyze_demonstration(
            domain=domain,
            positive_candidates=pos_cands,
            negative_candidates=neg_cands,
        )

        # Qwen LLM Ground-Truth Pattern Induction
        gt_pairs = []
        if ground_truth_urls:
            for cand in pos_cands:
                if cand.candidate_id in ground_truth_urls and ground_truth_urls[cand.candidate_id]:
                    gt_pairs.append({
                        "thumbnail": cand.src or "",
                        "original": ground_truth_urls[cand.candidate_id].strip()
                    })

        ai_deduced_map: Dict[str, str] = {}
        if gt_pairs:
            remaining_thumbs = [c.src for c in pos_cands if c.src and c.candidate_id not in ground_truth_urls]
            deduction = await self.llm_adapter.query_pattern_deduction_from_examples(
                demonstrated_pairs=gt_pairs,
                target_thumbnails=remaining_thumbs,
                page_url=target_url,
            )
            ai_deduced_map = deduction.get("resolved_urls", {})
            rule_desc = deduction.get("rule_description", "")
            if rule_desc:
                site_knowledge.sample_evidence.append(f"AI Ground-Truth Induction: {rule_desc}")

        # Emit initial learning event
        if on_event:
            await on_event({
                "type": "learning_event",
                "domain": domain,
                "positive_count": len(pos_cands),
                "negative_count": len(neg_cands),
                "evidence": site_knowledge.sample_evidence,
            })

        # Autonomously investigate Original originals for all positive thumbnails
        resolved_images: List[AlbumImage] = []
        proven_methods: List[ResolutionMethod] = []
        audit_trails: List[StructuredAuditTrail] = []
        telemetry = TelemetryMetrics(
            candidates_discovered=len(raw_candidates),
            candidates_investigated=len(pos_cands),
            banners_rejected=len(neg_cands),
        )

        for idx, cand in enumerate(pos_cands):
            position = idx + 1
            audit = StructuredAuditTrail(
                candidate_id=cand.candidate_id,
                classification=CandidateClassification.THUMBNAIL_CANDIDATE,
                classification_evidence=["User-demonstrated positive album item"],
            )

            resolved_url: Optional[str] = None
            method: ResolutionMethod = ResolutionMethod.NONE
            val_res: Optional[ValidationResult] = None

            # 1. Check user-supplied ground truth URL
            if ground_truth_urls and cand.candidate_id in ground_truth_urls and ground_truth_urls[cand.candidate_id]:
                gt_url = ground_truth_urls[cand.candidate_id].strip()
                val_res = await self.validator.validate_candidate_url(
                    candidate_url=gt_url,
                    referer=target_url,
                    thumb_width=cand.width,
                    thumb_height=cand.height,
                )
                if val_res.verdict == ValidationVerdict.PASS:
                    resolved_url = gt_url
                    method = ResolutionMethod.VERIFIED_CDN_CANDIDATE
                    audit.actions.append("accept_ground_truth_user_demonstration")

            # 2. Check Qwen AI Deduced URL
            if not resolved_url and cand.src and cand.src in ai_deduced_map:
                ai_url = ai_deduced_map[cand.src]
                val_res = await self.validator.validate_candidate_url(
                    candidate_url=ai_url,
                    referer=target_url,
                    thumb_width=cand.width,
                    thumb_height=cand.height,
                )
                if val_res.verdict == ValidationVerdict.PASS:
                    resolved_url = ai_url
                    method = ResolutionMethod.VERIFIED_CDN_CANDIDATE
                    audit.actions.append("accept_qwen_deduced_original")

            # 3. Otherwise, run multi-vector investigation
            if not resolved_url:
                resolved_url, method, val_res = await self.investigator.investigate_candidate(
                    candidate=cand,
                    source_url=target_url,
                    audit=audit,
                    proven_sample_urls=[img.original_url for img in resolved_images if img.original_url],
                )

            if val_res and val_res.verdict == ValidationVerdict.PASS and resolved_url:
                telemetry.originals_resolved += 1
                telemetry.resolution_methods[method.value] = (
                    telemetry.resolution_methods.get(method.value, 0) + 1
                )
                proven_methods.append(method)
                audit.result = "resolved"
                audit.resolution_method = method
                audit.validation_verdict = ValidationVerdict.PASS
                audit.resolved_url = resolved_url
                audit.dimensions = f"{val_res.width}x{val_res.height}"

                img_obj = AlbumImage(
                    position=position,
                    candidate_id=cand.candidate_id,
                    thumbnail_url=cand.src or "",
                    original_url=resolved_url,
                    width=val_res.width,
                    height=val_res.height,
                    format=val_res.format,
                    is_animated=val_res.is_animated,
                    animation_checked=val_res.animation_checked,
                    file_size=val_res.file_size,
                    resolution_method=method,
                    confidence=1.0,
                    validation_status="PASS",
                    source_page=target_url,
                    color_palette=val_res.color_palette if val_res else None,
                )
            else:
                telemetry.originals_unresolved += 1
                audit.result = "unresolved"
                audit.validation_verdict = ValidationVerdict.UNRESOLVED
                img_obj = AlbumImage(
                    position=position,
                    candidate_id=cand.candidate_id,
                    thumbnail_url=cand.src or "",
                    original_url=None,
                    width=cand.width,
                    height=cand.height,
                    format=None,
                    file_size=None,
                    resolution_method=ResolutionMethod.NONE,
                    confidence=0.5,
                    validation_status="UNRESOLVED",
                    source_page=target_url,
                )

            resolved_images.append(img_obj)
            audit_trails.append(audit)

            if on_event:
                await on_event({
                    "type": "candidate_processed",
                    "image": img_obj.model_dump(),
                    "audit": audit.model_dump(),
                    "telemetry": telemetry.model_dump(),
                })

        # Update and persist generalized knowledge with proven methods
        existing_k = self.knowledge_store.get_knowledge(domain)
        site_knowledge = DemonstrationAnalyzer.analyze_demonstration(
            domain=domain,
            positive_candidates=pos_cands,
            negative_candidates=neg_cands,
            proven_methods=proven_methods,
        )
        if existing_k:
            site_knowledge.demonstration_count = existing_k.demonstration_count + 1
            for c in existing_k.primary_containers:
                if c not in site_knowledge.primary_containers:
                    site_knowledge.primary_containers.append(c)
            for s in existing_k.positive_signatures:
                if s not in site_knowledge.positive_signatures:
                    site_knowledge.positive_signatures.append(s)
            for f in existing_k.negative_filters:
                if f not in site_knowledge.negative_filters:
                    site_knowledge.negative_filters.append(f)
            for m in existing_k.preferred_resolution_methods:
                if m not in site_knowledge.preferred_resolution_methods:
                    site_knowledge.preferred_resolution_methods.append(m)
        if gt_pairs and rule_desc:
            ev = f"AI Ground-Truth Induction: {rule_desc}"
            if ev not in site_knowledge.sample_evidence:
                site_knowledge.sample_evidence.append(ev)
        self.knowledge_store.save_knowledge(site_knowledge)

        cover_url = _safe_cover(resolved_images)
        album = Album(
            album_id=re.sub(r'[^a-zA-Z0-9_-]', '_', raw_title[:32]).lower(),
            title=raw_title,
            original_title=raw_title,
            source_page=target_url,
            source_type="gallery",
            cover_image_url=cover_url,
            images=resolved_images,
            telemetry=telemetry,
            audit_trails=audit_trails,
            metadata={"mode": "demonstration", "domain": domain},
        )

        return site_knowledge, album

    # -------------------------------------------------------------
    # MULTI-ALBUM EXTRACTION (SECTION 19)
    # -------------------------------------------------------------
    async def extract_multiple_albums(
        self,
        index_url: str,
        max_albums: int = 5,
        max_images_per_album: int = 15,
        on_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    ) -> List[Album]:
        """
        Discovers multiple album links on an index page and extracts each album independently
        with strict count limits.
        """
        await self.engine.navigate(index_url)
        await self.engine.wait_for_idle(2000)

        links = await self.tools.get_links()
        album_links = [lk for lk in links if lk.is_album_candidate]
        if not album_links:
            # Check internal links with album keywords
            album_links = [lk for lk in links if any(k in lk.url.lower() for k in ["/album/", "/gallery/", "/set/", "/view/"])]

        # Enforce strict maximum limit
        selected_links = album_links[:max_albums]
        extracted_albums: List[Album] = []

        for lk in selected_links:
            album = await self.run(lk.url, on_event=on_event)
            # Enforce max images limit if needed
            if len(album.images) > max_images_per_album:
                album.images = album.images[:max_images_per_album]
            extracted_albums.append(album)

        return extracted_albums

    def _select_containers(
        self,
        candidate_groups: List[CandidateGroup],
        learned_prior: Optional[SiteKnowledge],
    ) -> Tuple[Optional[str], Optional[str]]:
        """Selects primary album container using groups and soft priors."""
        primary = None
        related = None

        if learned_prior and learned_prior.primary_containers:
            # Check if any group matches learned prior container
            for g in candidate_groups:
                if g.container_selector in learned_prior.primary_containers:
                    primary = g.container_selector
                    break

        if not primary:
            # Select largest album candidate group
            album_groups = [g for g in candidate_groups if g.is_album_group]
            if album_groups:
                largest = max(album_groups, key=lambda g: len(g.candidates))
                primary = largest.container_selector

        for g in candidate_groups:
            sel_lower = g.container_selector.lower()
            if any(r in sel_lower for r in ["related", "recommend", "similar"]):
                related = g.container_selector

        return primary or "#tiles", related

    def _classify_candidate(
        self,
        cand: DOMCandidateInfo,
        primary_container: Optional[str],
        related_container: Optional[str],
        learned_prior: Optional[SiteKnowledge] = None,
    ) -> Tuple[CandidateClassification, List[str]]:
        """Classifies image candidates contextually with prior and negative filter evaluation."""
        evidence: List[str] = []
        alt = (cand.alt or "").lower()
        src = (cand.src or "").lower()
        parent_href = (cand.parent_href or "").lower()
        classes = " ".join(cand.classes).lower()
        container = (cand.container_selector or "").lower()

        # Direct Video or Animated GIF Candidate classification
        if cand.media_type in ("video", "gif") or cand.is_animated:
            evidence.append(f"Valid {cand.media_type.upper()} or animated candidate")
            return CandidateClassification.THUMBNAIL_CANDIDATE, evidence

        # Check negative filters from learned prior
        if learned_prior and learned_prior.negative_filters:
            for nf in learned_prior.negative_filters:
                if nf.startswith("exclude_class:") and nf.split(":", 1)[1].lower() in classes:
                    evidence.append(f"Excluded by learned prior filter '{nf}'")
                    return CandidateClassification.BANNER, evidence
                if nf.startswith("exclude_container:") and nf.split(":", 1)[1].lower() in container:
                    evidence.append(f"Excluded by learned prior container '{nf}'")
                    return CandidateClassification.RELATED_IMAGE, evidence

        # 1. Logo
        if "logo" in alt or "logo" in src or "logo" in classes:
            evidence.append("Contains 'logo' keyword in attributes/src")
            return CandidateClassification.LOGO, evidence

        # 2. Avatar
        if "avatar" in alt or "avatar" in src or "avatar" in classes:
            evidence.append("Contains 'avatar' keyword in classes or path")
            return CandidateClassification.AVATAR, evidence

        # 3. Decorative / Tracking Pixel
        if (cand.width and cand.width <= 10) or (cand.height and cand.height <= 10) or "spacer" in src or "pixel" in src:
            evidence.append(f"Small dimensions ({cand.width}x{cand.height}) or tracking pixel")
            return CandidateClassification.DECORATIVE_IMAGE, evidence

        # 4. Hard Negative: Banner / Advertisement (Even if 300x450!)
        ad_keywords = ["banner", "promo", "sponsor", "affiliate", "ad-", "ads-", "advert", "popunder", "sale"]
        if (
            any(k in alt for k in ad_keywords)
            or any(k in classes for k in ad_keywords)
            or any(k in src for k in ad_keywords)
            or any(k in parent_href for k in ["adserver", "affiliate", "tracking", "promo", "partner"])
            or "banner" in container
            or "sidebar" in container
        ):
            evidence.append(f"Identified as promotional banner via keywords in attributes/URL/container ({container})")
            return CandidateClassification.BANNER, evidence

        # 5. Related Content
        if related_container and (related_container.lower() in container or "related" in container):
            evidence.append(f"Located inside related container {container}")
            return CandidateClassification.RELATED_IMAGE, evidence

        if any(r in container for r in ["related", "recommend", "similar", "sidebar", "footer"]):
            evidence.append(f"Located inside non-main section {container}")
            return CandidateClassification.RELATED_IMAGE, evidence

        # 6. Primary Album Container & Sibling Repetition
        if primary_container and (primary_container.lower() in container or container in primary_container.lower()):
            evidence.append(f"Located inside primary album container {primary_container}")
            if cand.total_siblings > 1:
                evidence.append(f"Shares DOM container with {cand.total_siblings} siblings")
            if cand.parent_href:
                evidence.append(f"Parent anchor links to {cand.parent_href[:40]}")
            return CandidateClassification.THUMBNAIL_CANDIDATE, evidence

        # 7. Generic Thumbnail vs Site-Wide
        if cand.parent_href and any(ext in cand.parent_href for ext in [".html", ".php", "/photo/", "/view/", "/item/"]):
            evidence.append(f"Parent anchor links to detail page {cand.parent_href[:40]}")
            return CandidateClassification.THUMBNAIL_CANDIDATE, evidence

        if cand.width and cand.width > 200 and cand.height and cand.height > 200:
            evidence.append(f"Standalone content image ({cand.width}x{cand.height})")
            return CandidateClassification.ALBUM_IMAGE_CANDIDATE, evidence

        evidence.append("Uncorrelated site-wide visual element")
        return CandidateClassification.SITE_WIDE_IMAGE, evidence
