"""Read-only source comments, isolated from library and application startup.

YouTube's installed yt-dlp parser owns continuation and reply interpretation;
HTML adapters own Eporner/Pornhub video-page parsing. Network requests use the
existing public/DNS-pinned transport; no media extraction, disk cache, browser
cookies or comment publication occurs.
"""
from __future__ import annotations

import asyncio
import json
import threading
from urllib.parse import urlencode, urljoin, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query

from .profile_directory_transport import (
    DEFAULT_TRANSPORT_HEADERS,
    DirectoryFetchError,
    MAX_REDIRECTS,
    _read_bounded_listing,
    clear_source_html_cache,
    fetch_source_html_shared,
)
from .profile_hub_execution import ExecutionError, https_url
from .profile_hub_execution_source import YouTubeExecutionSource
from .profile_hub_comment_sources import html_comment_source
from .profile_hub_engagement import youtube_page_counts,youtube_reported_comment_total,exact_source_count

router=APIRouter(prefix='/api/profile-hub',tags=['Profile Hub comments'])
# Technical response/work bounds, explicitly returned as partial when reached.
COMMENT_READ_LIMIT=40
COMMENT_RPC_LIMIT=12
COMMENT_TIMEOUT_SECONDS=30
COMMENT_REQUEST_SECONDS=8
_slots=asyncio.Semaphore(6)


def youtube_identity(url: str) -> tuple[str,str] | None:
    safe=https_url(url)
    parts=urlsplit(safe)
    source=YouTubeExecutionSource()
    if parts.hostname not in source.hosts:return None
    source.validate_item({'kind':'video','url':safe})
    from yt_dlp.extractor.youtube import YoutubeIE
    if not YoutubeIE.suitable(safe):raise ValueError('invalid_comments_source')
    video_id=YoutubeIE._match_id(safe)
    return video_id,'https://www.youtube.com/watch?'+urlencode({'v':video_id})


def _public_youtube_url(url: str):
    safe=https_url(url)
    if urlsplit(safe).hostname not in YouTubeExecutionSource.hosts:
        raise ValueError('comments_destination_changed')
    return safe


async def _read_source(client,url,*,data=None,headers=None):
    current=_public_youtube_url(url)
    method='POST' if data is not None else 'GET'
    async with asyncio.timeout(COMMENT_REQUEST_SECONDS):
        for _ in range(MAX_REDIRECTS+1):
            async with client.stream(method,current,content=data,headers=headers) as response:
                if response.status_code in (301,302,303,307,308):
                    location=response.headers.get('location')
                    if not location:raise ValueError('comments_invalid_redirect')
                    current=_public_youtube_url(urljoin(current,location))
                    # Never replay a source API body onto another endpoint.
                    if method=='POST':raise ValueError('comments_api_redirect')
                    continue
                if response.status_code!=200:raise ValueError('comments_source_unavailable')
                expected='application/json' if data is not None else 'text/html'
                if expected not in response.headers.get('content-type','').lower():
                    raise ValueError('comments_invalid_content_type')
                return await _read_bounded_listing(response)
        raise ValueError('comments_redirect_limit')


def _group_comments(records,source_url=None):
    """Attach replies by source IDs only. Never guess parents or invent totals."""
    from .profile_hub_comment_sources import source_author_url,source_comment_reactions
    comments={};parents={};roots=[]
    for item in records:
        if not isinstance(item,dict):continue
        identity=item.get('id')
        text=item.get('text')
        if not isinstance(identity,str) or not identity or identity in comments or not isinstance(text,str):continue
        likes=exact_source_count(item.get('like_count'))
        likes=str(likes) if likes is not None else ''
        avatar=item.get('author_thumbnail')
        try:avatar=https_url(avatar) if isinstance(avatar,str) and avatar else ''
        except ValueError:avatar=''
        entry={'id':identity,'author':item.get('author') if isinstance(item.get('author'),str) else '',
            'author_url':source_author_url(item,source_url),
            'avatar':avatar,'text':text,'time':item.get('_time_text') if isinstance(item.get('_time_text'),str) else '',
            'likes':likes,'reactions':source_comment_reactions(item),'replies':[]}
        if item.get('hidden'):
            entry['hidden']=True
        comments[identity]=entry
        parents[identity]=item.get('parent') or 'root'
    for identity,comment in comments.items():
        parent=parents[identity]
        if parent=='root':roots.append(comment);continue
        # Detect broken/cyclic parent chains before assembling recursive output.
        seen={identity};ancestor=parent
        while ancestor in comments and ancestor not in seen:
            seen.add(ancestor);ancestor=parents[ancestor]
        if ancestor!='root':continue
        comments[parent]['replies'].append(comment)
    return roots


