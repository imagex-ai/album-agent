"""Source adapters for complete, bounded collection expansion after confirmation."""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit
from selectolax.lexbor import LexborHTMLParser

from .profile_directory_manifest import recognize_profile_input
from .profile_directory_transport import fetch_directory_html
from .profile_hub_collection_parser import parse_album_page, parse_playlist_page
from .profile_hub_execution import ExecutionError, https_url
from .profile_hub_workers import is_youtube_channel_url


class EpornerExecutionSource:
    id = 'eporner'
    hosts = {'eporner.com', 'www.eporner.com'}

    def collection_identity(self, url):
        path = urlsplit(url).path
        account = re.fullmatch(r'/profile/([^/?#]+)/playlist/([A-Za-z0-9]+)(?:/[^/?#]+)*/?', path)
        if account:
            return ('playlist', account[1], account[2])
        plain = re.fullmatch(r'/(playlist|gallery|photo)/([A-Za-z0-9]+)(?:/[^/?#]+)*/?', path)
        if not plain:
            raise ExecutionError('unsupported_media_route')
        return (plain[1], '', plain[2])

    def validate_profile(self, url):
        try:
            adapter, kind = recognize_profile_input(url)
            if adapter.adapter_id != self.id or kind != 'profile':
                raise ValueError()
        except ValueError as exc:
            raise ExecutionError('unsupported_execution_source') from exc

    def validate_item(self, item):
        parts = urlsplit(https_url(item['url']))
        if item['kind'] in ('photo', 'gif'):
            return
        if parts.hostname not in self.hosts or parts.query:
            raise ExecutionError('unsupported_media_route')
        if item['kind'] == 'video':
            valid = re.fullmatch(r'/(?:hd-porn/[A-Za-z0-9]+|video-[A-Za-z0-9]+)(?:/[^/?#]+)*/?', parts.path)
        else:
            identity = self.collection_identity(item['url'])
            valid = identity[0] == 'playlist' if item['kind'] == 'playlist' else identity[0] in ('gallery', 'photo')
        if not valid:
            raise ExecutionError('unsupported_media_route')

    async def pages(self, kind, source_url):
        """Follow discovered same-collection links; never infer page counts/URLs."""
        self.validate_item({'kind': kind, 'url': source_url})
        source = self
        identity = self.collection_identity(source_url)

        class Context:
            def normalize_url(self, value):
                parts = urlsplit(https_url(value))
                if parts.hostname not in source.hosts or source.collection_identity(value) != identity:
                    raise ValueError('collection_context_changed')
                pairs = parse_qsl(parts.query, keep_blank_values=True)
                if any(key != 'page' or not re.fullmatch('[1-9][0-9]{0,4}', val) for key, val in pairs) or len(pairs) > 1:
                    raise ValueError('unsupported_collection_query')
                return urlunsplit(('https', 'www.eporner.com', parts.path.rstrip('/') + '/', parts.query, ''))

        context = Context()
        pending = [context.normalize_url(source_url)]
        seen = set()
        pages = []
        reported = None
        while pending:
            if len(seen) >= 100:
                raise ExecutionError('collection_page_limit')
            url = pending.pop(0)
            if url in seen:
                continue
            seen.add(url)
            try:
                final, html = await fetch_directory_html(context, url)
            except Exception as exc:
                raise ExecutionError('collection_page_unavailable') from exc
            tree = LexborHTMLParser(html)
            parsed = parse_playlist_page(tree, final) if kind == 'playlist' else parse_album_page(tree, final)
            records = parsed['videos' if kind == 'playlist' else 'photos']
            if not records:
                raise ExecutionError('empty_or_unrecognized_collection')
            count = parsed.get('reportedCount')
            if count is not None:
                if reported is not None and reported != count:
                    raise ExecutionError('collection_changed_during_resolution')
                reported = count
            pages.append({'url': final, 'records': records})
            if sum(len(page['records']) for page in pages) > 20000:
                raise ExecutionError('collection_item_limit')
            for anchor in tree.css('.numlist2 a[href], .numlist a[href], a[rel="next"][href]'):
                try:
                    target = context.normalize_url(urljoin(final, anchor.attributes.get('href') or ''))
                except ValueError:
                    rel_tokens = (anchor.attributes.get('rel') or '').lower().split()
                    if 'next' in rel_tokens:
                        raise ExecutionError('collection_pagination_changed_context')
                    continue
                if target not in seen and target not in pending:
                    pending.append(target)
        urls = {record['originalUrl'] for page in pages for record in page['records']}
        if reported is not None and len(urls) != reported:
            raise ExecutionError('collection_incomplete', details={
                'reported_count': reported, 'found_count': len(urls), 'page_count': len(pages)})
        return pages


