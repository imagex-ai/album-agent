"""Pure source-owned watch details/related parsers. No services or storage.

Only the current video's declared recommendation region is read. Homepage,
category/creator suggestions, ads, playlists and arbitrary page links are not
promoted into related videos.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin,urlsplit,urlunsplit

from selectolax.lexbor import LexborHTMLParser
from .profile_hub_execution import https_url

# Technical response bound, not a source catalog limit. Continuations remain
# incomplete; this module never asserts that one HTML page is an entire catalog.
RELATED_ITEM_LIMIT=48
WATCH_ARTISTS_LIMIT=24


def _text(node):
    value=node.text(separator=' ',strip=True) if node is not None else ''
    return value or None


def _url(value,base,*,same_owner=False):
    if not isinstance(value,str) or not value.strip():return None
    try:
        safe=https_url(urljoin(base,value))
        parts=urlsplit(safe)
        if same_owner and (parts.hostname or '').removeprefix('www.')!=(urlsplit(base).hostname or '').removeprefix('www.'):return None
        return safe
    except ValueError:return None


def _clean_watch_url(source,value,base):
    safe=_url(value,base,same_owner=True)
    if not safe:return None
    identity=source.match_watch_identity(safe)
    if not identity:return None
    if source.id=='pornhub':
        # Canonical route belongs to this source adapter, not the UI.
        safe=f'https://{urlsplit(base).netloc}/view_video.php?viewkey={identity}'
    else:
        parts=urlsplit(safe);safe=urlunsplit((parts.scheme,parts.netloc,parts.path,'',''))
    return identity,safe


_PLACEHOLDER_IMAGE_TOKENS=('blank.gif','1px.','placeholder','transparent.gif')


def _image(node,base):
    if node is None:return None
    for key in ('data-thumb_url','data-src','data-mediumthumb','data-image','data-original','data-lazy-src','src'):
        raw=node.attributes.get(key)
        if not raw or raw.strip().lower().startswith('data:'):continue
        if any(token in raw.lower() for token in _PLACEHOLDER_IMAGE_TOKENS):continue
        value=_url(raw,base)
        if value:return value
    return None


def _duration(value):
    return value if isinstance(value,str) and re.fullmatch(r'(?:[0-9]+:[0-5][0-9]:[0-5][0-9]|[0-9]+:[0-5][0-9])',value) else None


def _meta(tree,selector):
    node=tree.css_first(selector)
    return (node.attributes.get('content') or '').strip() or None if node is not None else None


def eporner_profile_audience(html, final_url, adapter):
    """Read only explicit profile statistics, rejecting a different canonical page."""
    tree=LexborHTMLParser(html)
    for node in tree.css('link[rel="canonical"],meta[property="og:url"]'):
        value=node.attributes.get('href') or node.attributes.get('content')
        if not value or adapter.normalize_url(urljoin(final_url,value)) != adapter.identity:
            return None
    nodes=tree.css('.ps1, .ps3, .psbio, #pf-header, .pf-header, .pf-head, .pf-stats, .pf-tabs')
    stats=' '.join(_text(node) or '' for node in nodes)
    count=r'([0-9][0-9,.]*(?:\s*[KMB])?)'
    match=(re.search(r'\bSubscribers:\s*'+count,stats,re.I)
        or re.search(r'\bSubscribe\s*\('+count+r'\)',stats,re.I)
        or re.search(r'\b'+count+r'\s+Subscribers\b',stats,re.I))
    if match:return match.group(1).strip()
    # Channel pages expose the uploader's count in the subscription control.
    # Require a single control so unrelated profile widgets cannot supply it.
    if re.fullmatch(r'/channel/[^/]+/?',urlsplit(final_url).path,re.I):
        return eporner_channel_subscribers(tree)
    return None


def xhamster_profile_audience(html, final_url, adapter):
    """Use the same owner-statistics parser as the profile, after identity checks."""
    from .profile_hub_workers import extract_xhamster_subscribers
    if adapter.normalize_url(final_url) != adapter.identity:
        return None
    tree = LexborHTMLParser(html)
    for node in tree.css('link[rel="canonical"],meta[property="og:url"]'):
        value = node.attributes.get('href') or node.attributes.get('content')
        if not value or adapter.normalize_url(urljoin(final_url, value)) != adapter.identity:
            return None
    return extract_xhamster_subscribers(tree)


def eporner_channel_subscribers(tree):
    controls=tree.css('.subscribebutton')
    if len(controls)==1:
        value=_text(controls[0].css_first('.sbview1')) or _text(controls[0].css_first('.sbview2'))
        if value and re.fullmatch(r'[0-9][0-9., ]*(?:[KMBkmb])?',value):return value
    return None


def html_watch_data(source,html,final_url):
    tree=LexborHTMLParser(html)
    canonical=tree.css('link[rel="canonical"],meta[property="og:url"]')
    identities=[]
    for node in canonical:
        value=node.attributes.get('href') or node.attributes.get('content')
        target=_clean_watch_url(source,value,final_url)
        if target is None or target[0]!=source.identity:raise ValueError('watch_context_changed')
        identities.append(target[0])
    if not identities:raise ValueError('watch_identity_unconfirmed')
    if source.id=='xhamster':
        return _xhamster_watch_data(source,html,final_url)
    if source.id=='eporner':
        section=tree.css_first('#relateddiv');cards=section.css('div.mb') if section is not None else None
        title_selector='.mbtit a';image_selector='.mbcontent img';duration_selector='.mbtim'
        author_selector='.mb-uploader a'
    elif source.id=='pornhub':
        section=tree.css_first('#relatedVideosListing');cards=section.css('li.pcVideoListItem') if section is not None else None
        title_selector='.title a';image_selector='.phimage img';duration_selector='.duration'
        author_selector='.usernameWrap a'
    else:raise ValueError('unsupported_watch_source')
    videos=[];seen={source.identity}
    if cards is not None:
        for card in cards:
            anchor=card.css_first(title_selector)
            if anchor is None:continue
            target=_clean_watch_url(source,anchor.attributes.get('href'),final_url)
            if not target or target[0] in seen:continue
            seen.add(target[0]);author=card.css_first(author_selector)
            author_url=_url(author.attributes.get('href'),final_url,same_owner=True) if author is not None else None
            videos.append({'id':f'{source.id}:{target[0]}','source_url':target[1],
                'title':_text(anchor),'thumbnail_url':_image(card.css_first(image_selector),final_url),
                'duration':_duration(_text(card.css_first(duration_selector))),
                'author_name':_text(author) if author_url else None,'author_url':author_url})
            if len(videos)>=RELATED_ITEM_LIMIT:break
        if cards and not videos:raise ValueError('related_markup_unrecognized')
    # Descriptions remain source text. Missing source information stays unknown.
    from .profile_hub_engagement import unique_source_count
    down_selector='#likeclick .likedown i, #likeclick .likedown small' if source.id=='eporner' else '.video-actions-menu .votesDown, #video-actions-menu .votesDown'
    dislikes=unique_source_count([node.attributes.get('data-rating') if 'data-rating' in node.attributes else _text(node) for node in tree.css(down_selector)])
    creator=_html_watch_creator(source,tree,html,final_url)
    artists=_html_watch_artists(source,tree,final_url)
    details={'title':_text(tree.css_first('h1')) or _meta(tree,'meta[property="og:title"]'),
        'description':_meta(tree,'meta[property="og:description"]') or _meta(tree,'meta[name="description"]'),
        **creator,'artists':artists,'reaction_kind':'like_dislike',
        **source.engagement(html),'dislike_count':dislikes}
    return {'details':details,'videos':videos,'related_present':cards is not None}


def _xhamster_watch_data(source,html,final_url):
    """Read the current video's explicitly declared metadata, never other cards."""
    from .profile_hub_workers import _extract_xhamster_initials
    from .profile_hub_comment_sources import source_author_url
    from .profile_hub_engagement import exact_source_count
    from .profile_hub_avatar_extractors import extract_image_url
    state=_extract_xhamster_initials(html)
    video=state.get('videoModel')
    if not isinstance(video,dict):raise ValueError('watch_metadata_unconfirmed')
    author=video.get('author') if isinstance(video.get('author'),dict) else {}
    author_url=source_author_url({'author_url':author.get('pageURL')},final_url)
    name=author.get('name')
    rating=video.get('rating') if isinstance(video.get('rating'),dict) else {}
    def text_value(value):
        return value.strip() if isinstance(value,str) and value.strip() else None
    avatar_raw=author.get('thumbURL') or author.get('avatarURL')
    avatar=extract_image_url(final_url,{'src':avatar_raw}) if author_url and isinstance(avatar_raw,str) else None
    artists=[];seen_artists=set()
    cast=video.get('pornstars')
    if isinstance(cast,list):
        for item in cast:
            if not isinstance(item,dict):continue
            artist_url=source_author_url({'author_url':item.get('pageURL') or item.get('url')},final_url)
            artist_name=text_value(item.get('name'))
            if not artist_url or not artist_name or artist_url in seen_artists:continue
            seen_artists.add(artist_url)
            raw_image=item.get('thumbURL') or item.get('avatarURL')
            artists.append({'name':artist_name,'url':artist_url,
                'avatar_url':extract_image_url(final_url,{'src':raw_image}) if isinstance(raw_image,str) else None,
                'role':'performer','verified':item.get('verified') is True})
            if len(artists)>=WATCH_ARTISTS_LIMIT:break
    component=state.get('relatedVideosComponent')
    if isinstance(component,dict) and component.get('videoId') is not None and video.get('id') is not None \
            and str(component['videoId'])!=str(video['id']):raise ValueError('watch_context_changed')
    props=component.get('videoListProps') if isinstance(component,dict) else None
    if not isinstance(props,dict) and isinstance(component,dict):
        tab=component.get('videoTabInitialData')
        props=tab.get('videoListProps') if isinstance(tab,dict) else None
    cards=props.get('videoThumbProps') if isinstance(props,dict) else None
    if not isinstance(cards,list) and isinstance(component,dict):cards=component.get('videoThumbProps')
    videos=[];seen={source.identity}
    if isinstance(cards,list):
        for card in cards:
            if not isinstance(card,dict):continue
            target=_clean_watch_url(source,card.get('pageURL') or card.get('url'),final_url)
            if not target or target[0] in seen:continue
            seen.add(target[0]);creator=card.get('author') if isinstance(card.get('author'),dict) else {}
            creator_url=source_author_url({'author_url':creator.get('pageURL')},final_url)
            duration=exact_source_count(card.get('duration'))
            if duration is not None:
                duration=(f'{duration//3600}:{duration//60%60:02d}:{duration%60:02d}' if duration>=3600 else f'{duration//60}:{duration%60:02d}')
            image=card.get('thumbURL') or card.get('imageURL')
            videos.append({'id':f'{source.id}:{target[0]}','source_url':target[1],
                'title':text_value(card.get('title')),'thumbnail_url':_url(image,final_url),
                'duration':duration,'author_name':text_value(creator.get('name')) if creator_url else None,
                'author_url':creator_url})
            if len(videos)>=RELATED_ITEM_LIMIT:break
        if cards and not videos:cards=None
    return {'details':{'title':text_value(video.get('title')),
        'description':text_value(video.get('description')),
        'author_name':text_value(name) if author_url else None,'author_url':author_url,
        'author_avatar_url':avatar,'audience_count_text':None,'audience_kind':None,
        'artists':artists,'reaction_kind':'like_dislike',
        'like_count':exact_source_count(rating.get('likes')),
        'dislike_count':exact_source_count(rating.get('dislikes')),
        'comment_count':exact_source_count(video.get('comments'))},
        'videos':videos,'related_present':isinstance(cards,list),
        'related_supported':isinstance(cards,list)}


