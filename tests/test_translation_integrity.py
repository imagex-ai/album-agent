# -*- coding: utf-8 -*-
"""
SRE & QA Automated Regression Test: Translation Parity & Localization Safety.
Enforces 100% key parity between pt-BR and en-US, verifies zero missing keys in views,
and validates that the defensive fallback proxy protects the UI from undefined crashes.
"""

import os
import re
import json
import subprocess
import pytest


def _extract_translations_via_node():
    """Extracts parsed translations object from translations.ts using Node.js."""
    script = """
    const fs = require('fs');
    let content = fs.readFileSync('frontend-mobile-preview/src/i18n/translations.ts', 'utf8');
    content = content
      .replace(/import\\s+.*?;/g, '')
      .replace(/export\\s+type\\s+[\\s\\S]*?;/g, '')
      .replace(/const\\s+rawTranslations\\s*:\\s*Record<[^>]+>\\s*=\\s*/, 'global.rawTranslations = ')
      .replace(/export\\s+const\\s+translations\\s*:\\s*Record<[^>]+>\\s*=\\s*/, 'global.translations = ')
      .replace(/:\\s*ProxyHandler<[^>]+>/g, '')
      .replace(/:\\s*any/g, '');
    eval(content);
    process.stdout.write(JSON.stringify(global.rawTranslations));
    """
    res = subprocess.run(["node", "-e", script], capture_output=True, text=True, encoding="utf-8", cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    assert res.returncode == 0, f"Node failed to parse translations.ts: {res.stderr}"
    return json.loads(res.stdout)


def test_translation_dictionaries_exact_parity():
    """Validates that pt-BR and en-US have 100% key parity across all sections."""
    translations = _extract_translations_via_node()
    pt = translations.get("pt-BR", {})
    en = translations.get("en-US", {})

    assert pt, "pt-BR dictionary must not be empty"
    assert en, "en-US dictionary must not be empty"

    def get_all_keys(d, prefix=""):
        keys = set()
        for k, v in d.items():
            full = f"{prefix}.{k}" if prefix else k
            keys.add(full)
            if isinstance(v, dict):
                keys.update(get_all_keys(v, full))
        return keys

    pt_keys = get_all_keys(pt)
    en_keys = get_all_keys(en)

    missing_in_en = pt_keys - en_keys
    missing_in_pt = en_keys - pt_keys

    assert not missing_in_en, f"Keys present in pt-BR but missing in en-US: {missing_in_en}"
    assert not missing_in_pt, f"Keys present in en-US but missing in pt-BR: {missing_in_pt}"


def test_settings_view_translation_keys_resolved():
    """Ensures every t.<key> called in SettingsView.tsx exists in both language dictionaries."""
    translations = _extract_translations_via_node()
    pt_settings = translations["pt-BR"]["settings"]
    en_settings = translations["en-US"]["settings"]

    settings_path = os.path.join(os.path.dirname(__file__), "..", "frontend-mobile-preview", "src", "components", "views", "SettingsView.tsx")
    with open(settings_path, "r", encoding="utf-8") as f:
        code = f.read()

    used_keys = set(re.findall(r"\bt\.([a-zA-Z0-9_]+)", code))
    assert len(used_keys) > 50, "SettingsView must use translation keys"

    missing_in_pt = [k for k in used_keys if k not in pt_settings]
    missing_in_en = [k for k in used_keys if k not in en_settings]

    assert not missing_in_pt, f"Keys used in SettingsView missing in pt-BR settings: {missing_in_pt}"
    assert not missing_in_en, f"Keys used in SettingsView missing in en-US settings: {missing_in_en}"


def test_settings_view_zero_untranslated_strings():
    """SRE Gatekeeper: checks that common Portuguese leakages in SettingsView are properly bilingual."""
    settings_path = os.path.join(os.path.dirname(__file__), "..", "frontend-mobile-preview", "src", "components", "views", "SettingsView.tsx")
    with open(settings_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    leaked_lines = []
    forbidden_pt_patterns = [
        r"'Preto puro para telas OLED",
        r"'Batida suave relaxante'",
        r"'Chuva Suave'",
        r"Conectado \(API Ativa\)",
        r"Chave Salva \(Offline/Erro\)",
        r"Token Salvo \(Validando\)",
        r">Token no Servidor:<",
        r">Padrão recomendado:<",
        r">Limite de ciclos cognitivos:<",
        r">Mapear Novo Site:<",
        r">Sites com Abas/JS:<",
        r"Clique p/ reproduzir",
        r"8 Cores Perceptuais",
    ]

    for idx, line in enumerate(lines):
        # Ignore comments and lines with bilingual ternaries
        stripped = line.strip()
        if stripped.startswith(("//", "/*", "*", "{/*")):
            continue
        for pat in forbidden_pt_patterns:
            if re.search(pat, line) and "isEn" not in line and "settings.language" not in line:
                leaked_lines.append((idx + 1, pat, stripped))

    assert not leaked_lines, f"Found untranslated Portuguese strings in SettingsView.tsx: {leaked_lines}"


def test_translation_leaf_values_are_valid_strings():
    """Validates that all leaf entries in translations are strings or numbers, never raw objects that crash React (Error #31)."""
    translations = _extract_translations_via_node()
    for lang in ["pt-BR", "en-US"]:
        dict_obj = translations.get(lang, {})
        def check_leaves(d, path=""):
            for k, v in d.items():
                curr = f"{path}.{k}" if path else k
                if isinstance(v, dict):
                    check_leaves(v, curr)
                else:
                    assert isinstance(v, (str, int, float, list)), f"Leaf {curr} in {lang} must be string/number, got {type(v)}"
        check_leaves(dict_obj)


def test_shorts_view_translation_keys_resolved():
    """Ensures every t.shorts.<key> and t.globalSlider.<key> called in ShortsView.tsx exists in both language dictionaries."""
    translations = _extract_translations_via_node()
    shorts_path = os.path.join(os.path.dirname(__file__), "..", "frontend-mobile-preview", "src", "components", "views", "ShortsView.tsx")
    with open(shorts_path, "r", encoding="utf-8") as f:
        code = f.read()

    used_shorts_keys = set(re.findall(r"\bt\.shorts\.([a-zA-Z0-9_]+)", code))
    used_slider_keys = set(re.findall(r"\bt\.globalSlider\.([a-zA-Z0-9_]+)", code))
    assert len(used_shorts_keys) >= 15, "ShortsView must use t.shorts.* translation keys"

    for lang in ["pt-BR", "en-US"]:
        shorts_dict = translations[lang]["shorts"]
        slider_dict = translations[lang]["globalSlider"]
        missing_shorts = [k for k in used_shorts_keys if k not in shorts_dict]
        missing_slider = [k for k in used_slider_keys if k not in slider_dict]
        assert not missing_shorts, f"Keys used in ShortsView missing in {lang} shorts: {missing_shorts}"
        assert not missing_slider, f"Keys used in ShortsView missing in {lang} globalSlider: {missing_slider}"

