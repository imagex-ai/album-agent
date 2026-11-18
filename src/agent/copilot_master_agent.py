"""
Copilot Master Agent (IMAGEX Autonomy Architecture)
Provides 100% full autonomous control over the entire IMAGEX application to Google Gemini:
- Albums (List, Details, Search, Create, Delete, Rename, Set Cover, Favorite, Delete Images, Rename Images, Move, ZIP, JSON)
- Videos (List, Details, Download from URL, Import Local, Delete, Batch Delete, Rename, Move, Batch Move, Favorite, Sync Thumbnails)
- Folders (List, Create, Rename, Delete for albums and videos)
- Scrapers & Jobs (Start Scraping Job, Scan Web Page Videos, Batch Save, List Jobs, Control Job: pause/resume/cancel/delete)
- Unified Trash Bin (List, Restore Items, Permanent Delete, Empty Trash)
- Settings & Storage (Get Settings, Update Settings/Keys, Get Storage Analytics, Sync Hugging Face)
- Client UI Control (Navigate App View, Apply UI Filter, Preview Media)
Includes a full multi-turn ReAct execution loop (up to 8 steps) over Gemini REST API.
"""

import os
import re
import json
import time
import shutil
import hashlib
import logging
import asyncio
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone
import httpx

logger = logging.getLogger("copilot_master_agent")

# Dynamic runtime context injected from server.py (or populated with defaults)
_RUNTIME_CONTEXT: Dict[str, Any] = {}


def set_runtime_context(ctx: Dict[str, Any]):
    """Registers server-side caches, service references, and disk operations."""
    global _RUNTIME_CONTEXT
    _RUNTIME_CONTEXT.update(ctx)


def get_runtime_context() -> Dict[str, Any]:
    return _RUNTIME_CONTEXT


# Base directory resolution
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")
ALBUMS_DIR = os.path.join(DATA_DIR, "albums")
VIDEOS_DIR = os.path.join(DATA_DIR, "videos")
TRASH_DIR = os.path.join(DATA_DIR, "trash")
JOBS_FILE = os.path.join(DATA_DIR, "jobs.json")
ALBUM_FOLDERS_FILE = os.path.join(DATA_DIR, "album_folders.json")


# =====================================================================
# GEMINI FUNCTION DECLARATIONS (TOOL SCHEMAS)
# =====================================================================

