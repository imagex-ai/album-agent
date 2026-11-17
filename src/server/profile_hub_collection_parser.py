"""Existing Profile Hub collection parsing, shared by previews and execution.

Uses native Selectolax/Lexbor extraction.
"""
from .profile_hub_workers import (
    parse_album_page_lexbor,
    parse_playlist_page_lexbor,
)


def parse_album_page(html: str, final_url: str):
    return parse_album_page_lexbor(html, final_url)


def parse_playlist_page(html: str, final_url: str):
    return parse_playlist_page_lexbor(html, final_url)
