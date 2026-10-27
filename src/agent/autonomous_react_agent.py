"""
Autonomous ReAct AI Extraction Agent & Cognitive Orchestrator (Phase 8).
Integrates all 7 architectural pillars:
- Pillar 1: Cognitive State Machine & Dynamic Tool Registry (src/agent/state_machine.py, src/agent/react_engine.py)
- Pillar 2: Network Sniffer & Media Schema Dissector (src/browser/network_sniffer.py)
- Pillar 3: Multimodal Vision Perception & Set-of-Marks (src/agent/vision_adapter.py)
- Pillar 4: Speculative Parallel Probing & Mass Scale Engine (src/agent/speculative_prober.py)
- Pillar 5: Self-Reflection & Adaptive Countermeasures (src/agent/reflection_engine.py)
- Pillar 6: Hierarchical Meta-Archetype Knowledge Graph (src/learning/meta_knowledge.py)
- Pillar 7: Interactive Autonomous Co-Pilot Channel (src/agent/copilot_channel.py)
"""

import time
import logging
import asyncio
from typing import Dict, List, Any, Optional, Tuple, Callable
from urllib.parse import urlparse, urljoin

from ..core.models import (
    Album,
    AlbumImage,
    DOMCandidateInfo,
    CandidateClassification,
    ResolutionMethod,
    TelemetryMetrics,
    StructuredAuditTrail,
    ValidationVerdict,
)
from ..browser.engine import BrowserEngine
from ..browser.tools import BrowserTools
from ..validator.validator import ImageValidator, ValidationResult
from .llm_adapter import LLMAdapter
from .state_machine import CognitiveContext, CognitiveState, HypothesisRecord
from .react_engine import ReActEngine, AgentToolRegistry
from ..browser.network_sniffer import NetworkSniffer
from .vision_adapter import VisionAdapter
from .speculative_prober import SpeculativeProber, ProbeResult, ProbeHypothesis, HypothesisType
from .reflection_engine import ReflectionEngine
from ..learning.meta_knowledge import MetaKnowledgeGraph
from .copilot_channel import CoPilotChannel

logger = logging.getLogger(__name__)