COPILOT_TOOL_DECLARATIONS = [
    # --- 1. ALBUMS MANAGEMENT ---
    {
        "name": "list_albums",
        "description": "Lista os álbuns da biblioteca com título, quantidade de imagens, imagem de capa, pasta e tags. Suporta busca por palavra-chave e filtro de pasta.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Termo de busca opcional pelo título ou tag."},
                "folder": {"type": "STRING", "description": "Filtrar por nome de pasta (ex: 'Geral', 'Favoritos')."},
                "limit": {"type": "INTEGER", "description": "Quantidade máxima de álbuns a retornar (padrão 20)."}
            }
        }
    },
    {
        "name": "get_album_details",
        "description": "Obtém detalhes completos de um álbum específico, incluindo a lista de todas as fotos, URLs de miniaturas e resoluções.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "Identificador único do álbum (ex: 'sess_131553')."}
            },
            "required": ["album_id"]
        }
    },
    {
        "name": "search_photos",
        "description": "Pesquisa fotos em todos os álbuns da biblioteca por termo de texto no título/origem ou por filtro de harmonia cromática (cor).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Palavra-chave a buscar no título ou arquivo das imagens."},
                "color": {"type": "STRING", "description": "Código de cor hexadecimal (ex: '#facc15' para amarelo, '#dc2626' para vermelho) ou nome da cor."},
                "limit": {"type": "INTEGER", "description": "Quantidade máxima de fotos a retornar (padrão 24)."}
            }
        }
    },
    {
        "name": "create_album",
        "description": "Cria um novo álbum de fotos na biblioteca com título e pasta especificados.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Título descritivo para o novo álbum."},
                "folder": {"type": "STRING", "description": "Pasta onde o álbum será armazenado (padrão 'Geral')."},
                "tags": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de tags opcionais para o álbum."
                }
            },
            "required": ["title"]
        }
    },
    {
        "name": "delete_album",
        "description": "Move um álbum de fotos inteiro para a lixeira (permite restauração futura).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum a ser excluído."}
            },
            "required": ["album_id"]
        }
    },
    {
        "name": "rename_album",
        "description": "Renomeia o título de um álbum de fotos existente na biblioteca.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum a renomear."},
                "new_title": {"type": "STRING", "description": "Novo título do álbum."}
            },
            "required": ["album_id", "new_title"]
        }
    },
    {
        "name": "set_album_cover",
        "description": "Define uma imagem específica como imagem de capa oficial do álbum de fotos.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum."},
                "image_url": {"type": "STRING", "description": "URL ou caminho da imagem que será a capa."}
            },
            "required": ["album_id", "image_url"]
        }
    },
    {
        "name": "toggle_favorite_album",
        "description": "Alterna o status de favorito (adiciona ou remove dos favoritos) de um álbum.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum."}
            },
            "required": ["album_id"]
        }
    },
    {
        "name": "delete_album_images",
        "description": "Exclui fotos específicas de dentro de um álbum, enviando-as para a Lixeira com segurança.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum que contém as imagens."},
                "image_ids": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de IDs das imagens a serem removidas do álbum."
                }
            },
            "required": ["album_id", "image_ids"]
        }
    },
    {
        "name": "rename_album_image",
        "description": "Altera o título ou nome de arquivo de uma imagem dentro de um álbum.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum."},
                "image_id": {"type": "STRING", "description": "ID da imagem."},
                "new_title": {"type": "STRING", "description": "Novo título para a imagem."}
            },
            "required": ["album_id", "image_id", "new_title"]
        }
    },
    {
        "name": "move_album_to_folder",
        "description": "Move um álbum de fotos para outra pasta de organização.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum."},
                "target_folder": {"type": "STRING", "description": "Nome da pasta de destino."}
            },
            "required": ["album_id", "target_folder"]
        }
    },
    {
        "name": "download_album_zip",
        "description": "Obtém o link de download direto do arquivo compactado ZIP contendo todas as imagens originais do álbum.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum para download."}
            },
            "required": ["album_id"]
        }
    },
    {
        "name": "export_album_json",
        "description": "Exporta os metadados completos e histórico de extração do álbum em formato JSON estruturado.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "album_id": {"type": "STRING", "description": "ID do álbum."}
            },
            "required": ["album_id"]
        }
    },

    # --- 2. VIDEOS MANAGEMENT ---
    {
        "name": "list_videos",
        "description": "Lista todos os vídeos da biblioteca de vídeos, com título, duração, pasta, status de favorito e miniaturas.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "folder": {"type": "STRING", "description": "Filtrar por nome de pasta (ex: 'Geral', 'Curtas')."},
                "query": {"type": "STRING", "description": "Filtrar por texto no título do vídeo."},
                "is_favorite": {"type": "BOOLEAN", "description": "Filtrar apenas vídeos favoritos se true."},
                "limit": {"type": "INTEGER", "description": "Quantidade máxima de vídeos a listar (padrão 20)."}
            }
        }
    },
    {
        "name": "get_video_details",
        "description": "Obtém detalhes de um vídeo específico (dimensões, duração, taxa de bits, caminho no disco e stream URL).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_id": {"type": "STRING", "description": "ID único do vídeo."}
            },
            "required": ["video_id"]
        }
    },
    {
        "name": "download_video_from_url",
        "description": "Baixa ou registra um vídeo a partir de uma URL da web (link direto MP4/M3U8 ou página de streaming) para a biblioteca.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "url": {"type": "STRING", "description": "URL do vídeo ou página da web que contém o player."},
                "title": {"type": "STRING", "description": "Título opcional para o vídeo."},
                "folder": {"type": "STRING", "description": "Pasta de destino (padrão 'Geral')."},
                "stream_only": {"type": "BOOLEAN", "description": "Se true, apenas registra para reprodução remota sem consumir espaço em disco."}
            },
            "required": ["url"]
        }
    },
    {
        "name": "import_local_video",
        "description": "Importa um arquivo ou pasta de vídeos diretamente do disco rígido local do computador para a biblioteca de vídeos.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Caminho absoluto do arquivo de vídeo ou pasta no computador do usuário."},
                "folder": {"type": "STRING", "description": "Pasta de destino na biblioteca de vídeos (padrão 'Geral')."},
                "mode": {"type": "STRING", "description": "'copy' para copiar o arquivo ou 'move' para mover fisicamente (padrão 'copy')."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "delete_video",
        "description": "Move um vídeo da biblioteca para a Lixeira da aplicação.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_id": {"type": "STRING", "description": "ID do vídeo a mover para a lixeira."}
            },
            "required": ["video_id"]
        }
    },
    {
        "name": "batch_delete_videos",
        "description": "Move múltiplos vídeos simultaneamente para a Lixeira.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_ids": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de IDs dos vídeos a excluir."
                }
            },
            "required": ["video_ids"]
        }
    },
    {
        "name": "rename_video",
        "description": "Altera o título de exibição de um vídeo.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_id": {"type": "STRING", "description": "ID do vídeo."},
                "new_title": {"type": "STRING", "description": "Novo título do vídeo."}
            },
            "required": ["video_id", "new_title"]
        }
    },
    {
        "name": "move_video_to_folder",
        "description": "Move um vídeo para uma pasta específica da biblioteca de vídeos.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_id": {"type": "STRING", "description": "ID do vídeo."},
                "target_folder": {"type": "STRING", "description": "Nome da pasta de destino."}
            },
            "required": ["video_id", "target_folder"]
        }
    },
    {
        "name": "batch_move_videos",
        "description": "Move múltiplos vídeos simultaneamente para uma pasta de destino.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_ids": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de IDs dos vídeos."
                },
                "target_folder": {"type": "STRING", "description": "Nome da pasta de destino."}
            },
            "required": ["video_ids", "target_folder"]
        }
    },
    {
        "name": "toggle_favorite_video",
        "description": "Marca ou desmarca um vídeo como favorito.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "video_id": {"type": "STRING", "description": "ID do vídeo."}
            },
            "required": ["video_id"]
        }
    },
    {
        "name": "sync_video_thumbnails",
        "description": "Gera e sincroniza miniaturas inteligentes (thumbnails) de vídeos pendentes usando amostragem inteligente de quadros.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },

    # --- 3. FOLDERS MANAGEMENT ---
    {
        "name": "list_folders",
        "description": "Lista todas as pastas existentes no sistema para álbuns e vídeos, com contagem de itens em cada uma.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "type": {"type": "STRING", "description": "'albums', 'videos', ou 'all' (padrão 'all')."}
            }
        }
    },
    {
        "name": "create_folder",
        "description": "Cria uma nova pasta para organização de álbuns ou vídeos.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "description": "Nome da nova pasta."},
                "type": {"type": "STRING", "description": "'albums', 'videos', ou 'all' (padrão 'all')."}
            },
            "required": ["name"]
        }
    },
    {
        "name": "rename_folder",
        "description": "Renomeia uma pasta existente para álbuns ou vídeos.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "old_name": {"type": "STRING", "description": "Nome atual da pasta."},
                "new_name": {"type": "STRING", "description": "Novo nome desejado para a pasta."},
                "type": {"type": "STRING", "description": "'albums', 'videos', ou 'all' (padrão 'all')."}
            },
            "required": ["old_name", "new_name"]
        }
    },
    {
        "name": "delete_folder",
        "description": "Exclui uma pasta do sistema, movendo com segurança todos os seus itens para a pasta padrão 'Geral'.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "description": "Nome da pasta a excluir."},
                "type": {"type": "STRING", "description": "'albums', 'videos', ou 'all' (padrão 'all')."}
            },
            "required": ["name"]
        }
    },

    # --- 4. SCRAPING & EXTRACTION JOBS ---
    {
        "name": "start_scraping_job",
        "description": "Inicia uma tarefa autônoma em segundo plano para extrair e baixar fotos ou vídeos a partir de uma URL web.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "url": {"type": "STRING", "description": "URL da página web a ser extraída."},
                "engine_type": {"type": "STRING", "description": "Mecanismo: 'ai_react' (Agente Inteligente 7 Pilares), 'classic' (Scraper padrão), ou 'gemini_surgical_scout'."},
                "media_type": {"type": "STRING", "description": "'all', 'images', ou 'videos' (padrão 'all')."}
            },
            "required": ["url"]
        }
    },
    {
        "name": "scan_web_page_videos",
        "description": "Varre uma página web em busca de streams de vídeo e players em alta qualidade 1080p.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "url": {"type": "STRING", "description": "URL da página a analisar."}
            },
            "required": ["url"]
        }
    },
    {
        "name": "batch_save_web_videos",
        "description": "Enfileira e baixa múltiplos vídeos identificados em uma varredura web para a biblioteca.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "videos": {
                    "type": "ARRAY",
                    "items": {"type": "OBJECT"},
                    "description": "Lista de objetos de vídeo contendo id, url, title, thumbnail_url, stream_url."
                },
                "folder": {"type": "STRING", "description": "Pasta de destino (padrão 'Extraídos')."}
            },
            "required": ["videos"]
        }
    },
    {
        "name": "list_extraction_jobs",
        "description": "Lista o histórico e o status em tempo real de todas as tarefas de extração (ativas, concluídas, pausadas ou com erro).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "status": {"type": "STRING", "description": "'all', 'running', 'completed', 'paused', 'failed' (padrão 'all')."}
            }
        }
    },
    {
        "name": "control_extraction_job",
        "description": "Executa uma ação de controle sobre uma tarefa de extração: pausar, retomar, cancelar ou excluir.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "job_id": {"type": "STRING", "description": "ID da tarefa de extração (session_id)."},
                "action": {"type": "STRING", "description": "'pause', 'resume', 'cancel', 'delete', 'clear_finished'."}
            },
            "required": ["job_id", "action"]
        }
    },

    # --- 5. UNIFIED TRASH BIN ---
    {
        "name": "list_trash",
        "description": "Lista todos os itens na Lixeira (álbuns, fotos e vídeos) com tamanho ocupado e datas de exclusão.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },
    {
        "name": "restore_trash_items",
        "description": "Restaura itens da lixeira de volta para suas pastas e locais originais na biblioteca.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "trash_ids": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de IDs dos itens na lixeira a restaurar."
                }
            },
            "required": ["trash_ids"]
        }
    },
    {
        "name": "permanent_delete_trash_items",
        "description": "Exclui itens permanentemente da lixeira do disco (ação irreversível).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "trash_ids": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Lista de IDs dos itens na lixeira para remoção definitiva."
                }
            },
            "required": ["trash_ids"]
        }
    },
    {
        "name": "empty_trash",
        "description": "Esvazia toda a lixeira permanentemente, liberando espaço em disco.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },

    # --- 6. SETTINGS & STORAGE ---
    {
        "name": "get_app_settings",
        "description": "Inspeciona o status das configurações da aplicação, status de conexão das chaves de API e serviços em nuvem.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },
    {
        "name": "update_app_settings",
        "description": "Atualiza chaves de API e configurações no servidor de forma persistente (GEMINI_API_KEY, HF_TOKEN, HF_DATASET_REPO).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "gemini_key": {"type": "STRING", "description": "Nova chave de API do Google Gemini."},
                "hf_token": {"type": "STRING", "description": "Novo token de acesso do Hugging Face."},
                "hf_dataset": {"type": "STRING", "description": "Repositório do dataset Hugging Face (ex: 'user/dataset-name')."}
            }
        }
    },
    {
        "name": "get_storage_analytics",
        "description": "Retorna métricas em tempo real sobre o uso de armazenamento em disco local, nuvem Hugging Face e álbuns.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },
    {
        "name": "sync_huggingface_dataset",
        "description": "Dispara sincronização imediata bidirecional com o dataset em nuvem Hugging Face.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    },

    # --- 7. CLIENT UI NAVIGATION & CONTROLS ---
    {
        "name": "navigate_app_view",
        "description": "Navega a interface do usuário para uma tela específica da aplicação (galeria de álbuns, vídeos, tarefas, lixeira, configurações ou detalhes de um álbum).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "view_name": {"type": "STRING", "description": "Nome da tela: 'gallery' (álbuns), 'videos', 'tasks' (tarefas), 'trash' (lixeira), 'settings', 'album-detail'."},
                "target_id": {"type": "STRING", "description": "ID do álbum caso a tela seja 'album-detail'."}
            },
            "required": ["view_name"]
        }
    },
    {
        "name": "apply_ui_filter",
        "description": "Aplica um filtro na interface visual do usuário (filtro por texto de busca, filtro de cor cromático ou filtro de pasta).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "filter_type": {"type": "STRING", "description": "'search_query', 'color', ou 'folder'."},
                "value": {"type": "STRING", "description": "Valor do filtro (ex: '#dc2626' para vermelho, 'ferias' para texto)."}
            },
            "required": ["filter_type", "value"]
        }
    },
    {
        "name": "preview_media",
        "description": "Abre um modal de pré-visualização instantânea de uma foto ou vídeo na interface do usuário.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "media_type": {"type": "STRING", "description": "'image' ou 'video'."},
                "url": {"type": "STRING", "description": "URL da mídia a pré-visualizar."},
                "title": {"type": "STRING", "description": "Título opcional para exibir no modal."}
            },
            "required": ["media_type", "url"]
        }
    }
]


