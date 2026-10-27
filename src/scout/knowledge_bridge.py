"""
Knowledge Bridge between Gemini Scout Engines and Qwen / ReAct Architecture.
Synchronizes data between:
- data/recipes.json (Layout Recipes)
- data/host_rules.json (External Media Host Resolvers)
- data/image_knowledge_base.json (Full Provenance Ledger)
- data/knowledge/<encoded_domain>.b64 (SiteKnowledge for Qwen)
- data/meta_knowledge_graph.json (Archetype Graph for ReAct)
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

from ..learning.knowledge_store import KnowledgeStore, SiteKnowledge
from ..learning.meta_knowledge import MetaKnowledgeGraph, ArchetypeNode, GlobalArchetype, ResolutionRecipe
from ..core.models import ResolutionMethod

logger = logging.getLogger("scout_knowledge_bridge")

import sys

if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
    if os.path.basename(BASE_DIR).lower() == "dist":
        BASE_DIR = os.path.dirname(BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATA_DIR = os.path.join(BASE_DIR, "data")
RECIPES_FILE = os.path.join(DATA_DIR, "recipes.json")
HOST_RULES_FILE = os.path.join(DATA_DIR, "host_rules.json")
KNOWLEDGE_BASE_FILE = os.path.join(DATA_DIR, "image_knowledge_base.json")


def extract_base_domain(url: str) -> str:
    """Extracts root domain (e.g. cdn.example.com, example.com, domain.co.uk) from URL."""
    try:
        netloc = urlparse(url).netloc.lower()
        if ":" in netloc:
            netloc = netloc.split(":")[0]
        parts = netloc.split(".")
        if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "edu", "gov", "art") and len(parts[-1]) <= 3:
            return ".".join(parts[-3:])
        return ".".join(parts[-2:]) if len(parts) > 2 else netloc
    except Exception:
        return "unknown"


class ScoutKnowledgeBridge:
    """
    Central Knowledge Hub facilitating bidirectional transfer of learned
    rules from Gemini Scout to Qwen ReAct and Classic Brain.
    """

    def __init__(self, knowledge_store: Optional[KnowledgeStore] = None, meta_graph: Optional[MetaKnowledgeGraph] = None):
        self.knowledge_store = knowledge_store or KnowledgeStore(storage_dir=os.path.join(DATA_DIR, "knowledge"))
        self.meta_graph = meta_graph or MetaKnowledgeGraph(storage_path=os.path.join(DATA_DIR, "meta_knowledge_graph.json"))

    @staticmethod
    def load_recipes() -> Dict[str, Any]:
        """Loads domain layout recipes from data/recipes.json."""
        if os.path.exists(RECIPES_FILE):
            try:
                with open(RECIPES_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading recipes: {e}")
        return {}

    @staticmethod
    def save_recipe(domain: str, recipe: Dict[str, Any]):
        """Persists a domain layout recipe to data/recipes.json atomically."""
        recipes = ScoutKnowledgeBridge.load_recipes()
        recipes[domain] = recipe
        try:
            tmp = RECIPES_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(recipes, f, indent=2, ensure_ascii=False)
            os.replace(tmp, RECIPES_FILE)
            logger.info(f"Persisted recipe for domain '{domain}' to {RECIPES_FILE}")
        except Exception as e:
            logger.warning(f"Failed to save recipe for {domain}: {e}")

    @staticmethod
    def load_host_rules() -> Dict[str, Any]:
        """Loads host resolution rules from data/host_rules.json."""
        if os.path.exists(HOST_RULES_FILE):
            try:
                with open(HOST_RULES_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading host rules: {e}")
        return {}

    @staticmethod
    def save_host_rule(domain: str, rule: Dict[str, Any]):
        """Persists a host rule to data/host_rules.json atomically."""
        rules = ScoutKnowledgeBridge.load_host_rules()
        rules[domain] = rule
        try:
            tmp = HOST_RULES_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)
            os.replace(tmp, HOST_RULES_FILE)
            logger.info(f"Persisted host rule for '{domain}' to {HOST_RULES_FILE}")
        except Exception as e:
            logger.warning(f"Failed to save host rule for {domain}: {e}")

    def sync_scout_rule_to_qwen(self, domain: str, css_selector: str, target_attr: str = "src", strategy: str = "subpage_scrape"):
        """
        Takes a rule learned by Gemini Scout and registers it in both
        SiteKnowledge and MetaKnowledgeGraph so Qwen can consume it natively.
        """
        # 1. Update SiteKnowledge for domain
        try:
            site_k = self.knowledge_store.get_knowledge(domain) or SiteKnowledge(domain=domain)
            rule_sig = f"{css_selector} [{target_attr}] ({strategy})"
            if rule_sig not in site_k.positive_signatures:
                site_k.positive_signatures.append(rule_sig)
            if css_selector and css_selector not in site_k.primary_containers:
                site_k.primary_containers.append(css_selector)
            if ResolutionMethod.VERIFIED_CDN_CANDIDATE.value not in site_k.preferred_resolution_methods:
                site_k.preferred_resolution_methods.append(ResolutionMethod.VERIFIED_CDN_CANDIDATE.value)
            site_k.updated_at = datetime.now(timezone.utc).isoformat()
            self.knowledge_store.save_knowledge(site_k)
        except Exception as e:
            logger.warning(f"Error syncing rule to SiteKnowledge for {domain}: {e}")

        # 2. Update MetaKnowledgeGraph
        try:
            recipe_id = f"gemini_scout_{domain}_{abs(hash(css_selector)) % 10000}"
            res_recipe = ResolutionRecipe(
                recipe_id=recipe_id,
                strategy="SUBPAGE_SCRAPE" if strategy == "subpage_scrape" else "CDN_SUBSTITUTION",
                rule_template=f"selector:{css_selector}|attr:{target_attr}",
                success_count=5,
                confidence_score=0.98,
                example_domains=[domain]
            )
            arch_id = f"arch_scout_{domain}"
            if arch_id not in self.meta_graph.archetypes:
                self.meta_graph.archetypes[arch_id] = ArchetypeNode(
                    archetype_id=arch_id,
                    global_archetype=GlobalArchetype.FORUM_THREAD_EMBEDS,
                    platform_variant="GeminiScoutLearned",
                    dom_signatures=[css_selector],
                    recipes=[res_recipe]
                )
            else:
                self.meta_graph.archetypes[arch_id].recipes.append(res_recipe)
            self.meta_graph.save()
        except Exception as e:
            logger.warning(f"Error syncing rule to MetaKnowledgeGraph for {domain}: {e}")

    @staticmethod
    def save_knowledge_ledger(source_page: str, page_title: str, records: List[Dict[str, Any]], model_name: str = "Gemini Scout"):
        """Saves extracted records into data/image_knowledge_base.json."""
        if not records:
            return

        domain = extract_base_domain(source_page)
        db = {}
        if os.path.exists(KNOWLEDGE_BASE_FILE):
            try:
                with open(KNOWLEDGE_BASE_FILE, "r", encoding="utf-8") as f:
                    db = json.load(f)
            except Exception:
                db = {}

        if domain not in db:
            db[domain] = {
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "source_urls": [],
                "items": []
            }

        if source_page not in db[domain]["source_urls"]:
            db[domain]["source_urls"].append(source_page)

        existing_urls = {item.get("original_url") for item in db[domain]["items"]}

        for item in records:
            url = item.get("original_url")
            if url and url not in existing_urls:
                existing_urls.add(url)
                item["page_title"] = page_title
                item["indexed_by_model"] = model_name
                item["indexed_at"] = datetime.now(timezone.utc).isoformat()
                db[domain]["items"].append(item)

        db[domain]["last_updated"] = datetime.now(timezone.utc).isoformat()

        try:
            tmp = KNOWLEDGE_BASE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)
            os.replace(tmp, KNOWLEDGE_BASE_FILE)
            logger.info(f"Persisted {len(records)} records for domain '{domain}' to {KNOWLEDGE_BASE_FILE}")
        except Exception as e:
            logger.warning(f"Error saving knowledge ledger: {e}")
