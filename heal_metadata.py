import os
import json
import hashlib

def heal():
    base_dir = os.path.abspath('data/videos')
    meta_path = os.path.join(base_dir, 'videos_metadata.json')
    if not os.path.exists(meta_path):
        print("No metadata file found.")
        return

    with open(meta_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    disk_map = {}
    for root, dirs, files in os.walk(base_dir):
        for f in files:
            if f.lower().endswith(('.mp4', '.mkv', '.webm', '.mov', '.avi', '.ts')):
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, base_dir).replace('\\', '/').strip('/')
                vid = hashlib.md5(rel.encode('utf-8')).hexdigest()[:12]
                disk_map[vid] = (rel, fp, f)

    print(f"Total disk videos indexed: {len(disk_map)}")
    fixed = 0
    for vid, data in meta.items():
        if vid in disk_map:
            rel, fp, fname = disk_map[vid]
            if data.get('rel_path') != rel:
                old_rel = data.get('rel_path')
                data['rel_path'] = rel
                data['filename'] = fname
                data['folder'] = rel.split('/')[0] if '/' in rel else 'Geral'
                print(f"Healed {vid}: {old_rel} -> {rel}")
                fixed += 1

    print(f"Total entries healed: {fixed}")
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    heal()
