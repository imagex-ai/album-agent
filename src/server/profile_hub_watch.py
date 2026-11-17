"""Bounded, read-only source video details/recommendations. No app startup."""
import asyncio
from dataclasses import dataclass

import httpx
from fastapi import APIRouter,HTTPException,Query

from .profile_hub_execution import https_url,ExecutionError
from .profile_hub_comment_sources import html_comment_source
from .profile_hub_watch_sources import html_watch_data,youtube_watch_data


def _watch_source(url):
    return html_comment_source(url)

router=APIRouter()
WATCH_TIMEOUT_SECONDS=30
WATCH_REQUEST_SECONDS=8
_slots=asyncio.Semaphore(6)
# Bound queued source reads; sharing applies only while work is in flight, never
# a stale result cache. Details and related request the same watch document.
MAX_PENDING_WATCH_READS=32
PROFILE_AUDIENCE_TIMEOUT_SECONDS=4


class _EpornerAudienceProfile:
    """Restrict redirects to the uploader profile already declared by the video."""
    adapter_id='eporner-audience'

    def __init__(self, url):
        self.url=url
        self.identity=self.normalize_url(url)

    def normalize_url(self, url, *, kind='directory'):
        from .profile_hub_comment_sources import source_author_url
        from .profile_hub_watch_sources import _artist_identity_key
        safe=source_author_url({'author_url':url},self.url)
        if not safe or _artist_identity_key(safe)!=_artist_identity_key(self.url):
            raise ValueError('profile_context_changed')
        return safe.rstrip('/')+'/'


class _XhamsterAudienceProfile(_EpornerAudienceProfile):
    adapter_id='xhamster-audience'


async def _enrich_xhamster_audience(details):
    if details.get('audience_count_text') or not details.get('author_url'):
        return
    from .profile_directory_transport import fetch_source_html_shared
    from .profile_hub_watch_sources import xhamster_profile_audience
    try:
        adapter = _XhamsterAudienceProfile(details['author_url'])
        async with asyncio.timeout(PROFILE_AUDIENCE_TIMEOUT_SECONDS):
            final, html = await fetch_source_html_shared(adapter, adapter.identity)
            audience = await asyncio.to_thread(xhamster_profile_audience, html, final, adapter)
        if audience is not None:
            details['audience_count_text'] = audience
            details['audience_kind'] = 'subscribers'
    except Exception:
        # Optional profile statistics must not replace usable video details.
        pass


async def _enrich_eporner_audience(details):
    if details.get('audience_count_text') or not details.get('author_url'):
        return
    from .profile_directory_transport import fetch_source_html_shared
    from .profile_hub_watch_sources import eporner_profile_audience
    try:
        adapter=_EpornerAudienceProfile(details['author_url'])
        async with asyncio.timeout(PROFILE_AUDIENCE_TIMEOUT_SECONDS):
            final,html=await fetch_source_html_shared(adapter,adapter.identity)
            audience=await asyncio.to_thread(eporner_profile_audience,html,final,adapter)
        if audience:
            details['audience_count_text']=f'{audience} subscribers'
            details['audience_kind']='subscribers'
    except Exception:
        # Profile lookup is optional; retain the usable watch response.
        pass


@dataclass
class PendingWatchRead:
    task:asyncio.Task
    readers:int=0


_pending={}


async def _read_watch_data(url):
    # Reuse installed source recognition and pinned/bounded public transport.
    from .profile_hub_comments import youtube_identity,_read_source
    try:
        safe=https_url(url);identity=youtube_identity(safe)
        source=_watch_source(safe) if identity is None else None
    except (ValueError,ExecutionError) as exc:raise HTTPException(422,detail={'code':'invalid_watch_source'}) from exc
    if identity is None and source is None:return None
    try:
        async with asyncio.timeout(WATCH_TIMEOUT_SECONDS),_slots:
            if source is not None:
                from .profile_directory_transport import fetch_source_html_shared
                final,html=await fetch_source_html_shared(source,source.watch_fetch_url())
                data=await asyncio.to_thread(html_watch_data,source,html,final)
                if source.id=='eporner':
                    await _enrich_eporner_audience(data['details'])
                elif source.id=='xhamster':
                    await _enrich_xhamster_audience(data['details'])
                return data
            from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
            from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS
            video_id,canonical=identity
            async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(),follow_redirects=False,timeout=WATCH_REQUEST_SECONDS,
                    headers={**DEFAULT_TRANSPORT_HEADERS,'Accept-Encoding':'identity'}) as client:
                html=await _read_source(client,canonical)
            return await asyncio.to_thread(youtube_watch_data,video_id,html)
    except (TimeoutError,httpx.TimeoutException) as exc:raise HTTPException(504,detail={'code':'watch_timeout'}) from exc
    except Exception as exc:
        if getattr(exc,'status',None)==504:
            raise HTTPException(504,detail={'code':'watch_timeout'}) from exc
        raise HTTPException(502,detail={'code':'watch_source_unavailable'}) from exc


async def read_watch_data(url):
    try:safe=https_url(url)
    except (ValueError,ExecutionError) as exc:raise HTTPException(422,detail={'code':'invalid_watch_source'}) from exc
    entry=_pending.get(safe)
    if entry is None:
        if len(_pending)>=MAX_PENDING_WATCH_READS:raise HTTPException(429,detail={'code':'watch_busy'})
        entry=PendingWatchRead(asyncio.create_task(_read_watch_data(safe),name='Profile Hub public watch read'))
        _pending[safe]=entry
    entry.readers+=1
    try:return await asyncio.shield(entry.task)
    finally:
        entry.readers-=1
        if entry.readers==0:
            if _pending.get(safe) is entry:_pending.pop(safe,None)
            if not entry.task.done():
                entry.task.cancel()
                await asyncio.gather(entry.task,return_exceptions=True)


@router.get('/related')
async def get_related_videos(url:str=Query(min_length=1,max_length=4096)):
    data=await read_watch_data(url)
    if data is not None and data.get('related_supported') is False:
        return {'status':'unsupported','source_url':https_url(url),'videos':[],'complete':False}
    if data is not None and not data['related_present']:raise HTTPException(502,detail={'code':'related_not_confirmed'})
    return {'status':'unsupported' if data is None else 'ready','source_url':https_url(url),
        'videos':data['videos'] if data is not None else [],'complete':False}


@router.get('/video-details')
async def get_video_details(url:str=Query(min_length=1,max_length=4096)):
    data=await read_watch_data(url)
    fields={key:None for key in ('title','description','author_name','author_url','author_avatar_url','audience_count_text','audience_kind','reaction_kind','like_count','dislike_count','comment_count')}
    fields['artists']=[]
    return {'status':'unsupported' if data is None else 'ready','source_url':https_url(url),**(data['details'] if data is not None else fields)}


@router.get('/comments-page')
async def get_comments_page(url:str=Query(min_length=1,max_length=4096),cursor:str|None=Query(default=None,max_length=256),
        parent_id:str|None=Query(default=None,min_length=1,max_length=512)):
    from .profile_hub_comment_pages import read_comments_page
    return await read_comments_page(url,cursor,parent_id)