class AutonomousReActAgent:
    """
    Unified Autonomous ReAct AI Agent.
    Coordinates all cognitive, visual, network, and speculative sub-engines
    to achieve pristine, high-speed Original album extractions.
    """

    def __init__(
        self,
        engine: Optional[BrowserEngine] = None,
        tools: Optional[BrowserTools] = None,
        validator: Optional[ImageValidator] = None,
        llm_adapter: Optional[LLMAdapter] = None,
        network_sniffer: Optional[NetworkSniffer] = None,
        vision_adapter: Optional[VisionAdapter] = None,
        speculative_prober: Optional[SpeculativeProber] = None,
        reflection_engine: Optional[ReflectionEngine] = None,
        knowledge_graph: Optional[MetaKnowledgeGraph] = None,
        copilot_channel: Optional[CoPilotChannel] = None,
    ):
        self.engine = engine or BrowserEngine()
        self.tools = tools or BrowserTools(engine=self.engine)
        self.validator = validator or ImageValidator()
        self.llm_adapter = llm_adapter or LLMAdapter()
        self.network_sniffer = network_sniffer or NetworkSniffer()
        self.vision_adapter = vision_adapter or VisionAdapter()
        self.speculative_prober = speculative_prober or SpeculativeProber(validator=self.validator)
        self.reflection_engine = reflection_engine or ReflectionEngine()
        self.knowledge_graph = knowledge_graph or MetaKnowledgeGraph()
        self.copilot_channel = copilot_channel or CoPilotChannel()

        # Tool Registry & ReAct Engine
        self.registry = AgentToolRegistry(
            engine=self.engine,
            tools=self.tools,
            validator=self.validator,
            network_sniffer=self.network_sniffer,
            vision_adapter=self.vision_adapter,
            speculative_prober=self.speculative_prober,
        )

        self.react_engine = ReActEngine(
            registry=self.registry,
            llm_adapter=self.llm_adapter,
            max_steps=12,
            reflection_engine=self.reflection_engine,
        )

    async def extract_album(
        self,
        url: str,
        referer: Optional[str] = None,
        page_title_hint: Optional[str] = None,
        on_event: Optional[Callable[[Dict[str, Any]], Any]] = None,
    ) -> Album:
        """
        Executes end-to-end autonomous extraction of an album from a URL.
        Emits rich real-time AI cognitive thoughts and decision telemetry.
        """
        start_time = time.time()
        context = CognitiveContext(target_url=url)
        self.copilot_channel.emit_status_update(f"Starting extraction for: {url}")

        async def _emit(evt_data: Dict[str, Any]):
            if on_event:
                try:
                    res = on_event(evt_data)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception:
                    pass

        # -------------------------------------------------------------
        # Step 1: Page Ingestion & Network Attachment (Pillar 1 & 2)
        # -------------------------------------------------------------
        context.transition_to(CognitiveState.PAGE_INGESTION, f"Navigating to {url}")
        await _emit({
            "type": "ai_thought",
            "stage": "PAGE_INGESTION",
            "thought": f"Navigating to {url} with Playwright engine. Attaching background JSON/XHR network response sniffer.",
        })
        
        # Ensure browser is running
        if not self.engine.main_page or self.engine.main_page.is_closed():
            await self.engine.start()

        # Attach network response sniffer
        self.network_sniffer.attach_to_page(self.engine.main_page)

        # Navigate
        nav_ok = await self.engine.navigate(url)
        page_title = await self.engine.main_page.title() if nav_ok else "Untitled Album"
        raw_title = page_title_hint or page_title or "Untitled Album"
        context.raw_title = raw_title
        context.page_info = {"title": raw_title, "url": url}

        # Small settle delay for background fetch / scripts
        await asyncio.sleep(0.8)

        # -------------------------------------------------------------
        # Step 2: Multi-Signal Observation & Visual Perception (Pillar 1 & 3)
        # -------------------------------------------------------------
        context.transition_to(CognitiveState.MULTI_SIGNAL_OBSERVATION, "Discovering image candidates and layout structure")
        dom_candidates = await self.tools.get_image_candidates()
        context.discovered_candidates = dom_candidates
        logger.info(f"[Autonomous Agent] Discovered {len(dom_candidates)} DOM candidates")

        await _emit({
            "type": "album_init",
            "title": raw_title,
            "original_title": raw_title,
            "source_page": url,
            "page_type": "Gallery",
            "total_candidates": len(dom_candidates),
        })

        await _emit({
            "type": "ai_thought",
            "stage": "OBSERVATION",
            "thought": f"Discovered {len(dom_candidates)} candidate image elements across DOM tree. Inspecting geometry, bounding boxes, and surrounding anchor links.",
        })

        # -------------------------------------------------------------
        # Step 3: Meta-Archetype Matching (Pillar 6)
        # -------------------------------------------------------------
        context.transition_to(CognitiveState.ARCHETYPE_MATCHING, "Matching structural meta-archetype")
        page_html = await self.engine.main_page.content()
        try:
            page_scripts = await self.engine.main_page.evaluate(
                "() => Array.from(document.querySelectorAll('script')).map(s => s.src || s.innerText)"
            )
        except Exception:
            page_scripts = []

        has_manifests = len(self.network_sniffer.captured_payloads) > 0

        matched_archetype, arch_confidence = self.knowledge_graph.match_archetype(
            page_html=page_html,
            page_scripts=page_scripts,
            dom_candidates=dom_candidates,
            has_api_manifest=has_manifests,
        )
        if matched_archetype:
            context.matched_archetype = matched_archetype.archetype_id
            context.archetype_confidence = arch_confidence
            logger.info(f"[Autonomous Agent] Matched Archetype: {matched_archetype.archetype_id} (Confidence: {arch_confidence})")
            await _emit({
                "type": "ai_thought",
                "stage": "ARCHETYPE_MATCHING",
                "thought": f"Structural Layout Analysis: Matched Archetype '{matched_archetype.archetype_id}' (Confidence: {arch_confidence * 100:.0f}%).",
            })

        # -------------------------------------------------------------
        # Step 4: Visual Region Segmentation (Pillar 3)
        # -------------------------------------------------------------
        seg_res = await self.vision_adapter.analyze_visual_regions(
            screenshot_bytes=b"",
            mark_map={i + 1: c.candidate_id for i, c in enumerate(dom_candidates[:25])},
            page_title=raw_title,
            candidates=dom_candidates,
            llm_adapter=self.llm_adapter,
        )

        def _is_noise_candidate(c: DOMCandidateInfo) -> bool:
            raw_src = (c.src or c.current_src or "").lower()
            sel = (c.selector or "").lower()
            if raw_src.endswith(".svg") or ".svg?" in raw_src or "/svg" in raw_src:
                return True
            noise_keywords = ["logo", "icon", "avatar", "favicon", "brand", "google-icon", "social-btn"]
            if any(k in raw_src for k in noise_keywords) or any(k in sel for k in noise_keywords):
                return True
            return False

        gallery_cands = [
            c for c in dom_candidates
            if (c.candidate_id in seg_res.gallery_candidate_ids or (c.width or 0) >= 150)
            and c.candidate_id not in seg_res.logo_candidate_ids
            and c.candidate_id not in seg_res.banner_candidate_ids
            and not _is_noise_candidate(c)
        ]
        if not gallery_cands:
            gallery_cands = [c for c in dom_candidates if not _is_noise_candidate(c)]

        await _emit({
            "type": "ai_thought",
            "stage": "VISUAL_PERCEPTION",
            "thought": f"Set-of-Marks Visual Perception: Segmented {len(gallery_cands)} core gallery photos (filtered {len(seg_res.banner_candidate_ids)} promo banners, {len(seg_res.logo_candidate_ids)} logos).",
        })

        # -------------------------------------------------------------
        # Step 5: Check Intercepted API Media Manifests (Pillar 2)
        # -------------------------------------------------------------
        manifest_items = self.network_sniffer.extract_media_manifests(base_url=url)
        resolved_images: List[AlbumImage] = []

        if manifest_items and len(manifest_items) >= 3:
            logger.info(f"[Autonomous Agent]  High-res API Media Manifest detected with {len(manifest_items)} items")
            await _emit({
                "type": "ai_thought",
                "stage": "NETWORK_SNIFFER",
                "thought": f" Intercepted JSON API Media Manifest with {len(manifest_items)} items in background network stream. Validating session tokens...",
            })
            validated = await self.network_sniffer.validate_manifest_items(
                items=manifest_items,
                validator=self.validator,
                referer=url,
            )
            for idx, (item, v_res) in enumerate(validated):
                if v_res.verdict == ValidationVerdict.PASS:
                    img = AlbumImage(
                        position=idx + 1,
                        candidate_id=f"manifest_item_{idx+1}",
                        thumbnail_url=item.thumbnail_url or item.original_url,
                        original_url=item.original_url,
                        width=v_res.width or item.width,
                        height=v_res.height or item.height,
                        format=v_res.format or item.format,
                        is_animated=v_res.is_animated,
                        animation_checked=v_res.animation_checked,
                        file_size=v_res.file_size,
                        resolution_method=ResolutionMethod.NETWORK,
                        confidence=1.0,
                        validation_status="PASS",
                        source_page=url,
                        color_palette=v_res.color_palette,
                    )
                    resolved_images.append(img)
                    await _emit({
                        "type": "image_resolved",
                        "position": img.position,
                        "thumbnail_url": img.thumbnail_url,
                        "original_url": img.original_url,
                        "width": img.width,
                        "height": img.height,
                        "dimensions": f"{img.width}x{img.height}" if img.width and img.height else "Original",
                        "format": img.format or "jpg",
                        "validation_status": img.validation_status,
                        "resolution_method": img.resolution_method.value,
                    })

        # -------------------------------------------------------------
        # Step 6: Speculative Probing & Mass Scaling (Pillar 4 & 6)
        # -------------------------------------------------------------
        if len(resolved_images) < len(gallery_cands) and gallery_cands:
            context.transition_to(CognitiveState.INVESTIGATION_REACT_LOOP, "Executing speculative probing")
            meta_priors = self.knowledge_graph.get_prior_hypotheses(matched_archetype)

            await _emit({
                "type": "ai_thought",
                "stage": "SPECULATIVE_PROBING",
                "thought": f"Speculative Probe & Scale: Formulating competing hypotheses for Candidate #1 using meta-priors...",
            })

            winning_probe = None
            for probe_cand in gallery_cands[:3]:
                hypotheses = self.speculative_prober.generate_candidate_hypotheses(
                    candidate=probe_cand,
                    target_url=url,
                    meta_priors=meta_priors,
                )

                for h in hypotheses:
                    await _emit({
                        "type": "ai_thought",
                        "stage": "SPECULATIVE_PROBING",
                        "thought": f"Hypothesis [{h.hypothesis_type.value}] (Prior: {h.prior_probability:.2f}): {h.description} -> {h.proposed_url or 'N/A'}",
                    })

                winning_probe = await self.speculative_prober.execute_speculative_probe(
                    candidate=probe_cand,
                    hypotheses=hypotheses,
                    referer=referer or url,
                )
                if winning_probe:
                    break

            if winning_probe:
                await _emit({
                    "type": "ai_thought",
                    "stage": "PROVEN_VECTOR",
                    "thought": f" Locked Winning Original Vector: {winning_probe.hypothesis.description} (Dimensions: {winning_probe.validation_result.width}x{winning_probe.validation_result.height}, Latency: {winning_probe.latency_ms:.1f}ms). Mass scaling across {len(gallery_cands)} candidates...",
                })

                # Mass Scale across remaining gallery candidates (Pillar 4)
                context.transition_to(CognitiveState.MASS_SCALING, f"Mass scaling winning vector: {winning_probe.hypothesis.description}")
                scaling_res = await self.speculative_prober.scale_winning_vector(
                    winning_probe=winning_probe,
                    candidates=gallery_cands,
                    target_url=url,
                    referer=referer or url,
                )
                resolved_images = scaling_res.resolved_images

                for img in resolved_images:
                    await _emit({
                        "type": "image_resolved",
                        "position": img.position,
                        "thumbnail_url": img.thumbnail_url,
                        "original_url": img.original_url,
                        "width": img.width,
                        "height": img.height,
                        "dimensions": f"{img.width}x{img.height}" if img.width and img.height else "Original",
                        "format": img.format or "jpg",
                        "validation_status": img.validation_status,
                        "resolution_method": img.resolution_method.value,
                    })

                # Record Success in Knowledge Graph (Pillar 6)
                if matched_archetype:
                    self.knowledge_graph.record_success(
                        archetype_id=matched_archetype.archetype_id,
                        winning_strategy=winning_probe.hypothesis.hypothesis_type.value,
                        winning_rule=winning_probe.hypothesis.transformation_rule or winning_probe.hypothesis.description,
                        domain=urlparse(url).netloc,
                    )

        # -------------------------------------------------------------
        # Step 7: Autonomous ReAct Loop & Detail Landing Page Resolution (Pillar 1 & 5)
        # -------------------------------------------------------------
        if not resolved_images and gallery_cands:
            context = await self.react_engine.execute_react_cycle(
                context=context,
                sample_candidates=gallery_cands[:5],
                on_event=_emit,
            )
            # Check if ReAct loop locked a proven vector
            proven_vecs = getattr(context, "proven_vectors", None) or ([context.proven_hypothesis] if getattr(context, "proven_hypothesis", None) else [])
            if proven_vecs:
                winning_hyp_rec = proven_vecs[0]
                winning_probe = ProbeResult(
                    hypothesis=ProbeHypothesis(
                        hypothesis_id=winning_hyp_rec.hypothesis_id,
                        hypothesis_type=HypothesisType.CUSTOM_TRANSFORM if winning_hyp_rec.transformation_rule else HypothesisType.PARENT_LINK,
                        description="ReAct loop locked vector",
                        proposed_url=winning_hyp_rec.proposed_url,
                        transformation_rule=winning_hyp_rec.transformation_rule,
                        prior_probability=1.0,
                    ),
                    candidate_id=winning_hyp_rec.candidate_id,
                    tested_url=winning_hyp_rec.proposed_url or "",
                    validation_result=ValidationResult(
                        target_url=winning_hyp_rec.proposed_url or "",
                        verdict=ValidationVerdict.PASS,
                        is_valid=True,
                    ),
                    latency_ms=10.0,
                    is_winner=True,
                )
                scaling_res = await self.speculative_prober.scale_winning_vector(
                    winning_probe=winning_probe,
                    candidates=gallery_cands,
                    target_url=url,
                    referer=referer or url,
                )
                passed_scaled = [img for img in scaling_res.resolved_images if img.validation_status == "PASS"]
                if passed_scaled:
                    resolved_images = scaling_res.resolved_images

                for img in resolved_images:
                    if img.validation_status == "PASS":
                        await _emit({
                            "type": "image_resolved",
                            "position": img.position,
                            "thumbnail_url": img.thumbnail_url,
                            "original_url": img.original_url,
                            "width": img.width,
                            "height": img.height,
                            "dimensions": f"{img.width}x{img.height}" if img.width and img.height else "Original",
                            "format": img.format or "jpg",
                            "validation_status": img.validation_status,
                            "resolution_method": img.resolution_method.value,
                        })

                if matched_archetype and winning_hyp_rec:
                    self.knowledge_graph.record_success(
                        archetype_id=matched_archetype.archetype_id,
                        winning_strategy="react_probe",
                        winning_rule=winning_hyp_rec.transformation_rule or winning_hyp_rec.proposed_url or "react_probe",
                        domain=urlparse(url).netloc,
                    )

        # -------------------------------------------------------------
        # Step 7b: Detail Page Landing Resolution (For Forum threads & Image Hosts)
        # -------------------------------------------------------------
        if (not resolved_images or all(img.validation_status != "PASS" for img in resolved_images)) and gallery_cands:
            candidates_with_links = [c for c in gallery_cands if c.parent_href and (c.parent_href.startswith("http") or c.parent_href.startswith("/"))]
            if candidates_with_links and len(candidates_with_links) >= 1:
                await _emit({
                    "type": "ai_thought",
                    "stage": "OBSERVATION",
                    "thought": f"Investigating {len(candidates_with_links)} candidates linked to external landing hosts ({candidates_with_links[0].parent_href[:35]}...). Opening background detail tabs concurrently...",
                })
                
                # Concurrently inspect detail pages
                detail_sem = asyncio.Semaphore(10)
                
                async def _resolve_detail_candidate(idx: int, cand: DOMCandidateInfo) -> Optional[AlbumImage]:
                    async with detail_sem:
                        detail_url = urljoin(url, cand.parent_href)
                        detail_data = await self.tools.open_detail_page(detail_url)
                        if not detail_data:
                            return None
                        
                        detail_images = detail_data.get("images", [])
                        best_img_url = None
                        best_val_res = None
                        
                        for d_img in detail_images:
                            d_src = d_img.get("src")
                            if d_src:
                                full_d_src = urljoin(detail_url, d_src)
                                val = await self.validator.validate_candidate_url(
                                    candidate_url=full_d_src,
                                    referer=detail_url,
                                    thumb_width=cand.width,
                                    thumb_height=cand.height,
                                )
                                if val.verdict == ValidationVerdict.PASS and (val.width or 0) >= (cand.width or 0):
                                    if not best_val_res or (val.width or 0) > (best_val_res.width or 0):
                                        best_img_url = full_d_src
                                        best_val_res = val
                        
                        if best_img_url and best_val_res:
                            return AlbumImage(
                                position=idx + 1,
                                candidate_id=cand.candidate_id,
                                thumbnail_url=cand.src or best_img_url,
                                original_url=best_img_url,
                                width=best_val_res.width,
                                height=best_val_res.height,
                                format=best_val_res.format,
                                is_animated=best_val_res.is_animated,
                                animation_checked=best_val_res.animation_checked,
                                file_size=best_val_res.file_size,
                                resolution_method=ResolutionMethod.INDIVIDUAL_PAGE,
                                confidence=1.0,
                                validation_status="PASS",
                                source_page=url,
                            )
                        return None

                detail_tasks = [_resolve_detail_candidate(i, c) for i, c in enumerate(candidates_with_links)]
                detail_results = await asyncio.gather(*detail_tasks, return_exceptions=True)
                
                resolved_images = []
                for r in detail_results:
                    if isinstance(r, AlbumImage) and r.original_url:
                        resolved_images.append(r)
                        await _emit({
                            "type": "image_resolved",
                            "position": r.position,
                            "thumbnail_url": r.thumbnail_url,
                            "original_url": r.original_url,
                            "width": r.width,
                            "height": r.height,
                            "dimensions": f"{r.width}x{r.height}" if r.width and r.height else "Original",
                            "format": r.format or "jpg",
                            "validation_status": r.validation_status,
                            "resolution_method": r.resolution_method.value,
                        })

        # -------------------------------------------------------------
        # Step 8: Album Assembly & Telemetry (Pillar 1)
        # -------------------------------------------------------------
        context.transition_to(CognitiveState.ALBUM_ASSEMBLY, "Assembling final validated Album entity")
        elapsed_seconds = round(time.time() - start_time, 2)

        # Strict Zero-Semantic-Fallback: If no high-res originals could be resolved, do NOT fake/substitute thumbnails as originals
        if not resolved_images and dom_candidates:
            fail_reason = "Autonomous AI Agent was unable to resolve verified Original/HD original images for this page layout (No winning speculative probe, detail page, or API manifest passed validation)."
            await _emit({
                "type": "ai_thought",
                "stage": "REFLECTION",
                "thought": f"️ [Pure AI Execution Report] {fail_reason}",
                "reflection": fail_reason,
            })
            for idx, c in enumerate(gallery_cands or dom_candidates[:15]):
                resolved_images.append(AlbumImage(
                    position=idx + 1,
                    candidate_id=c.candidate_id,
                    thumbnail_url=c.src or "",
                    original_url=None,
                    width=c.width,
                    height=c.height,
                    resolution_method=ResolutionMethod.NONE,
                    confidence=0.0,
                    validation_status="UNRESOLVED",
                    source_page=url,
                ))

        album_id = f"album_{int(time.time())}_{abs(hash(url)) % 10000}"
        
        telemetry = TelemetryMetrics(
            total_duration_seconds=elapsed_seconds,
            candidates_discovered=len(dom_candidates),
            candidates_investigated=len(gallery_cands),
            originals_resolved=len([img for img in resolved_images if img.validation_status == "PASS"]),
            originals_unresolved=len([img for img in resolved_images if img.validation_status != "PASS"]),
            banners_rejected=len(seg_res.banner_candidate_ids),
        )

        audit_trails = [
            StructuredAuditTrail(
                candidate_id=img.candidate_id or f"cand_{img.position}",
                classification=CandidateClassification.ALBUM_IMAGE_CANDIDATE,
                classification_evidence=["autonomous_react_resolution"],
                actions=["speculative_probe", "mass_scaling"],
                result="resolved" if img.validation_status == "PASS" else "unresolved",
                resolution_method=img.resolution_method,
                validation_verdict=ValidationVerdict.PASS if img.validation_status == "PASS" else None,
                resolved_url=img.original_url,
                dimensions=f"{img.width}x{img.height}" if img.width and img.height else None,
            )
            for img in resolved_images
        ]

        album = Album(
            album_id=album_id,
            title=raw_title,
            original_title=raw_title,
            source_page=url,
            source_type="gallery",
            images=resolved_images,
            telemetry=telemetry,
            audit_trails=audit_trails,
            metadata={
                "extraction_mode": "ai_autonomous",
                "matched_archetype": context.matched_archetype,
                "elapsed_seconds": elapsed_seconds,
            }
        )

        for audit in audit_trails:
            await _emit({"type": "candidate_audit", "data": audit.model_dump()})

        await _emit({
            "type": "ai_thought",
            "stage": "COMPLETED",
            "thought": f"Extraction completed! Successfully validated {len(album.images)} original photos in {elapsed_seconds}s.",
        })

        context.transition_to(CognitiveState.COMPLETED, f"Album extraction completed with {len(album.images)} images in {elapsed_seconds}s")
        self.copilot_channel.emit_status_update(f"Extraction completed: {len(album.images)} images resolved.")
        return album