def _html_watch_creator(source,tree,html,final_url):
    """Extract confirmed primary uploader metadata without touching related cards or comments."""
    import json
    from .profile_hub_comment_sources import source_author_url

    author_name=None
    author_url=None
    author_avatar=None
    audience_count=None
    audience_kind=None

    from .profile_hub_avatar_extractors import extract_image_url

    if source.id=='eporner':
        container=tree.css_first('#video-info, #video-info-tags, #cinemainfo')
        if container is not None:
            owner=container.css_first('.vit-uploader a[href], #hd-porn-d-uploader a[href], .vit-channel a[href]')
            if owner is not None:
                candidate=_url(owner.attributes.get('href'),final_url,same_owner=True)
                author_url=source_author_url({'author_url':candidate},final_url) if candidate else None
                if author_url:
                    author_name=_text(owner) or None
                    avatar_node=container.css_first('.vit-uploader img, #hd-porn-d-uploader img, .vit-channel img')
                    author_avatar=(extract_image_url(final_url,avatar_node.attributes) if avatar_node is not None else None) or _image(avatar_node,final_url)
                    if not author_avatar:
                        owner_key=_artist_identity_key(author_url)
                        for box in tree.css('#commentdivleft .commbox'):
                            comment_author=box.css_first('.commboxtime a[href]')
                            if comment_author is None:continue
                            c_url=source_author_url({'author_url':_url(comment_author.attributes.get('href'),final_url,same_owner=True)},final_url)
                            if c_url and _artist_identity_key(c_url)==owner_key:
                                c_avatar_node=box.css_first('.commboxprofile img')
                                author_avatar=(extract_image_url(final_url,c_avatar_node.attributes) if c_avatar_node is not None else None) or _image(c_avatar_node,final_url)
                                if author_avatar:break
            sub=container.css_first('.vit-subscribe .subscribebutton')
            if sub is not None:
                raw_sub=_text(sub.css_first('.sbview2')) or _text(sub.css_first('.sbview1'))
                if raw_sub and re.fullmatch(r'[0-9][0-9., ]*(?:[KMBkmb])?',raw_sub):
                    audience_count=f'{raw_sub} subscribers'
                    audience_kind='subscribers'
    elif source.id=='pornhub':
        container=tree.css_first('.video-detailed-info .userRow, .video-detailed-info .userInfoBlock, .video-detailed-info .userInfo, .video-detailed-info')
        if container is not None:
            owner=next((node for selector in (
                '.userInfo .usernameBadgesWrapper a[href]',
                '.userInfo .usernameWrap a[href]',
                '.userInfoBlock a.bolded[href]',
                '.userInfo a[href]',
                '.userAvatar a[href]',
            ) if (node:=container.css_first(selector)) is not None),None)
            if owner is not None:
                candidate=_url(owner.attributes.get('href'),final_url,same_owner=True)
                author_url=source_author_url({'author_url':candidate},final_url) if candidate else None
                if author_url:
                    name_node=container.css_first('.userInfo .usernameBadgesWrapper a, .userInfo .usernameWrap a, .userInfoBlock a.bolded, .userInfo a[data-label]') or owner
                    author_name=_text(name_node) or None
                    avatar_node=container.css_first('.userAvatar img, .userInfo img.avatar, .userInfo img, img#getAvatar')
                    author_avatar=(extract_image_url(final_url,avatar_node.attributes) if avatar_node is not None else None) or _image(avatar_node,final_url)
            for span in container.css('.userInfo span'):
                txt=_text(span)
                if not txt:continue
                match=re.fullmatch(r'([0-9][0-9.,]*(?:\s*[KMBkmb])?\s+(?:subscribers?|followers?))',txt,re.I)
                if match:
                    audience_count=match[1]
                    audience_kind='followers' if 'follower' in audience_count.lower() else 'subscribers'
                    break
        if not author_url and isinstance(html,str):
            mp_match=re.search(r'var\s+MODEL_PROFILE\s*=\s*(\{.*?\});',html)
            if mp_match:
                try:mp=json.loads(mp_match[1])
                except Exception:mp=None
                if isinstance(mp,dict) and mp.get('viewkey')==source.identity:
                    candidate=_url(mp.get('modelProfileLink'),final_url,same_owner=True)
                    author_url=source_author_url({'author_url':candidate},final_url) if candidate else None
                    if author_url:
                        uname=mp.get('username')
                        author_name=uname.strip() if isinstance(uname,str) and uname.strip() else None
                        if not author_avatar:
                            mp_img=mp.get('avatar') or mp.get('thumbUrl') or mp.get('thumbURL')
                            if isinstance(mp_img,str) and mp_img.strip():
                                author_avatar=extract_image_url(final_url,{'src':mp_img})
                            if not author_avatar:
                                av_node=tree.css_first('.video-detailed-info img[class*=avatar], .userInfo img, .userAvatar img, img#getAvatar')
                                author_avatar=(extract_image_url(final_url,av_node.attributes) if av_node is not None else None) or _image(av_node,final_url)

    if not audience_count:
        audience_count=None
        audience_kind=None

    return {'author_name':author_name,'author_url':author_url,
        'author_avatar_url':author_avatar,'audience_count_text':audience_count,'audience_kind':audience_kind}


