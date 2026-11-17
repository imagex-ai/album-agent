"""Exact source counters; never derive likes from scores or rounded displays."""
import re

# JSON is consumed by JavaScript; preserve exact integer representation.
MAX_SAFE_COUNT=(1<<53)-1


def exact_source_count(value):
    if isinstance(value,bool):return None
    if isinstance(value,int):return value if 0<=value<=MAX_SAFE_COUNT else None
    if not isinstance(value,str):return None
    value=value.strip()
    if len(value)>2*len(str(MAX_SAFE_COUNT)):return None
    if re.fullmatch(r'[0-9]+',value):number=int(value)
    elif re.fullmatch(r'[0-9]{1,3}([,.\u00a0\u202f ])[0-9]{3}(?:\1[0-9]{3})*',value):
        number=int(re.sub(r'[^0-9]','',value))
    else:return None
    return number if number<=MAX_SAFE_COUNT else None


def unique_source_count(values):
    known={number for value in values if (number:=exact_source_count(value)) is not None}
    return next(iter(known)) if len(known)==1 else None


def exact_source_score(value):
    """An exact signed vote balance, distinct from a count of positive votes."""
    if isinstance(value,bool):return None
    if isinstance(value,int):return value if abs(value)<=MAX_SAFE_COUNT else None
    if not isinstance(value,str):return None
    value=value.strip().replace('\u2212','-')
    negative=value.startswith('-')
    magnitude=exact_source_count(value[1:] if value.startswith(('-','+')) else value)
    return (-magnitude if negative else magnitude) if magnitude is not None else None


def _text_count(value):
    if isinstance(value,str):return exact_source_count(value)
    if not isinstance(value,dict):return None
    return unique_source_count([value.get('simpleText'),*(item.get('text') for item in value.get('runs',[]) if isinstance(item,dict))])


def youtube_reported_comment_total(*payloads):
    counts=[]
    def visit(node):
        if isinstance(node,dict):
            header=node.get('commentsHeaderRenderer')
            if isinstance(header,dict):counts.extend([_text_count(header.get('commentsCount')),_text_count(header.get('countText'))])
            for value in node.values():visit(value)
        elif isinstance(node,list):
            for value in node:visit(value)
    for payload in payloads:visit(payload)
    return unique_source_count(counts)


def _label_count(label):
    if not isinstance(label,str):return None
    # Reject compact/decimal pieces such as1.2K instead of fabricating1or2.
    tokens=re.findall(r'(?<![\w.,])(?:[0-9]{1,3}(?:[,\.\u00a0\u202f ][0-9]{3})+|[0-9]+)(?![\w.,])',label)
    return unique_source_count(tokens)


def youtube_page_counts(video_id,html,*,require_identity=False):
    import yt_dlp
    from yt_dlp.extractor.youtube import YoutubeIE
    with yt_dlp.YoutubeDL({'quiet':True,'no_warnings':True,'cachedir':False}) as downloader:
        extractor=YoutubeIE(downloader)
        player=extractor._search_json(extractor._YT_INITIAL_PLAYER_RESPONSE_RE,html,video_id,'initial player response',default={})
        initial=extractor.extract_yt_initial_data(video_id,html,fatal=False) or {}
    actual=player.get('videoDetails',{}).get('videoId')
    if actual is not None and actual!=video_id:raise ValueError('engagement_context_changed')
    if require_identity and actual!=video_id:raise ValueError('engagement_identity_unconfirmed')
    counts=[]
    def labels(node):
        if isinstance(node,dict):
            for key,value in node.items():
                if key in ('accessibilityText','label'):counts.append(_label_count(value))
                else:labels(value)
        elif isinstance(node,list):
            for value in node:labels(value)
    def primary(node):
        if isinstance(node,dict):
            renderer=node.get('videoPrimaryInfoRenderer')
            if isinstance(renderer,dict):
                buttons=renderer.get('videoActions',{}).get('menuRenderer',{}).get('topLevelButtons',[])
                for button in buttons:
                    model=button.get('segmentedLikeDislikeButtonViewModel',{}).get('likeButtonViewModel')
                    if model:labels(model)
                    legacy=button.get('segmentedLikeDislikeButtonRenderer',{}).get('likeButton')
                    if legacy:labels(legacy)
                    toggle=button.get('toggleButtonRenderer',{})
                    if toggle.get('defaultIcon',{}).get('iconType')=='LIKE':labels(toggle)
                return
            for value in node.values():primary(value)
        elif isinstance(node,list):
            for value in node:primary(value)
    primary(initial.get('contents',{}))
    return {'like_count':unique_source_count(counts),'comment_count':youtube_reported_comment_total(initial)}
