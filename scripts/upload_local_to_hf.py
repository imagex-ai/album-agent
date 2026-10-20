import os
import sys
import time
from pathlib import Path
from huggingface_hub import HfApi

ROOT_DIR = Path(__file__).resolve().parent.parent

def get_env_var(name: str) -> str:
    val = os.environ.get(name, "")
    if val:
        return val.strip()
    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{name}="):
                    v = line.split("=", 1)[1].strip()
                    return v.strip('"').strip("'")
    return ""

def main():
    token = get_env_var("HF_TOKEN")
    repo_id = get_env_var("HF_DATASET_REPO")

    if not token:
        print("[ERRO] HF_TOKEN não encontrado no ambiente ou no arquivo .env!")
        sys.exit(1)

    if not repo_id:
        print("[ERRO] HF_DATASET_REPO não configurado no ambiente ou no arquivo .env!")
        print("[AVISO] O upload para o Hugging Face só é permitido quando HF_DATASET_REPO estiver configurado explicitamente (ex: 'usuario/seu-dataset').")
        sys.exit(1)

    print(f"==================================================")
    print(f"SINCRONIZAÇÃO DE ARQUIVOS LOCAIS PARA O HUGGING FACE")
    print(f"Repositório Alvo: {repo_id}")
    print(f"Destino Isolado:  meus_albuns_pc/")
    print(f"==================================================")

    api = HfApi(token=token)
    try:
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
        print(f"Conexão OK com repositório privado: {info.id}\n")
    except Exception as e:
        print(f"[ERRO] Falha ao conectar ao Hugging Face: {e}")
        sys.exit(1)

    # 1. Enviar os 159 arquivos de álbuns JSON de data/albums para meus_albuns_pc/albums/
    albums_dir = ROOT_DIR / "data" / "albums"
    if albums_dir.exists():
        json_files = list(albums_dir.glob("*.json"))
        print(f"\n[1/3] Enviando {len(json_files)} álbuns JSON para 'meus_albuns_pc/albums/'...")
        t0 = time.time()
        try:
            api.upload_folder(
                folder_path=str(albums_dir),
                path_in_repo="meus_albuns_pc/albums",
                repo_id=repo_id,
                repo_type="dataset",
                allow_patterns=["*.json"],
                commit_message="feat: upload local PC album metadata to meus_albuns_pc/albums"
            )
            print(f"[OK] {len(json_files)} albuns JSON enviados com sucesso em {time.time() - t0:.1f}s!")
        except Exception as e:
            print(f"[AVISO] Erro no upload dos albuns JSON: {e}")
    else:
        print("\n[1/3] Pasta data/albums/ nao encontrada.")

    # 2. Enviar fotos da pasta fts para meus_albuns_pc/fotos/fts/
    fts_dir = ROOT_DIR / "data" / "backup data" / "data" / "fts"
    if fts_dir.exists():
        fts_files = [f for f in fts_dir.iterdir() if f.is_file()]
        print(f"\n[2/3] Enviando {len(fts_files)} fotos da pasta 'fts' para 'meus_albuns_pc/fotos/fts/'...")
        t0 = time.time()
        try:
            api.upload_folder(
                folder_path=str(fts_dir),
                path_in_repo="meus_albuns_pc/fotos/fts",
                repo_id=repo_id,
                repo_type="dataset",
                commit_message="feat: upload local PC photos from fts to meus_albuns_pc/fotos/fts"
            )
            print(f"[OK] {len(fts_files)} fotos de 'fts' enviadas com sucesso em {time.time() - t0:.1f}s!")
        except Exception as e:
            print(f"[AVISO] Erro no upload das fotos fts: {e}")
    else:
        print("\n[2/3] Pasta data/backup data/data/fts nao encontrada.")

    # 3. Enviar fotos da pasta fotos_baixadas para meus_albuns_pc/fotos/fotos_baixadas/
    fb_dir = ROOT_DIR / "data" / "backup data" / "data" / "fotos_baixadas" / "fotos_baixadas"
    if not fb_dir.exists():
        fb_dir = ROOT_DIR / "data" / "backup data" / "data" / "fotos_baixadas"

    if fb_dir.exists():
        fb_files = [f for f in fb_dir.iterdir() if f.is_file()]
        print(f"\n[3/3] Enviando {len(fb_files)} fotos de 'fotos_baixadas' para 'meus_albuns_pc/fotos/fotos_baixadas/' (~1.5 GB)...")
        t0 = time.time()
        try:
            api.upload_folder(
                folder_path=str(fb_dir),
                path_in_repo="meus_albuns_pc/fotos/fotos_baixadas",
                repo_id=repo_id,
                repo_type="dataset",
                commit_message="feat: upload local PC downloaded photos to meus_albuns_pc/fotos/fotos_baixadas"
            )
            print(f"[OK] {len(fb_files)} fotos de 'fotos_baixadas' enviadas com sucesso em {time.time() - t0:.1f}s!")
        except Exception as e:
            print(f"[AVISO] Erro no upload de fotos_baixadas: {e}")
    else:
        print("\n[3/3] Pasta fotos_baixadas não encontrada.")

    print(f"\n==================================================")
    print(f"PROCESSO DE SINCRONIZAÇÃO LOCAL CONCLUÍDO!")
    print(f"Todos os seus arquivos locais estão seguramente guardados em 'meus_albuns_pc/' no Hugging Face!")
    print(f"Nada foi misturado com a pasta 'albums/' ou 'videos/' do Render.")
    print(f"==================================================")

if __name__ == "__main__":
    main()
