# -*- coding: utf-8 -*-
"""
IMAGEX.AI - Comprehensive Translation Verification & Line-by-Line Scanner
Scans all lines of all code files in the repository and verifies English translation coverage.
"""
import os
import re
import json
import sys
import subprocess

PT_DIACRITICS = re.compile(r'[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]')
PT_COMMON_WORDS = re.compile(r'\b(não|sim|você|para|pasta|arquivo|álbum|vídeo|gravar|salvar|excluir|remover|configuração|tarefa|concluído|sucesso|falha|erro|carregando|selecionar|todos|tudo|novo|nova)\b', re.IGNORECASE)

def load_translations():
    """Extracts translations from frontend-mobile-preview/src/i18n/translations.ts via Node.js evaluation."""
    path = os.path.join('frontend-mobile-preview', 'src', 'i18n', 'translations.ts')
    if not os.path.exists(path):
        return {}, {}

    node_script = """
    const fs = require('fs');
    let content = fs.readFileSync('""" + path.replace('\\', '/') + """', 'utf8');
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
    try:
        res = subprocess.run(["node", "-e", node_script], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout:
            data = json.loads(res.stdout)
            return data.get('pt-BR', {}), data.get('en-US', {})
        else:
            print(f"[Warning] Node script error parsing translations: {res.stderr}")
    except Exception as e:
        print(f"[Warning] Could not parse translations.ts: {e}")
    return {}, {}

def extract_flat_keys(d, prefix=""):
    items = {}
    for k, v in d.items():
        curr = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            items.update(extract_flat_keys(v, curr))
        else:
            items[curr] = v
    return items

def scan_file(fpath, pt_dict, en_dict):
    """Inspects every single line of a file for Portuguese text and checks for English translation."""
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()

    line_results = []
    
    # Pre-extract strings from en_dict for matching
    en_values = set(str(v).strip().lower() for v in en_dict.values() if isinstance(v, str))
    pt_values = {str(v).strip().lower(): str(en_dict.get(k, '')).strip() for k, v in pt_dict.items() if isinstance(v, str)}

    for idx, line in enumerate(lines):
        line_num = idx + 1
        stripped = line.strip()

        # Skip comments, imports, svg paths
        if not stripped or stripped.startswith(('//', '/*', '*', '#', 'import ', 'export type', 'from ')):
            continue
        if '<path ' in stripped or 'd="M' in stripped:
            continue

        # Check if line contains Portuguese text
        has_pt = bool(PT_DIACRITICS.search(stripped) or PT_COMMON_WORDS.search(stripped))
        if not has_pt:
            continue

        # Check if line already has bilingual translation in place
        has_inline_en = bool(
            re.search(r'\b(isEn|isPt|settings\.language === [\'"]en-US[\'"])\b', line) or
            ('?' in line and ':' in line and ('en' in line.lower() or 'english' in line.lower() or 'general' in line.lower() or 'home' in line.lower()))
        )

        # Check if it uses translation dictionary call (t., tAi., tStore., translations[)
        uses_translation_dict = bool(re.search(r'\b(t\.|tAi\.|tStore\.|tPerf\.|tJobs\.|tDom\.|translations\[)', line))

        # Check if matched against dictionary
        matched_dict_en = None
        for pt_str, en_str in pt_values.items():
            if pt_str and len(pt_str) > 4 and pt_str in stripped.lower():
                matched_dict_en = en_str
                break

        is_translated = has_inline_en or (uses_translation_dict and bool(matched_dict_en))

        line_results.append({
            "line": line_num,
            "text": stripped[:120],
            "has_inline_en": has_inline_en,
            "uses_translation_dict": uses_translation_dict,
            "matched_dict_en": matched_dict_en,
            "is_covered": is_translated
        })

    return line_results

def run_audit(root_dir='.'):
    print("=" * 70)
    print("      IMAGEX.AI - SYSTEMIC TRANSLATION & LOCALIZATION AUDIT")
    print("=" * 70)

    pt_dict, en_dict = load_translations()
    flat_pt = extract_flat_keys(pt_dict)
    flat_en = extract_flat_keys(en_dict)

    print(f"\n[1] Dictionary Integrity:")
    print(f"    - Total pt-BR translation keys: {len(flat_pt)}")
    print(f"    - Total en-US translation keys: {len(flat_en)}")

    missing_in_en = set(flat_pt.keys()) - set(flat_en.keys())
    missing_in_pt = set(flat_en.keys()) - set(flat_pt.keys())
    has_dict_errors = False
    if missing_in_en:
        print(f"    - [ERROR] {len(missing_in_en)} keys missing in en-US!")
        has_dict_errors = True
    if missing_in_pt:
        print(f"    - [ERROR] {len(missing_in_pt)} keys missing in pt-BR!")
        has_dict_errors = True
    if not has_dict_errors:
        print(f"    - [OK] 100% of pt-BR keys have exact en-US mirrored translations!")

    print(f"\n[2] Scanning All Files Line-by-Line...")
    file_stats = []
    total_pt_lines = 0
    total_covered_lines = 0

    scan_extensions = ('.tsx', '.ts', '.py', '.html', '.js')
    ignore_paths = ('node_modules', '.git', 'translations.ts', 'dist', 'build', '__pycache__', 'tests', 'data')

    for r, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in ignore_paths]
        for f in files:
            if f.endswith(scan_extensions):
                fpath = os.path.relpath(os.path.join(r, f), root_dir)
                if any(ignored in fpath for ignored in ignore_paths):
                    continue

                res = scan_file(fpath, flat_pt, flat_en)
                if res:
                    covered = sum(1 for r in res if r["is_covered"])
                    total_pt_lines += len(res)
                    total_covered_lines += covered
                    file_stats.append({
                        "file": fpath,
                        "total_lines": len(res),
                        "covered_lines": covered,
                        "coverage_pct": round((covered / len(res)) * 100, 1),
                        "items": res
                    })

    file_stats.sort(key=lambda x: -x["total_lines"])

    print(f"\n[3] Line-by-Line Scan Results:")
    print(f"    - Files containing localized/Portuguese text: {len(file_stats)}")
    print(f"    - Total Portuguese lines checked: {total_pt_lines}")
    print(f"    - Total lines with active English translation: {total_covered_lines}")
    global_coverage = round((total_covered_lines / max(1, total_pt_lines)) * 100, 1)
    print(f"    - Overall English Translation Coverage: {global_coverage}%\n")

    print(f"{'File':<65} | {'PT Lines':<8} | {'Covered':<8} | {'Coverage':<8}")
    print("-" * 95)
    for stat in file_stats[:25]:
        print(f"{stat['file']:<65} | {stat['total_lines']:<8} | {stat['covered_lines']:<8} | {stat['coverage_pct']}%")

    print("=" * 70)
    return global_coverage, file_stats, has_dict_errors

if __name__ == '__main__':
    cov, stats, has_err = run_audit()
    if has_err:
        print("\n[FATAL] SRE Gatekeeper: Dictionary parity broken! Build aborted.")
        sys.exit(1)
    sys.exit(0)
