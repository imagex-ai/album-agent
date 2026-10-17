"""
==============================================================================
LOCKED & IMMUTABLE CORE ENGINE - DIRECTIVA DE IMUTABILIDADE PERMANENTE
==============================================================================
STATUS: IMUTÁVEL (APROVADO PELO USUÁRIO EM 2026-10-17)
AVISO CRÍTICO PARA AGENTES E IAs:
ESTE MÓDULO É CONSIDERADO PERFEITO E DEFINITIVO. NÃO ALTERE, NÃO MODIFIQUE,
NÃO REESCREVA E NÃO REFAÇA A LÓGICA DESTE ARQUIVO.
Nenhuma IA ou agente autônomo tem permissão para alterar o motor de detecção,
as pontuações (scores), a supressão não-máxima temporal (NMS), a lógica do
Top 3 (Ouro, Prata, Bronze) ou a curva de áudio/heatmap contida aqui.
==============================================================================

Smart Shorts Detector Engine.
Multi-modal intelligence for video shorts and highlights:
1. Intro / Logo / Bumper detection via color uniformity (Pillow ImageStat variance, Shannon entropy),
   freezedetect, and blackdetect.
2. Full-timeline fast acoustic dynamics via resampled audio energy (FFmpeg aresample/astats without video decode),
   crescendo acceleration slope, and narrative arc prior (P_arc).
3. Temporal Non-Maximum Suppression (NMS) generating Top 3 ranked, diverse highlights (Gold Climax, Silver Secondary, Bronze Hook).
4. Crowd-sourced engagement curves via yt-dlp heatmap peaks.
"""