def _youtube_records(video_id,html,rpc,stopped,record_limit=None,engagement_only=False):
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    # No extract_info(): only the comments parser, never video/download workers.
    limit=COMMENT_READ_LIMIT if record_limit is None else record_limit
    page_counts=youtube_page_counts(video_id,html,require_identity=engagement_only)
    options={'quiet':True,'no_warnings':True,'cachedir':False,'skip_download':True,'getcomments':True,
        'proxy':'','extractor_retries':0,'extractor_args':{'youtube':{'max_comments':[str(limit+1)]}}}
    with yt_dlp.YoutubeDL(options) as downloader:
        extractor=YoutubeIE(downloader)
        config=extractor.extract_ytcfg(video_id,html)
        initial=extractor.extract_yt_initial_data(video_id,html,fatal=False)
        if not config or not initial:raise ValueError('comments_bootstrap_unavailable')
        responses=[];calls=0
        def download_json(url,*args,**kwargs):
            nonlocal calls
            if stopped.is_set():raise RuntimeError('comments_cancelled')
            calls+=1
            if calls>COMMENT_RPC_LIMIT:raise ValueError('comments_request_limit')
            query=kwargs.get('query')
            if query:
                url+=('&' if '?' in url else '?')+urlencode(query)
            response=rpc(url,kwargs.get('data'),kwargs.get('headers'))
            responses.append(response)
            return response
        extractor._download_json=download_json
        records=[]
        try:
            for item in extractor._get_comments(config,video_id,initial,html):
                # This legacy iterator has discarded the literal vote label and
                # may promote compact estimates. The paged reader keeps it;
                # this path must preserve uncertainty instead of claiming exactness.
                records.append({**item,'like_count':None,'reaction_kind':'like_dislike'})
                if engagement_only:break
                if len(records)>limit:break
        except extractor.CommentsDisabled:
            if not records:return {'status':'disabled','comments':[],'reported_total':None,'complete':False,'like_count':page_counts['like_count']}
        except Exception:
            # A later reply/continuation failure must preserve comments already
            # read from the source. Before any useful record it remains an error.
            if stopped.is_set():raise
            if not records and not engagement_only:raise
        if engagement_only:
            reported=youtube_reported_comment_total(initial,*responses)
            if page_counts['like_count'] is None and reported is None:raise ValueError('engagement_not_confirmed')
            return {'status':'metrics','comments':[],'reported_total':reported,'complete':False,'like_count':page_counts['like_count']}
        if not responses:raise ValueError('comments_not_confirmed')
        if not records:
            # An empty parser result is ambiguous unless the source explicitly
            # declares zero; missing/changed renderer must not mean no comments.
            if youtube_reported_comment_total(*responses)!=0:raise ValueError('comments_not_confirmed')
        # The iterator may stop on upstream continuation limits or incomplete
        # reply threads. Without a source completeness contract, positive reads
        # remain partial even when the technical item bound was not reached.
        complete=not records
        grouped=_group_comments(records[:limit],'https://www.youtube.com/watch?'+urlencode({'v':video_id}))
        if records and not grouped:raise ValueError('comments_invalid_parentage')
        reported=youtube_reported_comment_total(initial,*responses)
        if records and reported==0:reported=None
        return {'status':'ready','comments':grouped,'reported_total':0 if not records else reported,'complete':complete,'like_count':page_counts['like_count']}