def _artist_identity_key(url):
    parts=urlsplit(url)
    return ((parts.hostname or '').removeprefix('www.').lower(),parts.path.rstrip('/').casefold())


def _html_watch_artists(source,tree,final_url):
    """Extract source-declared featured performers/artists scoped to the video's cast block."""
    from .profile_hub_comment_sources import source_author_url

    if source.id=='pornhub':
        nodes=tree.css('.video-detailed-info .pornstarsWrapper a[href]')
    elif source.id=='eporner':
        nodes=tree.css('#video-info #video-info-tags li.vit-pornstar a[href], #video-info li.starw a[href]')
    else:
        return []

    artists=[];seen=set()
    for node in nodes:
        candidate=_url(node.attributes.get('href'),final_url,same_owner=True)
        artist_url=source_author_url({'author_url':candidate},final_url) if candidate else None
        if not artist_url:continue
        path=urlsplit(artist_url).path.lower()
        if source.id=='eporner' and not path.startswith('/pornstar/'):continue
        key=_artist_identity_key(artist_url)
        if key in seen:continue
        name=' '.join((_text(node) or '').split())
        if not name:continue
        seen.add(key)
        from .profile_hub_avatar_extractors import extract_image_url
        img_node=node.css_first('img')
        avatar=(extract_image_url(final_url,img_node.attributes) if img_node is not None else None) or _image(img_node,final_url)
        verified=node.css_first('.verifiedIcon, .verified-icon, svg[class*="verified"]') is not None
        if '/pornstar/' in path:role='performer'
        elif '/channels/' in path or '/channel/' in path:role='channel'
        else:role='creator'
        artists.append({
            'name':name,
            'url':artist_url,
            'avatar_url':avatar,
            'role':role,
            'verified':verified,
        })
        if len(artists)>=WATCH_ARTISTS_LIMIT:break
    return artists