class YouTubeExecutionSource:
    id = 'youtube'
    hosts = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'}

    def collection_identity(self, url):
        parts = urlsplit(https_url(url))
        if parts.hostname not in self.hosts:
            raise ExecutionError('unsupported_media_route')
        if parts.path == '/playlist':
            q = dict(parse_qsl(parts.query))
            list_id = q.get('list', '')
            if not list_id or not re.fullmatch(r'[A-Za-z0-9_-]+', list_id):
                raise ExecutionError('unsupported_media_route')
            return ('playlist', '', list_id)
        post_match = re.fullmatch(r'/post/([A-Za-z0-9_-]+)/?', parts.path)
        if post_match:
            return ('post', '', post_match.group(1))
        raise ExecutionError('unsupported_media_route')

    def validate_profile(self, url):
        try:
            u = https_url(url)
        except Exception as exc:
            raise ExecutionError('unsupported_execution_source') from exc
        if not is_youtube_channel_url(u):
            raise ExecutionError('unsupported_execution_source')

    def validate_item(self, item):
        parts = urlsplit(https_url(item['url']))
        if item['kind'] in ('photo', 'gif'):
            return
        if parts.hostname not in self.hosts:
            raise ExecutionError('unsupported_media_route')
        if item['kind'] == 'video':
            if parts.hostname == 'youtu.be':
                valid = bool(re.fullmatch(r'/[A-Za-z0-9_-]{8,15}/?', parts.path))
            elif parts.path == '/watch':
                q = dict(parse_qsl(parts.query))
                valid = bool(q.get('v') and re.fullmatch(r'[A-Za-z0-9_-]{8,15}', q['v']))
            else:
                valid = bool(re.fullmatch(r'/shorts/[A-Za-z0-9_-]{8,15}/?', parts.path))
        elif item['kind'] == 'playlist':
            identity = self.collection_identity(item['url'])
            valid = identity[0] == 'playlist'
        else:
            identity = self.collection_identity(item['url'])
            valid = identity[0] == 'post'
        if not valid:
            raise ExecutionError('unsupported_media_route')

    async def pages(self, kind, source_url):
        self.validate_item({'kind': kind, 'url': source_url})
        source = self
        identity = self.collection_identity(source_url)

        class Context:
            def normalize_url(self, value):
                parts = urlsplit(https_url(value))
                if parts.hostname not in source.hosts or source.collection_identity(value) != identity:
                    raise ValueError('collection_context_changed')
                if identity[0] == 'playlist':
                    return f"https://www.youtube.com/playlist?list={identity[2]}"
                return f"https://www.youtube.com/post/{identity[2]}"

        context = Context()
        norm_url = context.normalize_url(source_url)
        try:
            final, html = await fetch_directory_html(context, norm_url)
        except Exception as exc:
            raise ExecutionError('collection_page_unavailable') from exc
        parsed = parse_playlist_page(html, final) if kind == 'playlist' else parse_album_page(html, final)
        records = parsed['videos' if kind == 'playlist' else 'photos']
        if not records:
            raise ExecutionError('empty_or_unrecognized_collection')
        return [{'url': final, 'records': records}]


class ExecutionSources:
    """Installing another adapter does not change the frontend/execution contract."""
    def __init__(self, adapters=None):
        self.adapters = adapters or [EpornerExecutionSource(), YouTubeExecutionSource()]

    def for_profile(self, url):
        for adapter in self.adapters:
            try:
                adapter.validate_profile(url)
                return adapter
            except ExecutionError:
                continue
        raise ExecutionError('unsupported_execution_source')
