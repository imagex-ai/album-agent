"""Source-backed raw metadata; presentation and localization belong to the UI.

Uses native Selectolax/Lexbor extraction while preserving compatibility with
BeautifulSoup objects passed by unit tests.
"""
from bs4 import BeautifulSoup
from selectolax.lexbor import LexborHTMLParser

from .profile_hub_workers import (
    extract_collection_metadata_lexbor,
    extract_video_metadata_lexbor,
)


def _as_lexbor_input(soup_or_html):
    if isinstance(soup_or_html, (str, LexborHTMLParser)):
        return soup_or_html
    if isinstance(soup_or_html, BeautifulSoup):
        return str(soup_or_html)
    return str(soup_or_html)


def extract_video_metadata(soup_or_html):
    return extract_video_metadata_lexbor(_as_lexbor_input(soup_or_html))


def extract_collection_metadata(soup_or_html, source_url, kind="playlist"):
    return extract_collection_metadata_lexbor(_as_lexbor_input(soup_or_html), source_url, kind)