def _json_text(value):
    if not isinstance(value,dict):return None
    if isinstance(value.get('content'),str):return value['content'] or None
    if isinstance(value.get('simpleText'),str):return value['simpleText'] or None
    runs=value.get('runs')
    if isinstance(runs,list):return ''.join(item.get('text','') for item in runs if isinstance(item,dict) and isinstance(item.get('text',''),str)) or None
    return None


def _json_path(value,*keys):
    for key in keys:
        if not isinstance(value,dict):return None
        value=value.get(key)
    return value


def _youtube_url(video_id):
    from yt_dlp.extractor.youtube import YoutubeIE
    if not isinstance(video_id,str):return None
    candidate='https://www.youtube.com/watch?v='+video_id
    return candidate if YoutubeIE.suitable(candidate) and YoutubeIE._match_id(candidate)==video_id else None


def _youtube_record(renderer,modern):
    if modern:
        command=renderer.get('rendererContext',{}).get('commandContext',{}).get('onTap',{}).get('innertubeCommand',{})
        video_id=command.get('watchEndpoint',{}).get('videoId')
        if renderer.get('contentId')!=video_id:return None
        meta=renderer.get('metadata',{}).get('lockupMetadataViewModel',{})
        title=_json_text(meta.get('title'))
        thumbnail_model=renderer.get('contentImage',{}).get('thumbnailViewModel',{})
        thumbnails=thumbnail_model.get('image',{}).get('sources',[])
        author_name=None;author_url=None;duration=None
        for overlay in thumbnail_model.get('overlays',[]):
            for badge in overlay.get('thumbnailBottomOverlayViewModel',{}).get('badges',[]):
                candidate=_duration(badge.get('thumbnailBadgeViewModel',{}).get('text'))
                if candidate:duration=candidate;break
        avatar=meta.get('image',{}).get('decoratedAvatarViewModel',{})
        browse=avatar.get('rendererContext',{}).get('commandContext',{}).get('onTap',{}).get('innertubeCommand',{}).get('browseEndpoint',{})
        if browse.get('canonicalBaseUrl'):author_url=_url(browse['canonicalBaseUrl'],'https://www.youtube.com',same_owner=True)
        elif isinstance(browse.get('browseId'),str) and re.fullmatch(r'UC[A-Za-z0-9_-]+',browse['browseId']):
            author_url='https://www.youtube.com/channel/'+browse['browseId']
        # In this source view model the channel credit is the first metadata
        # row. Require its typed channel navigation, rather than interpreting
        # an accessibility sentence or mistaking views/date for a creator.
        rows=meta.get('metadata',{}).get('contentMetadataViewModel',{}).get('metadataRows',[])
        if author_url and rows:
            parts=rows[0].get('metadataParts',[])
            if parts:author_name=_json_text(parts[0].get('text'))
    else:
        video_id=renderer.get('videoId');title=_json_text(renderer.get('title'))
        thumbnails=renderer.get('thumbnail',{}).get('thumbnails',[])
        duration=_duration(_json_text(renderer.get('lengthText')))
        author=renderer.get('shortBylineText') or renderer.get('longBylineText') or {}
        author_name=_json_text(author);author_url=None
        for run in author.get('runs',[]):
            browse=run.get('navigationEndpoint',{}).get('browseEndpoint',{})
            if browse.get('canonicalBaseUrl'):author_url=_url(browse['canonicalBaseUrl'],'https://www.youtube.com',same_owner=True);break
    url=_youtube_url(video_id)
    if not url:return None
    thumbnail=None
    for image in thumbnails:
        if isinstance(image,dict) and (safe:=_url(image.get('url'),url)):thumbnail=safe
    return {'id':'youtube:'+video_id,'source_url':url,'title':title,'thumbnail_url':thumbnail,
        'duration':duration,'author_name':author_name,'author_url':author_url}


