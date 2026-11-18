"""Progressive public source comments. Opaque cursors are memory-only/read-only.

One source continuation page is fetched on demand. Roots and reply threads own
independent chains; no fixed total-comment cutoff or eager whole-video scan.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass,field
import json
import secrets
import threading
import time

import httpx
from fastapi import HTTPException

from .profile_hub_execution import https_url,ExecutionError
from .profile_hub_engagement import exact_source_count,youtube_reported_comment_total,_label_count

# Technical request/payload/cache budgets; reaching them is never completeness.
COMMENT_PAGE_SIZE=40
PAGE_TIMEOUT_SECONDS=30
PAGE_REQUEST_SECONDS=8
CURSOR_TTL_SECONDS=15*60
CURSOR_MEMORY_BYTES=64*1024*1024
_slots=asyncio.Semaphore(6)


@dataclass
class Context:
    url:str
    kind:str
    video_id:str=''
    config:dict=field(default_factory=dict)
    reported_total:int|None=None
    parents:dict=field(default_factory=dict)
    child_counts:dict=field(default_factory=dict)
    snapshot_complete:bool=False


@dataclass
class Cursor:
    context:Context
    parent:str|None=None
    query:dict|None=None
    items:list|None=None
    mutations:list=field(default_factory=list)
    following:dict|None=None
    response:dict|None=None
    touched:float=field(default_factory=time.monotonic)
    lock:asyncio.Lock=field(default_factory=asyncio.Lock)


class CursorStore:
    def __init__(self):self.values=OrderedDict();self.replies={};self.bytes=0;self.sizes={}
    def _size(self,cursor):
        return len(json.dumps({'query':cursor.query,'items':cursor.items,'mutations':cursor.mutations,
            'following':cursor.following,'response':cursor.response},ensure_ascii=False).encode())
    def _remove(self,key):
        self.values.pop(key,None);self.bytes-=self.sizes.pop(key,0)
        self.replies={binding:token for binding,token in self.replies.items() if token!=key}
    def prune(self):
        now=time.monotonic()
        for key,value in list(self.values.items()):
            if now-value.touched>CURSOR_TTL_SECONDS and not value.lock.locked():self._remove(key)
        while self.bytes>CURSOR_MEMORY_BYTES:
            key=next((key for key,value in self.values.items() if not value.lock.locked()),None)
            if key is None:break
            self._remove(key)
    def put(self,cursor):
        self.prune();key=secrets.token_urlsafe(24)
        self.values[key]=cursor;size=self._size(cursor);self.sizes[key]=size;self.bytes+=size
        return key
    def get(self,key,url,parent):
        self.prune();cursor=self.values.get(key)
        if cursor is None:raise HTTPException(410,detail={'code':'comments_cursor_expired'})
        if cursor.context.url!=url or cursor.parent!=parent:raise HTTPException(422,detail={'code':'comments_cursor_context_changed'})
        cursor.touched=time.monotonic();self.values.move_to_end(key);return cursor
    def update(self,key):
        cursor=self.values.get(key)
        if cursor is None:return
        size=self._size(cursor);self.bytes+=size-self.sizes[key];self.sizes[key]=size;self.prune()


_store=CursorStore()


def _walk_key(node,key):
    if isinstance(node,dict):
        if key in node:yield node[key]
        for value in node.values():yield from _walk_key(value,key)
    elif isinstance(node,list):
        for value in node:yield from _walk_key(value,key)


def _continuation_items(response):
    result=[]
    for endpoint in response.get('onResponseReceivedEndpoints',[]):
        for key in ('reloadContinuationItemsCommand','appendContinuationItemsAction'):
            command=endpoint.get(key)
            if isinstance(command,dict) and isinstance(command.get('continuationItems'),list):result.extend(command['continuationItems'])
    return result


def _entry(record,parent,reply_count=None,source_url=None):
    identity=record.get('id');text=record.get('text')
    if not isinstance(identity,str) or not identity or not isinstance(text,str):return None
    avatar=record.get('author_thumbnail')
    try:avatar=https_url(avatar) if isinstance(avatar,str) and avatar else ''
    except ValueError:avatar=''
    likes=exact_source_count(record.get('like_count'))
    from .profile_hub_comment_sources import source_author_url,source_comment_reactions
    entry={'id':identity,'parent':parent or 'root','author':record.get('author') if isinstance(record.get('author'),str) else '',
        'author_url':source_author_url(record,source_url),
        'avatar':avatar,'text':text,'time':record.get('_time_text') if isinstance(record.get('_time_text'),str) else '',
        'likes':str(likes) if likes is not None else '','reactions':source_comment_reactions(record),
        'reply_count':reply_count,'reply_context_available':False,'replies':[]}
    if record.get('hidden'):
        entry['hidden']=True
    return entry


def _parse_youtube_items(context,parent,items,mutations,ie):
    entries=[];reply_chains=[];seen=set()
    for item in items:
        if not isinstance(item,dict):continue
        thread=item.get('commentThreadRenderer')
        owner=thread if isinstance(thread,dict) else item
        model=owner.get('commentViewModel',{})
        if isinstance(model,dict) and isinstance(model.get('commentViewModel'),dict):model=model['commentViewModel']
        keys={model.get(key) for key in ('commentKey','toolbarStateKey')} if isinstance(model,dict) else set()
        keys.discard(None)
        if keys:
            entities=[mutation for mutation in mutations if mutation.get('entityKey') in keys]
            record=ie._extract_comment(entities,parent)
            raw_like=next((mutation.get('payload',{}).get('commentEntityPayload',{}).get('toolbar',{}).get('likeCountA11y')
                for mutation in entities if mutation.get('payload',{}).get('commentEntityPayload',{}).get('properties',{}).get('commentId')==(record or {}).get('id')),None)
        else:
            old=owner.get('comment',{}).get('commentRenderer') or owner.get('commentRenderer') or {}
            record=ie._extract_comment_old(old,parent)
            raw_like=ie._get_text(old,'voteCount')
        if not record:continue
        # yt-dlp accepts compact estimates such as1.2K. A displayed exact count
        # must instead be backed by the source's full literal/A11y number.
        record={**record,'like_count':_label_count(raw_like),'reaction_kind':'like_dislike'}
        replies=owner.get('replies',{}).get('commentRepliesRenderer')
        count=exact_source_count(owner.get('replyCount'))
        if count is None and isinstance(model,dict):count=exact_source_count(model.get('replyCount'))
        if count is None and not keys:count=exact_source_count(old.get('replyCount'))
        # Missing a reply renderer/count is unknown, not a proven zero.
        entry=_entry(record,parent,count,context.url)
        if not entry or entry['id'] in seen:continue
        seen.add(entry['id']);entries.append(entry)
        if isinstance(replies,dict):
            inline=replies.get('subThreads') or replies.get('contents') or []
            query=ie._extract_continuation(replies) or ie._extract_continuation({'contents':inline})
            entry['reply_context_available']=bool(inline or query)
            if inline or query:
                reply_chains.append((entry['id'],Cursor(context,parent=entry['id'],query=query,
                    items=inline if inline else None,mutations=mutations,following=query if inline else None)))
        elif count==0:reply_chains.append((entry['id'],Cursor(context,parent=entry['id'],items=[])))
    return entries,reply_chains


def _youtube_bootstrap(video_id,html):
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
        ie=YoutubeIE(downloader)
        player=ie._search_json(ie._YT_INITIAL_PLAYER_RESPONSE_RE,html,video_id,'player',default={})
        if player.get('videoDetails',{}).get('videoId')!=video_id:raise ValueError('comments_context_changed')
        config=ie.extract_ytcfg(video_id,html);initial=ie.extract_yt_initial_data(video_id,html,fatal=False) or {}
        if not config:raise ValueError('comments_bootstrap_unavailable')
        section=next((value for value in _walk_key(initial.get('contents',{}),'itemSectionRenderer')
            if isinstance(value,dict) and value.get('sectionIdentifier')=='comment-item-section'),None)
        query=ie._extract_continuation(section) if section else None
        if not query:query=ie._build_api_continuation_query(ie._generate_comment_continuation(video_id))
        return config,query


async def _youtube_rpc(context,query,stopped):
    from .profile_hub_comments import _read_source
    from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
    from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    loop=asyncio.get_running_loop()
    async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(),follow_redirects=False,timeout=PAGE_REQUEST_SECONDS,
            headers={**DEFAULT_TRANSPORT_HEADERS,'Accept-Encoding':'identity'}) as client:
        def parse():
            with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False,'extractor_retries':0}) as downloader:
                ie=YoutubeIE(downloader)
                def download_json(url,*args,**kwargs):
                    if stopped.is_set():raise RuntimeError('comments_cancelled')
                    from urllib.parse import urlencode
                    if kwargs.get('query'):url+=('&' if '?' in url else '?')+urlencode(kwargs['query'])
                    future=asyncio.run_coroutine_threadsafe(_read_source(client,url,data=kwargs.get('data'),headers=kwargs.get('headers')),loop)
                    try:return json.loads(future.result(timeout=PAGE_REQUEST_SECONDS+1))
                    except BaseException:future.cancel();raise
                ie._download_json=download_json
                return ie._extract_response(item_id=context.video_id,query=query,ytcfg=context.config,ep='next')
        return await asyncio.to_thread(parse)


async def _youtube_page(cursor):
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    context=cursor.context;stopped=threading.Event();items=cursor.items;mutations=cursor.mutations;following=cursor.following
    try:
        if items is None:
            response=await _youtube_rpc(context,cursor.query,stopped)
            header=next(_walk_key(response,'commentsHeaderRenderer'),None)
            reported=youtube_reported_comment_total(response)
            if reported is not None:context.reported_total=reported
            if isinstance(header,dict) and cursor.parent is None:
                menu=header.get('sortMenu',{}).get('sortFilterSubMenuRenderer',{}).get('subMenuItems',[])
                # Installed yt-dlp defines index1 as newest. This is source API
                # order, never a local re-sort of a truncated result set.
                if len(menu)>1:
                    with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
                        ie=YoutubeIE(downloader);sort=menu[1]
                        query=ie._extract_continuation_ep_data(sort.get('serviceEndpoint') or {}) or ie._extract_continuation(sort)
                    if query:response=await _youtube_rpc(context,query,stopped)
            items=_continuation_items(response)
            mutations=response.get('frameworkUpdates',{}).get('entityBatchUpdate',{}).get('mutations',[])
            with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
                following=YoutubeIE(downloader)._extract_continuation({'contents':items})
        if not isinstance(items,list):raise ValueError('comments_page_not_confirmed')
        chunk=items[:COMMENT_PAGE_SIZE];remaining=items[COMMENT_PAGE_SIZE:]
        with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
            entries,replies=_parse_youtube_items(context,cursor.parent,chunk,mutations,YoutubeIE(downloader))
        for identity,reply_cursor in replies:
            token=_store.put(reply_cursor);_store.replies[(context.url,identity)]=token
        next_cursor=None
        if remaining:next_cursor=_store.put(Cursor(context,parent=cursor.parent,items=remaining,mutations=mutations,following=following))
        elif following:next_cursor=_store.put(Cursor(context,parent=cursor.parent,query=following))
        if not entries and not next_cursor and cursor.items is None and context.reported_total!=0:
            # Missing renderer/disabled state cannot be reported as confirmed
            # empty. Replies also need positive API structure, not HTTP200.
            raise ValueError('comments_page_not_confirmed')
        return {'status':'ready','source_url':context.url,'entries':entries,'reported_total':context.reported_total if cursor.parent is None else None,
            'complete':next_cursor is None,'next_cursor':next_cursor}
    finally:stopped.set()


def _html_page(cursor):
    context=cursor.context;items=cursor.items or [];chunk=items[:COMMENT_PAGE_SIZE];remaining=items[COMMENT_PAGE_SIZE:]
    entries=[]
    for record in chunk:
        reply_token=_store.replies.get((context.url,record['id']))
        reply_cursor=_store.values.get(reply_token)
        available=reply_cursor is not None and reply_cursor.context is context and bool(reply_cursor.items or reply_cursor.query)
        child_count=context.child_counts.get(record['id'],0)
        entry=_entry(record,cursor.parent,child_count if context.snapshot_complete else None,context.url)
        if not entry:raise ValueError('comments_markup_unrecognized')
        entry['reply_context_available']=available
        entries.append(entry)
        if context.snapshot_complete and child_count==0:
            token=_store.put(Cursor(context,parent=entry['id'],items=[]));_store.replies[(context.url,entry['id'])]=token
    if remaining:token=_store.put(Cursor(context,parent=cursor.parent,items=remaining,following=cursor.following))
    elif cursor.following and cursor.parent is None:token=_store.put(Cursor(context,query=cursor.following))
    else:token=None
    return {'status':'ready','source_url':context.url,'entries':entries,'reported_total':context.reported_total if cursor.parent is None else None,
        'complete':context.snapshot_complete and token is None,'next_cursor':token}


def _remember_html_rows(context,records):
    """Keep identities/lineage, not the text of every old root page.

    Actual reply text is owned by the bounded cursor store. Forward root paging
    must not retain an unbounded second copy of all already delivered comments.
    """
    children={}
    for row in records:
        identity=row['id'];parent=row.get('parent') or 'root'
        previous=context.parents.get(identity)
        if previous is not None and previous!=parent:raise ValueError('comments_parent_changed')
        if previous is None:
            context.parents[identity]=parent
            if parent!='root':context.child_counts[parent]=context.child_counts.get(parent,0)+1
        if parent!='root':children.setdefault(parent,[]).append(row)
    for parent,rows in children.items():
        old=_store.values.get(_store.replies.get((context.url,parent)))
        known={row['id']:row for row in (old.items or [])} if old is not None and old.context is context else {}
        known.update({row['id']:row for row in rows})
        token=_store.put(Cursor(context,parent=parent,items=list(known.values())))
        _store.replies[(context.url,parent)]=token


def _complete_lineage(parents):
    verified={'root'}
    for identity in parents:
        trail=set();current=identity
        while current not in verified:
            if current in trail or current not in parents:return False
            trail.add(current);current=parents[current]
        verified.update(trail)
    return True


async def _html_initial(url,parent):
    from selectolax.lexbor import LexborHTMLParser
    from .profile_hub_comment_sources import html_comment_source
    from .profile_directory_transport import fetch_source_html_shared
    if parent is not None:
        token=_store.replies.get((url,parent))
        if not token:raise HTTPException(410,detail={'code':'comments_reply_context_expired'})
        return _html_page(_store.get(token,url,parent))
    source=html_comment_source(url)
    if source is None:return {'status':'unsupported','source_url':url,'entries':[],'reported_total':None,'complete':False,'next_cursor':None}
    final,html=await fetch_source_html_shared(source,source.watch_fetch_url())
    tree=LexborHTMLParser(html);source.validate_watch_document(tree)
    total=source.engagement(html)['comment_count']
    structured=getattr(source,'initial_comment_records',None)
    structured_records=structured(html,final) if structured else None
    block_count=sum(1 for b in tree.css(source.block_selector) if not source._is_template_or_clone_block(b))
    if structured:
        if structured_records is None:raise ValueError('comments_not_confirmed')
        records=structured_records
    elif not block_count:
        if total!=0:raise ValueError('comments_not_confirmed')
        records=[]
    else:
        # Removed comments remain source-provided tombstones; no removed/private
        # text is recovered. Legacy /comments keeps its previous filtering.
        records=source.parse(html,final,block_count,include_unavailable=True)
    unique={row['id']:row for row in records}
    following=source.next_comment_page(html)
    context=Context(url,'html',reported_total=total,
        config={'page_identity':following['identity']} if following else {})
    _remember_html_rows(context,list(unique.values()))
    context.snapshot_complete=following is None and total is not None and total==len(context.parents) and _complete_lineage(context.parents)
    return _html_page(Cursor(context,items=[row for row in unique.values() if row.get('parent')=='root'],following=following))


async def _html_remote_page(cursor):
    from urllib.parse import urlsplit,parse_qsl
    from .profile_hub_comment_sources import html_comment_source
    from .profile_directory_transport import fetch_source_html_shared
    context=cursor.context;target=cursor.query['url'];source=html_comment_source(context.url)
    if source is None:raise ValueError('comments_source_not_installed')
    parts=urlsplit(target)
    if source.comment_page_identity(target)!=context.config.get('page_identity'):raise ValueError('comments_page_context_changed')
    class PageOwner:
        def normalize_url(self,value,**_):
            safe=https_url(value)
            other=urlsplit(safe)
            if (other.hostname or '').removeprefix('www.')!=(parts.hostname or '').removeprefix('www.') \
                    or other.path!=parts.path or sorted(parse_qsl(other.query,keep_blank_values=True))!=sorted(parse_qsl(parts.query,keep_blank_values=True)):
                raise ValueError('comments_page_context_changed')
            return target
    _,body=await fetch_source_html_shared(PageOwner(),target)
    # This endpoint returns the source's comment fragment, not a whole watch
    # document. The wrapper supplies parser scope only; its contents are original.
    records=source.parse_comment_fragment(body)
    following=source.next_comment_page(body)
    if following and following['identity']!=context.config.get('page_identity'):
        raise ValueError('comments_page_context_changed')
    if following and following['url']==target:
        raise ValueError('comments_page_repeated')
    if not records and context.reported_total!=0 and not following:raise ValueError('comments_page_not_confirmed')
    _remember_html_rows(context,records)
    context.snapshot_complete=following is None and context.reported_total is not None and len(context.parents)==context.reported_total and _complete_lineage(context.parents)
    return _html_page(Cursor(context,items=[row for row in records if row.get('parent')=='root'],following=following))


async def read_comments_page(url,cursor_token=None,parent=None):
    from .profile_hub_comments import youtube_identity,_read_source
    try:
        safe=https_url(url);identity=youtube_identity(safe)
        if identity is None:
            from .profile_hub_comment_sources import html_comment_source
            html_comment_source(safe)
    except (ValueError,ExecutionError) as exc:raise HTTPException(422,detail={'code':'invalid_comments_source'}) from exc
    try:
        async with asyncio.timeout(PAGE_TIMEOUT_SECONDS),_slots:
            if cursor_token:
                cursor=_store.get(cursor_token,safe,parent)
            elif identity is None:return await _html_initial(safe,parent)
            elif parent is not None:
                token=_store.replies.get((safe,parent))
                if not token:raise HTTPException(410,detail={'code':'comments_reply_context_expired'})
                cursor=_store.get(token,safe,parent);cursor_token=token
            else:
                from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
                from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS
                video_id,canonical=identity
                async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(),follow_redirects=False,timeout=PAGE_REQUEST_SECONDS,
                        headers={**DEFAULT_TRANSPORT_HEADERS,'Accept-Encoding':'identity'}) as client:html=await _read_source(client,canonical)
                config,query=await asyncio.to_thread(_youtube_bootstrap,video_id,html)
                cursor=Cursor(Context(safe,'youtube',video_id,config),query=query)
                cursor_token=_store.put(cursor)
            async with cursor.lock:
                if cursor.response is None:
                    if cursor.context.kind=='html':
                        cursor.response=await _html_remote_page(cursor) if cursor.query is not None else _html_page(cursor)
                    else:cursor.response=await _youtube_page(cursor)
                    _store.update(cursor_token)
                return cursor.response
    except HTTPException:raise
    except (TimeoutError,httpx.TimeoutException) as exc:raise HTTPException(504,detail={'code':'comments_timeout'}) from exc
    except Exception as exc:raise HTTPException(502,detail={'code':'comments_source_unavailable'}) from exc