# =====================================================================
# COPILOT MASTER AGENT ENGINE
# =====================================================================

class CopilotMasterAgent:
    """
    Master Co-Pilot Agent with full autonomous execution capabilities across
    all IMAGEX domains. Powered by multi-turn ReAct loops over Gemini Function Calling.
    """

    def __init__(self):
        self.max_steps = 8
        self.tool_declarations = COPILOT_TOOL_DECLARATIONS

    # -----------------------------------------------------------------
    # SERVICE RESOLUTION HELPERS
    # -----------------------------------------------------------------

    def _get_video_service(self):
        ctx = get_runtime_context()
        if "video_service" in ctx:
            return ctx["video_service"]
        try:
            from src.server.video_service import video_service
            return video_service
        except Exception as e:
            logger.warning(f"Could not import video_service: {e}")
            return None

    def _get_trash_service(self):
        ctx = get_runtime_context()
        if "trash_service" in ctx:
            return ctx["trash_service"]
        try:
            from src.server.trash_service import trash_service
            return trash_service
        except Exception as e:
            logger.warning(f"Could not import trash_service: {e}")
            return None

    def _get_completed_albums(self) -> Dict[str, Any]:
        ctx = get_runtime_context()
        if "completed_albums" in ctx:
            return ctx["completed_albums"]
        return {}

    def _get_active_jobs(self) -> Dict[str, Any]:
        ctx = get_runtime_context()
        if "active_jobs" in ctx:
            return ctx["active_jobs"]
        if os.path.exists(JOBS_FILE):
            try:
                with open(JOBS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    # -----------------------------------------------------------------
    # DETERMINISTIC TOOL EXECUTORS
    # -----------------------------------------------------------------

    async def execute_tool(self, name: str, args: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """
        Executes a tool by name with arguments.
        Returns: (result_data, list_of_media_items, optional_client_action)
        """
        media_items: List[Dict[str, Any]] = []
        client_action: Optional[Dict[str, Any]] = None
        result: Dict[str, Any] = {}

        try:
            # --- 1. ALBUMS ---
            if name == "list_albums":
                query = (args.get("query") or "").lower().strip()
                folder = (args.get("folder") or "").strip()
                limit = int(args.get("limit") or 20)

                # Ensure albums are loaded from disk if available
                ctx = get_runtime_context()
                if "load_albums_from_disk" in ctx:
                    try:
                        ctx["load_albums_from_disk"]()
                    except Exception:
                        pass

                albums_map = self._get_completed_albums()
                albums_list = []

                if albums_map:
                    for aid, alb in albums_map.items():
                        title = getattr(alb, "title", "") or ""
                        alb_folder = getattr(alb, "folder", None) or (alb.metadata.get("folder") if hasattr(alb, "metadata") and isinstance(alb.metadata, dict) else "Geral") or "Geral"
                        tags = getattr(alb, "tags", []) or []
                        img_count = len(getattr(alb, "images", []))
                        cover = getattr(alb, "cover_image_url", "") or ""
                        is_fav = bool(getattr(alb, "is_favorite", False) or "favorito" in [t.lower() for t in tags])

                        if query and not (query in title.lower() or any(query in str(t).lower() for t in tags)):
                            continue
                        if folder and alb_folder.lower() != folder.lower():
                            continue

                        albums_list.append({
                            "id": aid,
                            "title": title,
                            "folder": alb_folder,
                            "image_count": img_count,
                            "cover_image": cover,
                            "is_favorite": is_fav,
                            "tags": tags
                        })
                else:
                    # Fallback to direct disk inspection
                    if os.path.exists(ALBUMS_DIR):
                        for fname in os.listdir(ALBUMS_DIR):
                            if fname.endswith(".json") and not fname.startswith("summary_"):
                                try:
                                    with open(os.path.join(ALBUMS_DIR, fname), "r", encoding="utf-8") as f:
                                        data = json.load(f)
                                        aid = data.get("album_id") or fname[:-5]
                                        title = data.get("title") or ""
                                        alb_folder = data.get("folder") or data.get("metadata", {}).get("folder") or "Geral"
                                        tags = data.get("tags") or []
                                        img_count = len(data.get("images") or [])
                                        cover = data.get("cover_image_url") or ""
                                        is_fav = bool(data.get("is_favorite") or "favorito" in [t.lower() for t in tags])

                                        if query and not (query in title.lower() or any(query in str(t).lower() for t in tags)):
                                            continue
                                        if folder and alb_folder.lower() != folder.lower():
                                            continue

                                        albums_list.append({
                                            "id": aid,
                                            "title": title,
                                            "folder": alb_folder,
                                            "image_count": img_count,
                                            "cover_image": cover,
                                            "is_favorite": is_fav,
                                            "tags": tags
                                        })
                                except Exception:
                                    pass

                albums_list = albums_list[:limit]
                result = {
                    "total_found": len(albums_list),
                    "albums": albums_list
                }
                for a in albums_list:
                    if a.get("cover_image"):
                        media_items.append({
                            "type": "album",
                            "id": a["id"],
                            "title": a["title"],
                            "thumbnail_url": a["cover_image"],
                            "folder": a["folder"],
                            "item_count": a["image_count"]
                        })

            elif name == "get_album_details":
                album_id = args.get("album_id", "").strip()
                albums_map = self._get_completed_albums()
                alb_data = None

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    images = []
                    for img in getattr(alb, "images", []):
                        images.append({
                            "id": getattr(img, "id", None) or getattr(img, "candidate_id", ""),
                            "thumbnail_url": getattr(img, "thumbnail_url", ""),
                            "original_url": getattr(img, "original_url", ""),
                            "width": getattr(img, "width", None),
                            "height": getattr(img, "height", None),
                            "format": getattr(img, "format", None),
                        })
                    alb_data = {
                        "id": getattr(alb, "album_id", album_id),
                        "title": getattr(alb, "title", ""),
                        "folder": getattr(alb, "folder", "Geral"),
                        "cover_image": getattr(alb, "cover_image_url", ""),
                        "total_images": len(images),
                        "images": images[:40]
                    }
                else:
                    fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                    if os.path.exists(fpath):
                        with open(fpath, "r", encoding="utf-8") as f:
                            raw = json.load(f)
                            imgs = raw.get("images", [])
                            alb_data = {
                                "id": raw.get("album_id", album_id),
                                "title": raw.get("title", ""),
                                "folder": raw.get("folder", "Geral"),
                                "cover_image": raw.get("cover_image_url", ""),
                                "total_images": len(imgs),
                                "images": imgs[:40]
                            }

                if not alb_data:
                    result = {"error": f"Álbum com ID '{album_id}' não encontrado."}
                else:
                    result = alb_data
                    for img in alb_data.get("images", [])[:12]:
                        t_url = img.get("thumbnail_url") or img.get("original_url")
                        if t_url:
                            media_items.append({
                                "type": "image",
                                "id": img.get("id"),
                                "title": f"{alb_data['title']} (Foto)",
                                "thumbnail_url": t_url,
                                "original_url": img.get("original_url"),
                                "album_id": album_id
                            })

            elif name == "search_photos":
                query = (args.get("query") or "").lower().strip()
                color = (args.get("color") or "").lower().strip()
                limit = int(args.get("limit") or 24)

                matches = []
                albums_map = self._get_completed_albums()

                # Search through all in-memory or on-disk albums
                album_items = list(albums_map.values())
                if not album_items and os.path.exists(ALBUMS_DIR):
                    for fname in os.listdir(ALBUMS_DIR):
                        if fname.endswith(".json") and not fname.startswith("summary_"):
                            try:
                                with open(os.path.join(ALBUMS_DIR, fname), "r", encoding="utf-8") as f:
                                    raw = json.load(f)
                                    album_items.append(raw)
                            except Exception:
                                pass

                for alb in album_items:
                    alb_id = getattr(alb, "album_id", None) or (alb.get("album_id") if isinstance(alb, dict) else "")
                    alb_title = getattr(alb, "title", None) or (alb.get("title") if isinstance(alb, dict) else "")
                    imgs = getattr(alb, "images", None) or (alb.get("images") if isinstance(alb, dict) else [])

                    for img in imgs:
                        img_id = getattr(img, "id", None) or (img.get("id") if isinstance(img, dict) else "")
                        thumb = getattr(img, "thumbnail_url", None) or (img.get("thumbnail_url") if isinstance(img, dict) else "")
                        orig = getattr(img, "original_url", None) or (img.get("original_url") if isinstance(img, dict) else "")
                        pal = getattr(img, "color_palette", None) or (img.get("color_palette") if isinstance(img, dict) else [])
                        title = getattr(img, "title", None) or (img.get("title") if isinstance(img, dict) else "") or alb_title

                        matched = False
                        if query:
                            if query in str(img_id).lower() or query in str(title).lower() or query in str(orig).lower():
                                matched = True
                        if color:
                            if any(color in str(c).lower() for c in (pal or [])):
                                matched = True
                        if not query and not color:
                            matched = True

                        if matched:
                            matches.append({
                                "id": img_id,
                                "album_id": alb_id,
                                "album_title": alb_title,
                                "thumbnail_url": thumb or orig,
                                "original_url": orig or thumb,
                                "color_palette": pal
                            })
                            if len(matches) >= limit:
                                break
                    if len(matches) >= limit:
                        break

                result = {"total_found": len(matches), "photos": matches}
                for m in matches[:16]:
                    media_items.append({
                        "type": "image",
                        "id": m["id"],
                        "title": m["album_title"],
                        "thumbnail_url": m["thumbnail_url"],
                        "original_url": m["original_url"],
                        "album_id": m["album_id"]
                    })

            elif name == "create_album":
                title = args.get("title", "").strip()
                folder = args.get("folder", "Geral").strip() or "Geral"
                tags = args.get("tags") or []
                session_id = f"sess_{int(time.time() * 1000) % 10000000}_{int(time.time()) % 10000}"

                new_album_data = {
                    "album_id": session_id,
                    "title": title,
                    "original_title": title,
                    "folder": folder,
                    "tags": tags,
                    "images": [],
                    "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "metadata": {"folder": folder, "tags": tags}
                }
                fpath = os.path.join(ALBUMS_DIR, f"{session_id}.json")
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(new_album_data, f, indent=2, ensure_ascii=False)

                ctx = get_runtime_context()
                if "load_albums_from_disk" in ctx:
                    try:
                        ctx["load_albums_from_disk"]()
                    except Exception:
                        pass

                result = {
                    "success": True,
                    "album_id": session_id,
                    "title": title,
                    "folder": folder,
                    "message": f"Álbum '{title}' criado com sucesso na pasta '{folder}'."
                }
                client_action = {"type": "navigate", "view": "album-detail", "target_id": session_id}

            elif name == "delete_album":
                album_id = args.get("album_id", "").strip()
                trash = self._get_trash_service()
                albums_map = self._get_completed_albums()
                summary = {"album_id": album_id, "title": album_id}

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    summary["title"] = getattr(alb, "title", album_id)
                    summary["image_count"] = len(getattr(alb, "images", []))
                    albums_map.pop(album_id, None)

                if trash:
                    trash.move_album_to_trash(album_id, summary)
                else:
                    fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                    if os.path.exists(fpath):
                        os.remove(fpath)

                result = {
                    "success": True,
                    "album_id": album_id,
                    "message": f"Álbum '{album_id}' movido para a Lixeira com sucesso."
                }
                client_action = {"type": "navigate", "view": "gallery"}

            elif name == "rename_album":
                album_id = args.get("album_id", "").strip()
                new_title = args.get("new_title", "").strip()
                albums_map = self._get_completed_albums()

                updated = False
                if album_id in albums_map:
                    alb = albums_map[album_id]
                    alb.title = new_title
                    if hasattr(alb, "metadata") and isinstance(alb.metadata, dict):
                        alb.metadata["title"] = new_title
                    ctx = get_runtime_context()
                    if "save_album_to_disk" in ctx:
                        ctx["save_album_to_disk"](album_id, alb)
                    updated = True

                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        data["title"] = new_title
                        if "metadata" in data and isinstance(data["metadata"], dict):
                            data["metadata"]["title"] = new_title
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, indent=2, ensure_ascii=False)
                        updated = True

                result = {
                    "success": updated,
                    "album_id": album_id,
                    "new_title": new_title,
                    "message": f"Álbum renomeado para '{new_title}'."
                }

            elif name == "set_album_cover":
                album_id = args.get("album_id", "").strip()
                image_url = args.get("image_url", "").strip()
                albums_map = self._get_completed_albums()

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    alb.cover_image_url = image_url
                    ctx = get_runtime_context()
                    if "save_album_to_disk" in ctx:
                        ctx["save_album_to_disk"](album_id, alb)

                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        data["cover_image_url"] = image_url
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, indent=2, ensure_ascii=False)

                result = {
                    "success": True,
                    "album_id": album_id,
                    "cover_image_url": image_url,
                    "message": "Capa do álbum atualizada com sucesso."
                }

            elif name == "toggle_favorite_album":
                album_id = args.get("album_id", "").strip()
                albums_map = self._get_completed_albums()
                new_fav = True

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    cur = getattr(alb, "is_favorite", False)
                    new_fav = not cur
                    alb.is_favorite = new_fav
                    ctx = get_runtime_context()
                    if "save_album_to_disk" in ctx:
                        ctx["save_album_to_disk"](album_id, alb)

                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        cur = data.get("is_favorite", False)
                        new_fav = not cur
                        data["is_favorite"] = new_fav
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, indent=2, ensure_ascii=False)

                result = {
                    "success": True,
                    "album_id": album_id,
                    "is_favorite": new_fav,
                    "message": f"Álbum {'adicionado aos' if new_fav else 'removido dos'} favoritos."
                }

            elif name == "delete_album_images":
                album_id = args.get("album_id", "").strip()
                image_ids = set(args.get("image_ids") or [])
                trash = self._get_trash_service()
                albums_map = self._get_completed_albums()

                removed = 0
                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        orig_images = data.get("images", [])
                        to_trash = [img for img in orig_images if img.get("id") in image_ids or img.get("candidate_id") in image_ids]
                        kept = [img for img in orig_images if img.get("id") not in image_ids and img.get("candidate_id") not in image_ids]
                        removed = len(to_trash)
                        data["images"] = kept
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, indent=2, ensure_ascii=False)

                        if trash and to_trash:
                            trash.move_photos_to_trash(album_id, data.get("title", album_id), to_trash)

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    alb.images = [img for img in alb.images if getattr(img, "id", None) not in image_ids and getattr(img, "candidate_id", None) not in image_ids]

                result = {
                    "success": True,
                    "removed_count": removed,
                    "message": f"{removed} imagens removidas do álbum e enviadas para a lixeira."
                }

            elif name == "rename_album_image":
                album_id = args.get("album_id", "").strip()
                image_id = args.get("image_id", "").strip()
                new_title = args.get("new_title", "").strip()

                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                updated = False
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        for img in data.get("images", []):
                            if img.get("id") == image_id or img.get("candidate_id") == image_id:
                                img["title"] = new_title
                                updated = True
                                break
                        if updated:
                            f.seek(0)
                            f.truncate()
                            json.dump(data, f, indent=2, ensure_ascii=False)

                result = {
                    "success": updated,
                    "image_id": image_id,
                    "new_title": new_title,
                    "message": f"Imagem renomeada para '{new_title}'."
                }

            elif name == "move_album_to_folder":
                album_id = args.get("album_id", "").strip()
                target_folder = args.get("target_folder", "").strip() or "Geral"
                albums_map = self._get_completed_albums()

                if album_id in albums_map:
                    alb = albums_map[album_id]
                    alb.folder = target_folder
                    if hasattr(alb, "metadata") and isinstance(alb.metadata, dict):
                        alb.metadata["folder"] = target_folder
                    ctx = get_runtime_context()
                    if "save_album_to_disk" in ctx:
                        ctx["save_album_to_disk"](album_id, alb)

                fpath = os.path.join(ALBUMS_DIR, f"{album_id}.json")
                if os.path.exists(fpath):
                    with open(fpath, "r+", encoding="utf-8") as f:
                        data = json.load(f)
                        data["folder"] = target_folder
                        if "metadata" in data and isinstance(data["metadata"], dict):
                            data["metadata"]["folder"] = target_folder
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, indent=2, ensure_ascii=False)

                result = {
                    "success": True,
                    "album_id": album_id,
                    "folder": target_folder,
                    "message": f"Álbum movido para a pasta '{target_folder}'."
                }

            elif name == "download_album_zip":
                album_id = args.get("album_id", "").strip()
                result = {
                    "success": True,
                    "download_url": f"/api/albums/{album_id}/download-zip",
                    "album_id": album_id,
                    "message": f"Download do ZIP do álbum disponível em: /api/albums/{album_id}/download-zip"
                }

            elif name == "export_album_json":
                album_id = args.get("album_id", "").strip()
                result = {
                    "success": True,
                    "export_url": f"/api/albums/{album_id}/export-json",
                    "album_id": album_id,
                    "message": f"Exportação dos metadados disponível em: /api/albums/{album_id}/export-json"
                }

            # --- 2. VIDEOS ---
            elif name == "list_videos":
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos não disponível."}
                else:
                    all_vids = vs.list_all_videos()
                    folder = (args.get("folder") or "").strip()
                    query = (args.get("query") or "").lower().strip()
                    is_fav = args.get("is_favorite")
                    limit = int(args.get("limit") or 20)

                    filtered = []
                    for v in all_vids:
                        if folder and (v.get("folder") or "Geral").lower() != folder.lower():
                            continue
                        if query and query not in (v.get("title") or "").lower() and query not in (v.get("filename") or "").lower():
                            continue
                        if is_fav is not None and bool(v.get("is_favorite")) != bool(is_fav):
                            continue
                        filtered.append(v)

                    filtered = filtered[:limit]
                    result = {
                        "total_found": len(filtered),
                        "videos": filtered
                    }
                    for v in filtered:
                        media_items.append({
                            "type": "video",
                            "id": v.get("id"),
                            "title": v.get("title") or v.get("filename"),
                            "thumbnail_url": v.get("thumbnail_url"),
                            "stream_url": v.get("stream_url") or f"/api/videos/{v.get('id')}/stream",
                            "duration": v.get("duration"),
                            "folder": v.get("folder")
                        })

            elif name == "get_video_details":
                video_id = args.get("video_id", "").strip()
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    v = vs.get_video_by_id(video_id)
                    if not v:
                        result = {"error": f"Vídeo com ID '{video_id}' não encontrado."}
                    else:
                        result = v
                        media_items.append({
                            "type": "video",
                            "id": v.get("id"),
                            "title": v.get("title") or v.get("filename"),
                            "thumbnail_url": v.get("thumbnail_url"),
                            "stream_url": v.get("stream_url") or f"/api/videos/{v.get('id')}/stream",
                            "duration": v.get("duration"),
                            "folder": v.get("folder")
                        })

            elif name == "download_video_from_url":
                url = args.get("url", "").strip()
                title = args.get("title", "").strip() or "video_download"
                folder = args.get("folder", "Geral").strip() or "Geral"
                stream_only = bool(args.get("stream_only", False))

                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                elif stream_only:
                    vid_id = hashlib.md5(url.encode("utf-8")).hexdigest()[:12]
                    vs._update_single_metadata(
                        file_path=None,
                        title=title,
                        folder=folder,
                        is_favorite=False,
                        vid_id=vid_id,
                        storage_location="stream_url",
                        stream_url=url,
                        file_size_bytes=0,
                        source_origin="web",
                        source_url=url
                    )
                    v = vs.get_video_by_id(vid_id)
                    result = {"success": True, "video": v, "stream_only": True}
                    if v:
                        media_items.append({
                            "type": "video",
                            "id": vid_id,
                            "title": title,
                            "stream_url": url,
                            "folder": folder
                        })
                else:
                    target_stream_url = url
                    ctx = get_runtime_context()
                    if "resolve_best_video_stream" in ctx:
                        try:
                            resolved = await ctx["resolve_best_video_stream"]("url_agent", url)
                            if resolved:
                                target_stream_url = resolved
                        except Exception:
                            pass

                    clean_filename = "".join(c for c in title if c.isalnum() or c in ("-", "_")).strip() or f"vid_{int(time.time())}"
                    if not clean_filename.endswith(".mp4"):
                        clean_filename += ".mp4"

                    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
                        resp = await client.get(target_stream_url)
                        if resp.status_code == 200 and len(resp.content) > 1000:
                            saved_vid = vs.save_uploaded_file(clean_filename, resp.content, folder=folder, source_origin="web", source_url=url)
                            result = {"success": True, "video": saved_vid}
                            if saved_vid:
                                media_items.append({
                                    "type": "video",
                                    "id": saved_vid.get("id"),
                                    "title": saved_vid.get("title"),
                                    "thumbnail_url": saved_vid.get("thumbnail_url"),
                                    "stream_url": saved_vid.get("stream_url") or f"/api/videos/{saved_vid.get('id')}/stream",
                                    "folder": folder
                                })
                                client_action = {"type": "navigate", "view": "videos"}
                        else:
                            result = {"error": f"Falha no download (HTTP {resp.status_code})."}

            elif name == "import_local_video":
                path = args.get("path", "").strip()
                folder = args.get("folder", "Geral").strip() or "Geral"
                mode = args.get("mode", "copy")
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    imported = vs.import_local_path(path, target_folder=folder, mode=mode)
                    result = {"success": True, "imported_count": len(imported), "imported": imported}
                    client_action = {"type": "navigate", "view": "videos"}

            elif name == "delete_video":
                video_id = args.get("video_id", "").strip()
                vs = self._get_video_service()
                trash = self._get_trash_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    v = vs.get_video_by_id(video_id)
                    if not v:
                        result = {"error": f"Vídeo '{video_id}' não encontrado."}
                    else:
                        if trash:
                            trash.move_video_to_trash(v)
                        vs.delete_video(video_id)
                        result = {"success": True, "video_id": video_id, "message": "Vídeo movido para a Lixeira."}

            elif name == "batch_delete_videos":
                video_ids = args.get("video_ids") or []
                vs = self._get_video_service()
                trash = self._get_trash_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    deleted = []
                    for vid in video_ids:
                        v = vs.get_video_by_id(vid)
                        if v:
                            if trash:
                                trash.move_video_to_trash(v)
                            vs.delete_video(vid)
                            deleted.append(vid)
                    result = {"success": True, "deleted_ids": deleted, "count": len(deleted)}

            elif name == "rename_video":
                video_id = args.get("video_id", "").strip()
                new_title = args.get("new_title", "").strip()
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    ok = vs.rename_video(video_id, new_title)
                    result = {"success": ok, "video_id": video_id, "title": new_title}

            elif name == "move_video_to_folder":
                video_id = args.get("video_id", "").strip()
                target_folder = args.get("target_folder", "").strip() or "Geral"
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    res = vs.move_video(video_id, target_folder)
                    result = {"success": bool(res), "video": res}

            elif name == "batch_move_videos":
                video_ids = args.get("video_ids") or []
                target_folder = args.get("target_folder", "").strip() or "Geral"
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    moved = vs.move_multiple_videos(video_ids, target_folder)
                    result = {"success": True, "moved_count": len(moved), "target_folder": target_folder}

            elif name == "toggle_favorite_video":
                video_id = args.get("video_id", "").strip()
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    is_fav = vs.toggle_favorite(video_id)
                    result = {"success": True, "video_id": video_id, "is_favorite": is_fav}

            elif name == "sync_video_thumbnails":
                vs = self._get_video_service()
                if not vs:
                    result = {"error": "Serviço de vídeos indisponível."}
                else:
                    vs.auto_heal_all_thumbnails(background=False)
                    result = {"success": True, "message": "Sincronização e geração de miniaturas de vídeos concluída com sucesso."}

            # --- 3. FOLDERS ---
            elif name == "list_folders":
                ftype = (args.get("type") or "all").lower()
                vs = self._get_video_service()
                res_folders: Dict[str, Any] = {}

                if ftype in ("albums", "all"):
                    ctx = get_runtime_context()
                    if "get_all_album_folders_with_counts" in ctx:
                        alb_f, total = ctx["get_all_album_folders_with_counts"]()
                        res_folders["albums_folders"] = alb_f
                    else:
                        res_folders["albums_folders"] = [{"name": "Geral", "count": 0}]

                if ftype in ("videos", "all") and vs:
                    res_folders["videos_folders"] = vs.list_folders()

                result = res_folders

            elif name == "create_folder":
                fname = args.get("name", "").strip()
                ftype = (args.get("type") or "all").lower()
                vs = self._get_video_service()

                created = []
                if ftype in ("albums", "all"):
                    ctx = get_runtime_context()
                    if "load_custom_album_folders" in ctx and "save_custom_album_folders" in ctx:
                        custom = ctx["load_custom_album_folders"]()
                        if fname not in custom:
                            custom.append(fname)
                            ctx["save_custom_album_folders"](custom)
                        created.append("albums")

                if ftype in ("videos", "all") and vs:
                    if vs.create_folder(fname):
                        created.append("videos")

                result = {"success": True, "folder": fname, "created_for": created}

            elif name == "rename_folder":
                old_name = args.get("old_name", "").strip()
                new_name = args.get("new_name", "").strip()
                ftype = (args.get("type") or "all").lower()
                vs = self._get_video_service()

                renamed = []
                if ftype in ("albums", "all"):
                    ctx = get_runtime_context()
                    if "load_custom_album_folders" in ctx and "save_custom_album_folders" in ctx:
                        custom = ctx["load_custom_album_folders"]()
                        custom = [new_name if f == old_name else f for f in custom]
                        if new_name not in custom:
                            custom.append(new_name)
                        ctx["save_custom_album_folders"](custom)
                        renamed.append("albums")

                if ftype in ("videos", "all") and vs:
                    if vs.rename_folder(old_name, new_name):
                        renamed.append("videos")

                result = {"success": True, "old_name": old_name, "new_name": new_name, "renamed_for": renamed}

            elif name == "delete_folder":
                fname = args.get("name", "").strip()
                ftype = (args.get("type") or "all").lower()
                vs = self._get_video_service()

                deleted = []
                if ftype in ("albums", "all"):
                    ctx = get_runtime_context()
                    if "load_custom_album_folders" in ctx and "save_custom_album_folders" in ctx:
                        custom = ctx["load_custom_album_folders"]()
                        custom = [f for f in custom if f != fname]
                        ctx["save_custom_album_folders"](custom)
                        deleted.append("albums")

                if ftype in ("videos", "all") and vs:
                    if vs.delete_folder(fname):
                        deleted.append("videos")

                result = {"success": True, "folder": fname, "deleted_for": deleted, "items_moved_to": "Geral"}

            # --- 4. SCRAPING & JOBS ---
            elif name == "start_scraping_job":
                url = args.get("url", "").strip()
                engine_type = args.get("engine_type", "ai_react")
                media_type = args.get("media_type", "all")
                session_id = f"sess_{int(time.time() * 1000) % 10000000}_{abs(hash(url)) % 10000}"

                jobs = self._get_active_jobs()
                jobs[session_id] = {
                    "session_id": session_id,
                    "url": url,
                    "engine_type": engine_type,
                    "media_type": media_type,
                    "status": "running",
                    "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "progress": {"current": 0, "total": 0, "status": f"Iniciando extração autônoma ({engine_type})..."}
                }

                ctx = get_runtime_context()
                if "save_jobs_to_disk" in ctx:
                    try:
                        ctx["save_jobs_to_disk"]()
                    except Exception:
                        pass
                else:
                    try:
                        with open(JOBS_FILE, "w", encoding="utf-8") as f:
                            json.dump(jobs, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass

                result = {
                    "success": True,
                    "session_id": session_id,
                    "url": url,
                    "engine_type": engine_type,
                    "status": "running",
                    "message": f"Tarefa autônoma de extração '{session_id}' iniciada em segundo plano."
                }
                client_action = {"type": "navigate", "view": "tasks"}

            elif name == "scan_web_page_videos":
                url = args.get("url", "").strip()
                # Fast regex / head scan
                found_videos = []
                try:
                    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                        resp = await client.get(url)
                        if resp.status_code == 200:
                            content = resp.text
                            mp4_matches = re.findall(r'https?://[^\s"\'<>]+\.mp4(?:\?[^\s"\'<>]*)?', content)
                            for idx, murl in enumerate(list(set(mp4_matches))[:10]):
                                vid_id = f"scanned_{idx}_{abs(hash(murl)) % 10000}"
                                found_videos.append({
                                    "id": vid_id,
                                    "title": f"Vídeo detectado #{idx + 1}",
                                    "url": murl,
                                    "stream_url": murl,
                                    "thumbnail_url": ""
                                })
                except Exception as e:
                    logger.warning(f"Error scanning web videos: {e}")

                result = {"url": url, "videos_found": len(found_videos), "videos": found_videos}
                for v in found_videos[:8]:
                    media_items.append({
                        "type": "video",
                        "id": v["id"],
                        "title": v["title"],
                        "stream_url": v["stream_url"]
                    })

            elif name == "batch_save_web_videos":
                videos = args.get("videos") or []
                folder = args.get("folder", "Extraídos").strip() or "Extraídos"
                vs = self._get_video_service()
                saved_count = 0

                for v in videos:
                    v_url = v.get("stream_url") or v.get("url")
                    v_title = v.get("title") or "video_web"
                    if v_url and vs:
                        vid_id = hashlib.md5(v_url.encode("utf-8")).hexdigest()[:12]
                        vs._update_single_metadata(
                            file_path=None,
                            title=v_title,
                            folder=folder,
                            is_favorite=False,
                            vid_id=vid_id,
                            storage_location="stream_url",
                            stream_url=v_url,
                            file_size_bytes=0,
                            source_origin="web",
                            source_url=v.get("url")
                        )
                        saved_count += 1

                result = {"success": True, "saved_count": saved_count, "folder": folder}
                client_action = {"type": "navigate", "view": "videos"}

            elif name == "list_extraction_jobs":
                status = (args.get("status") or "all").lower()
                jobs = self._get_active_jobs()
                job_list = list(jobs.values())

                if status != "all":
                    job_list = [j for j in job_list if j.get("status") == status]

                result = {"total_jobs": len(job_list), "jobs": job_list}

            elif name == "control_extraction_job":
                job_id = args.get("job_id", "").strip()
                action = (args.get("action") or "").lower().strip()
                jobs = self._get_active_jobs()

                msg = ""
                if action == "clear_finished":
                    cleared = 0
                    for jid, j in list(jobs.items()):
                        if j.get("status") in ("completed", "failed", "cancelled"):
                            jobs.pop(jid, None)
                            cleared += 1
                    msg = f"{cleared} tarefas concluídas foram removidas do histórico."
                elif job_id in jobs:
                    if action == "cancel":
                        jobs[job_id]["status"] = "cancelled"
                        msg = f"Tarefa '{job_id}' cancelada."
                    elif action == "pause":
                        jobs[job_id]["status"] = "paused"
                        msg = f"Tarefa '{job_id}' pausada."
                    elif action == "resume":
                        jobs[job_id]["status"] = "running"
                        msg = f"Tarefa '{job_id}' retomada."
                    elif action == "delete":
                        jobs.pop(job_id, None)
                        msg = f"Tarefa '{job_id}' removida do registro."

                ctx = get_runtime_context()
                if "save_jobs_to_disk" in ctx:
                    try:
                        ctx["save_jobs_to_disk"]()
                    except Exception:
                        pass
                else:
                    try:
                        with open(JOBS_FILE, "w", encoding="utf-8") as f:
                            json.dump(jobs, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass

                result = {"success": True, "job_id": job_id, "action": action, "message": msg}

            # --- 5. UNIFIED TRASH BIN ---
            elif name == "list_trash":
                trash = self._get_trash_service()
                if not trash:
                    result = {"items": [], "stats": {}}
                else:
                    items = trash.list_all_items()
                    stats = trash.get_stats()
                    result = {"total_items": len(items), "items": items, "stats": stats}

            elif name == "restore_trash_items":
                trash_ids = args.get("trash_ids") or []
                trash = self._get_trash_service()
                if not trash:
                    result = {"error": "Lixeira indisponível."}
                else:
                    restored = trash.restore_multiple(trash_ids)
                    result = {"success": True, "restored_ids": restored, "count": len(restored)}

            elif name == "permanent_delete_trash_items":
                trash_ids = args.get("trash_ids") or []
                trash = self._get_trash_service()
                if not trash:
                    result = {"error": "Lixeira indisponível."}
                else:
                    deleted = trash.permanent_delete_multiple(trash_ids)
                    result = {"success": True, "deleted_ids": deleted, "count": len(deleted)}

            elif name == "empty_trash":
                trash = self._get_trash_service()
                if not trash:
                    result = {"error": "Lixeira indisponível."}
                else:
                    res = trash.empty_trash()
                    result = {"success": True, "stats": res, "message": "Lixeira esvaziada permanentemente."}

            # --- 6. SETTINGS & STORAGE ---
            elif name == "get_app_settings":
                gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
                hf_token = os.getenv("HF_TOKEN", "").strip()
                hf_dataset = os.getenv("HF_DATASET_REPO", "").strip()
                result = {
                    "gemini_api_key_configured": bool(gemini_key),
                    "gemini_api_key_masked": f"{gemini_key[:4]}...{gemini_key[-4:]}" if len(gemini_key) > 8 else ("Configurada" if gemini_key else "Não configurada"),
                    "hf_token_configured": bool(hf_token),
                    "hf_dataset_repo": hf_dataset or "Não configurado",
                }

            elif name == "update_app_settings":
                updated = []
                env_path = os.path.join(BASE_DIR, ".env")
                env_lines = []
                if os.path.exists(env_path):
                    with open(env_path, "r", encoding="utf-8") as f:
                        env_lines = f.readlines()

                def _set_env_val(key: str, val: str):
                    os.environ[key] = val
                    found = False
                    for i, line in enumerate(env_lines):
                        if line.startswith(f"{key}="):
                            env_lines[i] = f"{key}={val}\n"
                            found = True
                            break
                    if not found:
                        env_lines.append(f"{key}={val}\n")
                    updated.append(key)

                if "gemini_key" in args and args["gemini_key"]:
                    _set_env_val("GEMINI_API_KEY", args["gemini_key"].strip())
                if "hf_token" in args and args["hf_token"]:
                    _set_env_val("HF_TOKEN", args["hf_token"].strip())
                if "hf_dataset" in args and args["hf_dataset"]:
                    _set_env_val("HF_DATASET_REPO", args["hf_dataset"].strip())

                try:
                    with open(env_path, "w", encoding="utf-8") as f:
                        f.writelines(env_lines)
                except Exception as e:
                    logger.warning(f"Error persisting .env: {e}")

                result = {"success": True, "updated_keys": updated, "message": f"Configurações atualizadas: {', '.join(updated)}"}

            elif name == "get_storage_analytics":
                vs = self._get_video_service()
                albums_count = len(self._get_completed_albums())
                videos_count = len(vs.list_all_videos()) if vs else 0
                result = {
                    "total_albums": albums_count,
                    "total_videos": videos_count,
                    "storage_root": DATA_DIR
                }

            elif name == "sync_huggingface_dataset":
                vs = self._get_video_service()
                if vs and hasattr(vs, "sync_local_videos_to_cloud"):
                    vs.sync_local_videos_to_cloud()
                result = {"success": True, "message": "Sincronização em segundo plano com o Hugging Face iniciada."}

            # --- 7. CLIENT UI CONTROLS ---
            elif name == "navigate_app_view":
                vname = args.get("view_name", "").strip()
                tid = args.get("target_id", "").strip()
                client_action = {"type": "navigate", "view": vname, "target_id": tid}
                result = {"success": True, "navigated_to": vname, "target_id": tid}

            elif name == "apply_ui_filter":
                ftype = args.get("filter_type", "").strip()
                fval = args.get("value", "").strip()
                client_action = {"type": "filter", "filter_type": ftype, "value": fval}
                result = {"success": True, "filter": ftype, "value": fval}

            elif name == "preview_media":
                mtype = args.get("media_type", "image").strip()
                murl = args.get("url", "").strip()
                mtitle = args.get("title", "").strip()
                client_action = {"type": "preview", "media_type": mtype, "url": murl, "title": mtitle}
                media_items.append({
                    "type": mtype,
                    "id": f"preview_{int(time.time())}",
                    "title": mtitle,
                    "thumbnail_url": murl,
                    "preview_url": murl,
                    "stream_url": murl if mtype == "video" else None
                })
                result = {"success": True, "preview": murl}

            else:
                result = {"error": f"Ferramenta desconhecida '{name}'."}

        except Exception as exc:
            logger.error(f"Error executing copilot tool '{name}': {exc}", exc_info=True)
            result = {"error": f"Erro interno ao executar ferramenta '{name}': {str(exc)}"}

        return result, media_items, client_action

    # -----------------------------------------------------------------
    # MULTI-TURN ReAct EXECUTION OVER GEMINI REST API
    # -----------------------------------------------------------------

    async def chat(
        self,
        message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        context: Optional[Dict[str, Any]] = None,
        model_name: Optional[str] = None,
        provider: str = "gemini",
        gemini_api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Main autonomous interaction entry point. Executes a multi-turn ReAct
        loop using Gemini REST API Function Calling.
        """
        gemini_key = (gemini_api_key or os.getenv("GEMINI_API_KEY", "")).strip()
        gemini_model = model_name or "gemini-3.7-flash"
        if any(k in gemini_model.lower() for k in ["llama", "qwen", "deepseek", "mistral"]):
            gemini_model = "gemini-3.7-flash"

        executed_tools: List[Dict[str, Any]] = []
        collected_media: List[Dict[str, Any]] = []
        thought_chain: List[str] = []
        active_client_action: Optional[Dict[str, Any]] = None

        if not gemini_key:
            return {
                "reply": "A chave GEMINI_API_KEY não foi configurada. Acesse Configurações para adicionar sua chave do Google Gemini gratuitamente.",
                "provider": "gemini",
                "model": gemini_model,
                "error_type": "no_api_key",
                "can_fallback": True,
                "media_items": [],
                "executed_tools": [],
                "thought_chain": [],
                "client_action": None
            }

        # System Prompt definition
        system_instruction_text = (
            "Você é o Agente Mestre Co-Pilot IMAGEX com AUTONOMIA TOTAL sobre toda a aplicação.\n"
            "Você possui poder irrestrito para gerenciar, pesquisar, criar, renomear, mover, excluir, baixar, "
            "inspecionar tarefas, organizar álbuns, gerenciar vídeos, esvaziar lixeira e configurar o sistema.\n\n"
            "REGRAS DE CONDUTA OBRIGATÓRIAS:\n"
            "1. AUTONOMIA TOTAL: Quando o usuário pedir qualquer ação (ex: 'deleta o vídeo x', 'cria pasta fotos_viagem', "
            "'busca fotos vermelhas', 'baixa o vídeo desse link', 'esvazia a lixeira', 'troca a capa do álbum'), "
            "EXECUTE IMEDIATAMENTE usando suas ferramentas disponíveis. NUNCA apenas diga o que o usuário deve fazer.\n"
            "2. INSPEÇÃO PRÉVIA: Se você não sabe o ID ou nome exato de um item, chame primeiro ferramentas de busca ou listagem "
            "(como list_videos, list_albums, search_photos, list_folders, list_trash) para localizar o item e em seguida execute a ação.\n"
            "3. FEEDBACK VISUAL: Sempre responda em português amigável com um sumário das ações realizadas. Fotos, vídeos e álbuns manipulados "
            "serão exibidos visualmente na interface de chat para o usuário.\n"
            "4. AÇÕES DE NAVEGAÇÃO: Use a ferramenta navigate_app_view quando for útil conduzir a interface do usuário para onde a ação ocorreu.\n"
        )

        if context:
            ctx_summary = []
            if context.get("currentView"):
                ctx_summary.append(f"Tela atual do usuário: {context['currentView']}")
            if context.get("activeAlbumId"):
                ctx_summary.append(f"Álbum aberto no momento: {context['activeAlbumId']}")
            if context.get("activeFolderId"):
                ctx_summary.append(f"Pasta ativa: {context['activeFolderId']}")
            if ctx_summary:
                system_instruction_text += f"\n[CONTEXTO ATUAL DA INTERFACE DO USUÁRIO]: {', '.join(ctx_summary)}\n"

        # Format turns with strict Gemini REST API validation:
        # 1. First turn MUST be role 'user'
        # 2. Roles must strictly alternate (user -> model -> user -> model)
        raw_turns = []
        if conversation_history:
            for m in conversation_history[-6:]:
                role = "model" if m.get("role") in ("agent", "assistant") else "user"
                c = m.get("content") or m.get("text") or ""
                if c:
                    raw_turns.append((role, c))
        raw_turns.append(("user", message))

        # Drop leading 'model' turns so conversation starts with user turn
        while raw_turns and raw_turns[0][0] != "user":
            raw_turns.pop(0)

        # Merge consecutive turns of the same role
        merged_turns = []
        for role, text in raw_turns:
            if merged_turns and merged_turns[-1][0] == role:
                merged_turns[-1] = (role, merged_turns[-1][1] + "\n\n" + text)
            else:
                merged_turns.append((role, text))

        contents: List[Dict[str, Any]] = [
            {"role": r, "parts": [{"text": t}]} for r, t in merged_turns
        ]
        if not contents:
            contents = [{"role": "user", "parts": [{"text": message}]}]

        # Multi-turn ReAct Loop (Up to max_steps tool call turns)
        step_count = 0
        final_reply_text = ""

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                while step_count < self.max_steps:
                    step_count += 1
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_key}"
                    payload = {
                        "systemInstruction": {"parts": [{"text": system_instruction_text}]},
                        "contents": contents,
                        "tools": [{"functionDeclarations": self.tool_declarations}]
                    }

                    resp = await client.post(url, headers={"Content-Type": "application/json"}, json=payload)

                    if resp.status_code != 200:
                        logger.warning(f"Gemini API returned {resp.status_code}: {resp.text[:200]}")
                        err_msg = resp.text[:120]
                        final_reply_text = f"Erro na API do Google Gemini ({resp.status_code}): {err_msg}."
                        break

                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if not candidates:
                        final_reply_text = "O modelo não retornou candidatos de resposta."
                        break

                    candidate_content = candidates[0].get("content", {})
                    candidate_parts = candidate_content.get("parts", [])

                    if not candidate_parts:
                        final_reply_text = "O modelo retornou uma resposta sem conteúdo."
                        break

                    # Check for tool function call parts
                    tool_calls = [p["functionCall"] for p in candidate_parts if "functionCall" in p]
                    text_parts = [p["text"] for p in candidate_parts if "text" in p]

                    if text_parts:
                        final_reply_text = " ".join(text_parts).strip()

                    if not tool_calls:
                        # No more tool calls: final text response generated!
                        break

                    # Tool call detected: Append model turn to history
                    contents.append({
                        "role": "model",
                        "parts": candidate_parts
                    })

                    # Execute each tool call and prepare function responses
                    function_responses = []
                    for tc in tool_calls:
                        fname = tc.get("name", "")
                        fargs = tc.get("args", {})
                        call_id = tc.get("id")
                        thought_chain.append(f"Executando ferramenta: {fname}({json.dumps(fargs, ensure_ascii=False)})")

                        t_res, t_media, t_action = await self.execute_tool(fname, fargs, context)

                        executed_tools.append({
                            "name": fname,
                            "args": fargs,
                            "result": t_res,
                            "summary": f"Executou {fname} com sucesso" if "error" not in t_res else f"Falha em {fname}: {t_res.get('error')}"
                        })

                        if t_media:
                            collected_media.extend(t_media)
                        if t_action:
                            active_client_action = t_action

                        fn_part = {
                            "functionResponse": {
                                "name": fname,
                                "response": {"result": t_res}
                            }
                        }
                        if call_id:
                            fn_part["functionResponse"]["id"] = call_id
                        function_responses.append(fn_part)

                    # Append function responses with role 'user' as required by Gemini REST API
                    contents.append({
                        "role": "user",
                        "parts": function_responses
                    })

            # If loop completed without final text but executed tools, generate a friendly summary
            if not final_reply_text and executed_tools:
                tools_summary = ", ".join(t["name"] for t in executed_tools)
                final_reply_text = f"Ações autônomas concluídas com sucesso ({tools_summary})."

        except Exception as e:
            logger.error(f"Error in CopilotMasterAgent chat: {e}", exc_info=True)
            final_reply_text = f"Ocorreu um erro durante a execução autônoma: {str(e)[:150]}"

        return {
            "reply": final_reply_text,
            "provider": "gemini",
            "model": gemini_model,
            "media_items": collected_media,
            "executed_tools": executed_tools,
            "thought_chain": thought_chain,
            "client_action": active_client_action
        }


# Singleton instance
copilot_master_agent = CopilotMasterAgent()