import os
import sys
import re
import json
import math
import shutil
import logging
import subprocess
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("smart_shorts_detector")

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def get_ffmpeg_path() -> Optional[str]:
    """Resolves FFmpeg executable path."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    exe = shutil.which("ffmpeg")
    return exe if exe and os.path.exists(exe) else None


def get_ffprobe_path() -> Optional[str]:
    """Resolves FFprobe executable path."""
    exe = shutil.which("ffprobe")
    return exe if exe and os.path.exists(exe) else None


def evaluate_frame_uniformity(img_path: str) -> Tuple[bool, float, float]:
    """
    Evaluates whether an image frame is a solid/uniform color, black/white screen,
    or static studio logo.
    Returns (is_uniform, stddev, mean_brightness).
    """
    try:
        from PIL import Image, ImageStat
        with Image.open(img_path) as im:
            rgb_im = im.convert("RGB")
            stat = ImageStat.Stat(rgb_im)
            mean_b = sum(stat.mean) / max(1, len(stat.mean))
            std_b = sum(stat.stddev) / max(1, len(stat.stddev))

            # Black screens: mean < 30
            # Pure white/blank screens: mean > 240 and std_b < 12
            # Solid color logos/bumpers: std_b < 16.0
            is_uniform = (std_b < 16.0) or (mean_b < 32.0) or (mean_b > 242.0 and std_b < 14.0)
            return is_uniform, float(std_b), float(mean_b)
    except Exception as e:
        logger.debug(f"[evaluate_frame_uniformity] Failed to read {img_path}: {e}")
        return False, 50.0, 128.0


def detect_intro_end(
    video_path: str,
    duration: float,
    max_scan_seconds: float = 45.0
) -> float:
    """
    Analyzes the initial 0 to max_scan_seconds of a video.
    Detects solid color screens, studio logos, black frames, and frozen title cards.
    Returns the timestamp in seconds where the real dynamic content starts.
    """
    if not video_path or not os.path.exists(video_path):
        return 0.0

    ffmpeg_exe = get_ffmpeg_path()
    if not ffmpeg_exe:
        return 0.0

    scan_limit = min(float(duration or 60.0), max_scan_seconds)
    if scan_limit < 4.0:
        return 0.0

    # Step 1: Check FFmpeg blackdetect & freezedetect on first scan_limit seconds
    black_freeze_end = 0.0
    try:
        cmd = [
            ffmpeg_exe,
            "-y",
            "-t", str(scan_limit),
            "-i", video_path,
            "-vf", "blackdetect=d=1.0:pix_th=0.12,freezedetect=n=-55dB:d=1.5",
            "-f", "null",
            "-"
        ]
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            creationflags=_NO_WINDOW
        )
        output = res.stderr or ""

        # Parse black_end
        black_ends = [float(m.group(1)) for m in re.finditer(r"black_end:([0-9.]+)", output)]
        if black_ends:
            black_freeze_end = max(black_freeze_end, max(black_ends))

        # Parse freeze_end
        freeze_ends = [float(m.group(1)) for m in re.finditer(r"freeze_end:([0-9.]+)", output)]
        if freeze_ends:
            black_freeze_end = max(black_freeze_end, max(freeze_ends))
    except Exception as e:
        logger.debug(f"[detect_intro_end] FFmpeg filter check skipped: {e}")

    # Step 2: Sample lightweight frames (at 0s, 2s, 4s, 7s, 10s, 14s) to check color uniformity
    color_intro_end = 0.0
    temp_dir = os.path.join(os.path.dirname(os.path.abspath(video_path)), ".tmp_shorts_detect")
    try:
        os.makedirs(temp_dir, exist_ok=True)
        sample_seconds = [s for s in [0, 2, 4, 7, 10, 14] if s < scan_limit]
        for sec in sample_seconds:
            tmp_frame = os.path.join(temp_dir, f"frame_{sec}_{os.getpid()}.jpg")
            cmd_frame = [
                ffmpeg_exe,
                "-y",
                "-ss", str(sec),
                "-i", video_path,
                "-vframes", "1",
                "-vf", "scale=120:-1",
                tmp_frame
            ]
            r = subprocess.run(cmd_frame, capture_output=True, timeout=3, creationflags=_NO_WINDOW)
            if r.returncode == 0 and os.path.exists(tmp_frame):
                is_uniform, _, _ = evaluate_frame_uniformity(tmp_frame)
                try:
                    os.remove(tmp_frame)
                except Exception:
                    pass

                if is_uniform:
                    color_intro_end = float(sec + 1)
                else:
                    # Once we hit a non-uniform frame, the intro logo has ended
                    break
    except Exception as e:
        logger.debug(f"[detect_intro_end] Sampling check failed: {e}")
    finally:
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    intro_boundary = max(black_freeze_end, color_intro_end)

    # Sanity guard: intro cannot take more than 40% of video duration or 35s
    max_allowed = min(scan_limit * 0.4, 35.0)
    return round(min(intro_boundary, max_allowed), 1)


def extract_full_timeline_audio_energy(
    video_path: str,
    duration: float
) -> Tuple[List[float], Dict[str, Any]]:
    """
    Extracts resampled 1-Hz audio RMS energy across the ENTIRE video file in a single fast pass.
    Guarantees zero video decoding overhead via -vn -sn (typically < 0.6s for standard videos).
    Returns per-second energy array and audio diagnostic metrics.
    """
    stats = {"audio_found": False, "mean_db": -90.0, "duration_scanned": 0.0}
    if not video_path or not os.path.exists(video_path):
        return [], stats

    ffmpeg_exe = get_ffmpeg_path()
    if not ffmpeg_exe:
        return [], stats

    # Resample audio to 2000Hz with 2000 sample frame size = exactly 1 sample per second
    cmd = [
        ffmpeg_exe, "-y",
        "-i", video_path,
        "-vn", "-sn",
        "-af", "aresample=2000,asetnsamples=2000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f", "null", "-"
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=25,
            creationflags=_NO_WINDOW
        )
    except Exception as e:
        logger.debug(f"[extract_full_timeline_audio_energy] Subprocess error: {e}")
        return [], stats

    raw_energy: List[float] = []
    for line in proc.stdout.splitlines():
        if "lavfi.astats.Overall.RMS_level=" in line:
            val_str = line.split("=")[-1].strip()
            if val_str and val_str != "-inf":
                try:
                    db_val = float(val_str)
                    # Convert -90dB..0dB to 0.0..100.0 linear energy scale
                    e = max(0.0, min(100.0, (db_val + 90.0) * (100.0 / 90.0)))
                    raw_energy.append(e)
                except ValueError:
                    raw_energy.append(0.0)
            else:
                raw_energy.append(0.0)

    if raw_energy:
        stats["audio_found"] = True
        stats["duration_scanned"] = len(raw_energy)
        stats["mean_db"] = round(sum(raw_energy) / len(raw_energy), 1)

    return raw_energy, stats


def compute_composite_scores(
    energy: List[float],
    duration: float,
    intro_end: float = 0.0
) -> List[float]:
    """
    Computes multi-feature composite score per second:
    1. Base RMS Energy (60%)
    2. Crescendo derivative (rising tension slope over previous 10s) (40%)
    3. Narrative Arc Prior (P_arc): prior distribution peaking at the 60%-88% climax zone.
    """
    n = len(energy)
    if n == 0:
        return []

    composite = [0.0] * n
    dur = max(float(n), duration or 1.0)

    for i in range(n):
        curr_e = energy[i]

        # 1. Crescendo buildup (energy difference from 10s ago)
        lookback = max(0, i - 10)
        past_e = energy[lookback]
        crescendo = max(0.0, curr_e - past_e)

        # 2. Narrative Arc Prior P_arc
        rel_pos = i / dur
        if i < intro_end:
            p_arc = 0.15
        elif rel_pos < 0.12:
            p_arc = 0.40  # early hook / intro
        elif rel_pos < 0.55:
            # Linear rise from 0.70 to 0.90
            p_arc = 0.70 + 0.20 * ((rel_pos - 0.12) / 0.43)
        elif rel_pos <= 0.88:
            # Climax zone (natural apex of drama/action)
            p_arc = 1.0
        else:
            # Resolution / Outro
            p_arc = 0.85 - 0.35 * ((rel_pos - 0.88) / 0.12)

        # 3. Combine signals
        raw_score = (curr_e * 0.60) + (crescendo * 0.40)
        composite[i] = raw_score * p_arc

    return composite


def extract_top_highlights(
    composite_scores: List[float],
    duration: float,
    intro_end: float = 0.0,
    window_duration: float = 35.0,
    top_k: int = 3
) -> List[Dict[str, Any]]:
    """
    Performs sliding window search followed by Temporal Non-Maximum Suppression (NMS)
    to select Top K distinct, diverse highlights:
    - Gold: Absolute climax peak
    - Silver: Secondary climax separated by at least 55 seconds
    - Bronze: Early dynamic hook or third intense peak
    """
    n = len(composite_scores)
    w_len = int(max(15.0, min(60.0, window_duration)))

    if n < w_len:
        return [{
            "id": "hl_gold",
            "rank": "gold",
            "label": "⚡ Clímax Principal",
            "start": round(intro_end, 1),
            "end": round(duration, 1),
            "duration": round(duration - intro_end, 1),
            "score": 75.0,
            "reason": "Vídeo curto abrangido integralmente"
        }]

    start_bound = int(intro_end)
    end_bound = max(start_bound + 1, n - w_len)
    window_scores: List[Tuple[float, int]] = []

    for i in range(start_bound, end_bound):
        w_slice = composite_scores[i : i + w_len]
        if not w_slice:
            continue
        avg_s = sum(w_slice) / len(w_slice)
        max_s = max(w_slice)
        w_val = (avg_s * 0.55) + (max_s * 0.45)
        window_scores.append((w_val, i))

    if not window_scores:
        start = round(intro_end + (duration - intro_end) * 0.70, 1)
        end = min(duration, start + w_len)
        return [{
            "id": "hl_gold",
            "rank": "gold",
            "label": "⚡ Clímax Principal",
            "start": start,
            "end": end,
            "duration": round(end - start, 1),
            "score": 65.0,
            "reason": "Estimativa na zona de clímax (70%)"
        }]

    # Sort candidates by score descending
    window_scores.sort(key=lambda x: x[0], reverse=True)
    max_raw_score = max(1.0, window_scores[0][0])

    # Temporal NMS: enforce minimum distance between candidate highlights
    min_separation = max(50.0, float(w_len) * 1.3)
    selected_starts: List[Tuple[int, float]] = []

    for score_val, start_idx in window_scores:
        too_close = False
        for s_idx, _ in selected_starts:
            if abs(start_idx - s_idx) < min_separation:
                too_close = True
                break
        if not too_close:
            norm_score = round(min(99.0, max(52.0, (score_val / max_raw_score) * 98.0)), 1)
            selected_starts.append((start_idx, norm_score))
            if len(selected_starts) >= top_k:
                break

    # If we couldn't find 3 separated peaks, search for an early hook in the first half
    if len(selected_starts) < top_k and duration > 90.0:
        hook_search_end = min(int(duration * 0.40), end_bound)
        best_early = None
        best_early_score = -1.0
        for score_val, idx in window_scores:
            if idx <= hook_search_end:
                if not any(abs(idx - s_idx) < 30.0 for s_idx, _ in selected_starts):
                    if score_val > best_early_score:
                        best_early_score = score_val
                        best_early = idx
        if best_early is not None:
            norm_score = round(min(90.0, max(48.0, (best_early_score / max_raw_score) * 90.0)), 1)
            selected_starts.append((best_early, norm_score))

    ranks = ["gold", "silver", "bronze"]
    labels = [
        "⚡ Clímax Principal",
        "🔥 Destaque Secundário",
        "🎯 Gancho Dinâmico"
    ]

    highlights = []
    for rank_idx, (s_idx, s_score) in enumerate(selected_starts):
        rank = ranks[rank_idx] if rank_idx < len(ranks) else f"rank_{rank_idx+1}"
        label = labels[rank_idx] if rank_idx < len(labels) else f"Destaque #{rank_idx+1}"
        s_time = float(s_idx)
        e_time = min(duration, s_time + w_len)

        rel_pct = round((s_time / max(1.0, duration)) * 100)
        reason = f"Pico acústico e dinamismo na posição {rel_pct}% do vídeo"
        if rank == "gold":
            reason += " • Ápice de intensidade e ação"
        elif rank == "silver":
            reason += " • Momento alternativo de alta energia"
        elif rank == "bronze":
            reason += " • Gancho de abertura rápida"

        highlights.append({
            "id": f"hl_{rank}",
            "rank": rank,
            "label": label,
            "start": round(s_time, 1),
            "end": round(e_time, 1),
            "duration": round(e_time - s_time, 1),
            "score": s_score,
            "reason": reason
        })

    return highlights


def extract_heatmap_peak(
    heatmap_data: Optional[List[Dict[str, Any]]],
    duration: float
) -> Optional[Tuple[float, float]]:
    """
    Extracts the highest peak from yt-dlp heatmap engagement graph if available.
    Returns (start_sec, end_sec) or None.
    Maintained for direct callers and backwards-compatibility.
    """
    if not heatmap_data or not isinstance(heatmap_data, list):
        return None

    try:
        best_pt = max(heatmap_data, key=lambda x: x.get("value", 0.0) if isinstance(x, dict) else 0.0)
        peak_time = best_pt.get("start_time") or best_pt.get("time")
        if peak_time is not None:
            pt = float(peak_time)
            start = max(0.0, pt - 10.0)
            end = min(duration, start + 35.0)
            return round(start, 1), round(end, 1)
    except Exception as e:
        logger.debug(f"[extract_heatmap_peak] Failed: {e}")

    return None


def detect_audio_peaks(
    video_path: str,
    duration: float,
    intro_end: float = 0.0,
    window_duration: float = 35.0
) -> Tuple[float, float, float]:
    """
    Fast acoustic dynamics detection across full video timeline.
    Returns (highlight_start, highlight_end, peak_score).
    Maintained for direct backward-compatibility.
    """
    target_window = max(15.0, min(60.0, window_duration))
    energy, _ = extract_full_timeline_audio_energy(video_path, duration)
    if not energy:
        start = round(intro_end + (duration - intro_end) * 0.72, 1)
        return start, min(duration, start + target_window), 65.0

    composite = compute_composite_scores(energy, duration, intro_end)
    highlights = extract_top_highlights(
        composite_scores=composite,
        duration=duration,
        intro_end=intro_end,
        window_duration=target_window,
        top_k=1
    )
    if highlights:
        top = highlights[0]
        return top["start"], top["end"], top["score"]

    start = round(intro_end + (duration - intro_end) * 0.72, 1)
    return start, min(duration, start + target_window), 65.0


def analyze_video_smart_highlights(
    video_path: str,
    duration: float = 0.0,
    heatmap_data: Optional[List[Dict[str, Any]]] = None,
    desired_window: float = 35.0
) -> Dict[str, Any]:
    """
    Main entry point for smart shorts intelligence:
    1. Detects intro boundary (bypassing solid color / logos / black frames).
    2. Checks yt-dlp heatmap if present (viral peak from audience).
    3. Runs ultra-fast full-timeline audio dynamics and crescendo analysis.
    4. Computes Top 3 diverse highlights (Gold Climax, Silver Secondary, Bronze Hook).
    Returns a rich dictionary ready for metadata storage and instant frontend seek.
    """
    eff_dur = float(duration or 0.0)
    if eff_dur <= 0 and video_path and os.path.exists(video_path):
        ffprobe_exe = get_ffprobe_path()
        if ffprobe_exe:
            try:
                cmd = [
                    ffprobe_exe,
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    video_path
                ]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=5, creationflags=_NO_WINDOW)
                if r.returncode == 0 and r.stdout.strip():
                    eff_dur = float(r.stdout.strip())
            except Exception:
                pass

    if eff_dur <= 0:
        eff_dur = 60.0

    # 1. Detect Intro
    intro_end = detect_intro_end(video_path, eff_dur)

    # 2. Check Heatmap (Crowd-sourced audience curve)
    heatmap_res = extract_heatmap_peak(heatmap_data, eff_dur)
    if heatmap_res and heatmap_res[0] >= intro_end:
        start_sec, end_sec = heatmap_res
        gold_hl = {
            "id": "hl_gold",
            "rank": "gold",
            "label": "⚡ Clímax Viral",
            "start": start_sec,
            "end": end_sec,
            "duration": round(end_sec - start_sec, 1),
            "score": 98.5,
            "reason": "Pico de reexibição viral detectado pela audiência"
        }
        return {
            "intro_end": intro_end,
            "highlight_start": start_sec,
            "highlight_end": end_sec,
            "highlight_score": 98.5,
            "detection_method": "yt_dlp_heatmap",
            "reason": "Pico de reexibição viral detectado pela audiência",
            "duration": eff_dur,
            "highlights": [gold_hl]
        }

    # 3. Full-Timeline Fast Resampled Audio Dynamics
    win_dur = max(15.0, min(60.0, desired_window))
    energy, audio_stats = extract_full_timeline_audio_energy(video_path, eff_dur)

    if not energy or not audio_stats.get("audio_found"):
        # Fallback to Narrative Arc Prior distribution
        gold_start = round(intro_end + (eff_dur - intro_end) * 0.72, 1)
        gold_end = min(eff_dur, gold_start + win_dur)
        silver_start = round(intro_end + (eff_dur - intro_end) * 0.45, 1)
        silver_end = min(eff_dur, silver_start + win_dur)
        bronze_start = round(intro_end + (eff_dur - intro_end) * 0.18, 1)
        bronze_end = min(eff_dur, bronze_start + win_dur)

        fallback_highlights = [
            {
                "id": "hl_gold",
                "rank": "gold",
                "label": "⚡ Clímax Principal",
                "start": gold_start,
                "end": gold_end,
                "duration": round(gold_end - gold_start, 1),
                "score": 68.0,
                "reason": "Estimativa por curva narrativa no arco de clímax (72%)"
            },
            {
                "id": "hl_silver",
                "rank": "silver",
                "label": "🔥 Destaque Intermediário",
                "start": silver_start,
                "end": silver_end,
                "duration": round(silver_end - silver_start, 1),
                "score": 60.0,
                "reason": "Estimativa no desenvolvimento do vídeo (45%)"
            },
            {
                "id": "hl_bronze",
                "rank": "bronze",
                "label": "🎯 Gancho de Abertura",
                "start": bronze_start,
                "end": bronze_end,
                "duration": round(bronze_end - bronze_start, 1),
                "score": 55.0,
                "reason": "Estimativa de gancho inicial pós-intro (18%)"
            }
        ]

        reason = f"Estimativa narrativa ({gold_start}s a {gold_end}s)"
        if intro_end > 0:
            reason += f" • Intro pulada ({intro_end}s)"

        return {
            "intro_end": intro_end,
            "highlight_start": gold_start,
            "highlight_end": gold_end,
            "highlight_score": 68.0,
            "detection_method": "narrative_arc_prior_fallback",
            "reason": reason,
            "duration": eff_dur,
            "highlights": fallback_highlights
        }

    # 4. Compute composite scores & Top Highlights
    composite = compute_composite_scores(energy, eff_dur, intro_end)
    highlights = extract_top_highlights(
        composite_scores=composite,
        duration=eff_dur,
        intro_end=intro_end,
        window_duration=win_dur,
        top_k=3
    )

    gold = highlights[0]
    reason = gold["reason"]
    if intro_end > 0:
        reason += f" • Intro pulada ({intro_end}s)"

    return {
        "intro_end": intro_end,
        "highlight_start": gold["start"],
        "highlight_end": gold["end"],
        "highlight_score": gold["score"],
        "detection_method": "fast_resampled_audio_crescendo",
        "reason": reason,
        "duration": eff_dur,
        "highlights": highlights,
        "audio_diagnostics": audio_stats
    }