def youtube_watch_data(video_id,html):
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    from .profile_hub_engagement import youtube_page_counts
    with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
        ie=YoutubeIE(downloader)
        initial=ie.extract_yt_initial_data(video_id,html,fatal=False) or {}
        player=ie._search_json(ie._YT_INITIAL_PLAYER_RESPONSE_RE,html,video_id,'initial player response',default={})
    detail=player.get('videoDetails',{})
    if detail.get('videoId')!=video_id:raise ValueError('watch_context_changed')
    section=initial.get('contents',{}).get('twoColumnWatchNextResults',{}).get('secondaryResults',{}).get('secondaryResults')
    videos=[];seen={video_id}
    def items(values):
        if not isinstance(values,list):return
        for entry in values:
            if not isinstance(entry,dict):continue
            if isinstance(entry.get('itemSectionRenderer'),dict):
                yield from items(entry['itemSectionRenderer'].get('contents'))
            elif isinstance(entry.get('compactVideoRenderer'),dict):yield entry['compactVideoRenderer'],False
            elif isinstance(entry.get('lockupViewModel'),dict):yield entry['lockupViewModel'],True
            # Deliberately no recursion into ads, menus, playlists or shelves.
    for renderer,modern in items(section.get('results') if isinstance(section,dict) else None):
        record=_youtube_record(renderer,modern)
        if not record:continue
        identity=record['id'].split(':',1)[1]
        if identity in seen:continue
        seen.add(identity);videos.append(record)
        if len(videos)>=RELATED_ITEM_LIMIT:break
    counts=youtube_page_counts(video_id,html,require_identity=True)
    channel_id=detail.get('channelId')
    from .profile_hub_comment_sources import source_author_url
    author_url=source_author_url({'author_id':channel_id},'https://www.youtube.com')
    author_avatar=None;audience_text=None
    # Read only the current video's primary owner, never recommendation owners.
    primary=_json_path(initial,'contents','twoColumnWatchNextResults','results','results','contents')
    for item in primary if isinstance(primary,list) else []:
        owner=_json_path(item,'videoSecondaryInfoRenderer','owner','videoOwnerRenderer')
        if not isinstance(owner,dict):continue
        runs=_json_path(owner,'title','runs')
        navigation=[owner.get('navigationEndpoint'),*(_json_path(run,'navigationEndpoint') for run in runs if isinstance(run,dict))] if isinstance(runs,list) else [owner.get('navigationEndpoint')]
        identities={identity for endpoint in navigation if isinstance(identity:=_json_path(endpoint,'browseEndpoint','browseId'),str)}
        if channel_id:
            if not author_url:continue
            if identities and channel_id not in identities:continue
        else:
            if not identities and _json_text(owner.get('title'))!=detail.get('author'):continue
        # Keep the source's compact display label; it is not an exact integer.
        audience_text=_json_text(owner.get('subscriberCountText'))
        thumbnails=_json_path(owner,'thumbnail','thumbnails')
        for thumbnail in thumbnails if isinstance(thumbnails,list) else []:
            if isinstance(thumbnail,dict) and (safe:=_url(thumbnail.get('url'),'https://www.youtube.com')):author_avatar=safe
        declared=source_author_url({'author_id':channel_id,'author_url':next((value for endpoint in navigation if isinstance(value:=_json_path(endpoint,'browseEndpoint','canonicalBaseUrl'),str) and value),None)},'https://www.youtube.com')
        if declared:author_url=declared
        break
    return {'details':{'title':detail.get('title') if isinstance(detail.get('title'),str) else None,
        'description':detail.get('shortDescription') if isinstance(detail.get('shortDescription'),str) else None,
        'author_name':detail.get('author') if isinstance(detail.get('author'),str) else None,'author_url':author_url,
        'author_avatar_url':author_avatar,'audience_count_text':audience_text,'audience_kind':'subscribers' if audience_text else None,
        'artists':[],
        'reaction_kind':'like_dislike','like_count':counts['like_count'],'comment_count':counts['comment_count'],'dislike_count':None},
        'videos':videos,'related_present':isinstance(section,dict)}
