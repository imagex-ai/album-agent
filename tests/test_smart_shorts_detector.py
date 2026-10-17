"""
Tests for Smart Shorts Detector Engine.
Verifies color uniformity evaluation, intro detection, and audio peak window calculation.
"""

import os
import tempfile
import pytest
from PIL import Image, ImageDraw

from src.server.smart_shorts_detector import (
    evaluate_frame_uniformity,
    detect_audio_peaks,
    extract_heatmap_peak,
    analyze_video_smart_highlights
)


def test_evaluate_frame_uniformity_solid_black():
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        path = f.name
    try:
        im = Image.new("RGB", (100, 100), color=(0, 0, 0))
        im.save(path)
        is_uniform, std_b, mean_b = evaluate_frame_uniformity(path)
        assert is_uniform is True
        assert mean_b < 5.0
        assert std_b < 2.0
    finally:
        if os.path.exists(path):
            os.remove(path)


def test_evaluate_frame_uniformity_solid_color_logo():
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        path = f.name
    try:
        im = Image.new("RGB", (100, 100), color=(30, 45, 90))
        im.save(path)
        is_uniform, std_b, mean_b = evaluate_frame_uniformity(path)
        assert is_uniform is True
        assert std_b < 5.0
    finally:
        if os.path.exists(path):
            os.remove(path)


def test_evaluate_frame_uniformity_dynamic_scene():
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        path = f.name
    try:
        im = Image.new("RGB", (200, 200), color=(128, 128, 128))
        draw = ImageDraw.Draw(im)
        draw.rectangle([10, 10, 90, 90], fill=(255, 0, 0))
        draw.rectangle([110, 110, 190, 190], fill=(0, 255, 0))
        draw.rectangle([10, 110, 90, 190], fill=(0, 0, 255))
        draw.rectangle([110, 10, 190, 90], fill=(255, 255, 0))
        im.save(path)

        is_uniform, std_b, mean_b = evaluate_frame_uniformity(path)
        assert is_uniform is False
        assert std_b > 25.0
    finally:
        if os.path.exists(path):
            os.remove(path)


def test_extract_heatmap_peak():
    mock_heatmap = [
        {"start_time": 0.0, "end_time": 10.0, "value": 0.2},
        {"start_time": 10.0, "end_time": 20.0, "value": 0.3},
        {"start_time": 50.0, "end_time": 60.0, "value": 0.95},
        {"start_time": 60.0, "end_time": 70.0, "value": 0.4},
    ]
    res = extract_heatmap_peak(mock_heatmap, duration=120.0)
    assert res is not None
    start, end = res
    assert start == 40.0
    assert end == 75.0


def test_analyze_video_smart_highlights_fallback():
    # When file doesn't exist or is mock, returns safe calculated window
    res = analyze_video_smart_highlights("non_existent_mock.mp4", duration=120.0, desired_window=40.0)
    assert "intro_end" in res
    assert "highlight_start" in res
    assert "highlight_end" in res
    assert "highlights" in res
    assert len(res["highlights"]) >= 1
    assert res["highlight_end"] >= res["highlight_start"]
    # Verify window duration matches user preference (30-50s)
    diff = res["highlight_end"] - res["highlight_start"]
    assert 25.0 <= diff <= 50.0


def test_compute_composite_scores_and_nms_diversity():
    from src.server.smart_shorts_detector import compute_composite_scores, extract_top_highlights

    # Create synthetic 300s energy profile with 2 major peaks
    # Peak A: at 100s
    # Peak B (climax): at 220s (73% of duration)
    energy = [20.0] * 300
    for i in range(95, 115):
        energy[i] = 75.0
    for i in range(210, 240):
        energy[i] = 95.0

    scores = compute_composite_scores(energy, duration=300.0, intro_end=5.0)
    assert len(scores) == 300

    # Due to P_arc (narrative prior peaking at 60-88%), 220s should score higher than 100s
    assert scores[220] > scores[100]

    # Extract Top 3 highlights with window=30s
    highlights = extract_top_highlights(scores, duration=300.0, intro_end=5.0, window_duration=30.0, top_k=3)
    assert len(highlights) >= 2

    gold = highlights[0]
    assert gold["rank"] == "gold"
    # Gold peak should land around the 210-230s climax zone
    assert 195.0 <= gold["start"] <= 235.0

    silver = highlights[1]
    assert silver["rank"] == "silver"
    # Verify NMS separation: Gold and Silver must not overlap or be too close
    assert abs(gold["start"] - silver["start"]) >= 40.0