async def read_comments(url,*,engagement_only=False):
    try:
        identity=youtube_identity(url)
        html_source=html_comment_source(url) if identity is None else None
    except (ValueError,ExecutionError) as exc:raise HTTPException(422,detail={'code':'invalid_comments_source'}) from exc
    if identity is None and html_source is None:return {'status':'unsupported','source_url':url,'comments':[],'reported_total':None,'complete':False}
    if html_source is not None:
        try:
            async with asyncio.timeout(COMMENT_TIMEOUT_SECONDS),_slots:
                final,html=await fetch_source_html_shared(html_source,url)
                counts=await asyncio.to_thread(html_source.engagement,html)
                if engagement_only:
                    if all(value is None for value in counts.values()):raise ValueError('engagement_not_confirmed')
                    return {'status':'metrics','source_url':final,'comments':[],'reported_total':counts['comment_count'],'like_count':counts['like_count'],'complete':False}
                structured=getattr(html_source,'initial_comment_records',None)
                if structured:
                    from selectolax.lexbor import LexborHTMLParser
                    html_source.validate_watch_document(LexborHTMLParser(html))
                    records=structured(html,final)
                    if records is None:raise ValueError('comments_not_confirmed')
                    if not records and counts['comment_count']==0:
                        return {'status':'ready','source_url':final,'comments':[],'reported_total':0,'like_count':counts['like_count'],'complete':True}
                    comments=_group_comments(records[:COMMENT_READ_LIMIT],final)
                    if not comments:raise ValueError('comments_invalid_parentage')
                    return {'status':'ready','source_url':final,'comments':comments,'reported_total':counts['comment_count'],'like_count':counts['like_count'],'complete':False}
                if counts['comment_count']==0:
                    # A confirmed zero is different from a missing section.
                    from selectolax.lexbor import LexborHTMLParser
                    if not any(
                        not html_source._is_template_or_clone_block(b)
                        for b in LexborHTMLParser(html).css(html_source.block_selector)
                    ):
                        return {'status':'ready','source_url':final,'comments':[],'reported_total':0,'like_count':counts['like_count'],'complete':True}
                records=await asyncio.to_thread(html_source.parse,html,final,COMMENT_READ_LIMIT)
                comments=_group_comments(records,final)
                if not comments:raise ValueError('comments_invalid_parentage')
                return {'status':'ready','source_url':final,'comments':comments,'reported_total':counts['comment_count'] if counts['comment_count']!=0 else None,'like_count':counts['like_count'],'complete':False}
        except (TimeoutError,httpx.TimeoutException) as exc:raise HTTPException(504,detail={'code':'comments_timeout'}) from exc
        except Exception as exc:raise HTTPException(502,detail={'code':'comments_source_unavailable'}) from exc
    video_id,canonical=identity
    from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
    stopped=threading.Event()
    try:
        async with asyncio.timeout(COMMENT_TIMEOUT_SECONDS),_slots:
            async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(),follow_redirects=False,
                    timeout=COMMENT_REQUEST_SECONDS,headers={**DEFAULT_TRANSPORT_HEADERS,'Accept-Encoding':'identity'}) as client:
                html=await _read_source(client,canonical)
                loop=asyncio.get_running_loop()
                def rpc(target,data,headers):
                    if stopped.is_set():raise RuntimeError('comments_cancelled')
                    future=asyncio.run_coroutine_threadsafe(_read_source(client,target,data=data,headers=headers),loop)
                    try:return json.loads(future.result(timeout=COMMENT_REQUEST_SECONDS+1))
                    except BaseException:
                        future.cancel();raise
                args=(video_id,html,rpc,stopped,1,True) if engagement_only else (video_id,html,rpc,stopped)
                result=await asyncio.to_thread(_youtube_records,*args)
                return {**result,'source_url':canonical}
    except (TimeoutError,httpx.TimeoutException) as exc:raise HTTPException(504,detail={'code':'comments_timeout'}) from exc
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,detail={'code':'comments_source_unavailable'}) from exc
    finally:stopped.set()


@router.get('/comments')
async def get_source_comments(url: str=Query(min_length=1,max_length=4096)):
    return await read_comments(url)


@router.get('/engagement')
async def get_source_engagement(url: str=Query(min_length=1,max_length=4096)):
    result=await read_comments(url,engagement_only=True)
    return {'status':'unsupported' if result['status']=='unsupported' else 'ready','source_url':https_url(url),
        'like_count':result.get('like_count'),'comment_count':result.get('reported_total')}


# Keep the already installed Profile Hub source-read router as the application
# entry point; the watch module itself never imports application startup.
from .profile_hub_watch import router as watch_router
from .profile_hub_avatar_service import router as avatar_router
router.include_router(watch_router)
router.include_router(avatar_router)
