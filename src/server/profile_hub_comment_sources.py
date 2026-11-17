"""HTML comment adapters. URL recognition belongs to installed source extractors.

Parses only the source's comment section, never recommended/top-other-video text.
Replies require an actual nested comment block; adjacency/usernames are not links.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin,urlsplit,urlunsplit,parse_qsl,urlencode

from selectolax.lexbor import LexborHTMLParser
from yt_dlp.extractor.eporner import EpornerIE
from yt_dlp.extractor.pornhub import PornHubIE
from yt_dlp.extractor.xhamster import XHamsterIE

from .profile_hub_execution import https_url
from .profile_hub_engagement import unique_source_count,exact_source_count,exact_source_score


COMMENT_REACTION_KINDS=('like_dislike','like','heart','score')


def source_comment_reactions(record):
    """Source-declared semantics; unknown counters never become zeros."""
    kind=record.get('reaction_kind')
    if kind not in COMMENT_REACTION_KINDS:kind='like' if record.get('like_count') is not None else None
    hearted=record.get('is_favorited')
    return {'kind':kind,
        'like_count':exact_source_count(record.get('like_count')) if kind in ('like','like_dislike') else None,
        'dislike_count':exact_source_count(record.get('dislike_count')) if kind=='like_dislike' else None,
        'heart_count':exact_source_count(record.get('heart_count')) if kind=='heart' else None,
        'vote_score':exact_source_score(record.get('vote_score')) if kind=='score' else None,
        'creator_hearted':hearted if isinstance(hearted,bool) else None}


def source_author_url(record,source_url):
    """Accept source-declared profile routes via extensible provider registry."""
    from .profile_hub_providers import normalize_source_author_url
    return normalize_source_author_url(record,source_url)


_INDENT_PX_RE=re.compile(r'(?:^|[;\s])(?:margin-left|padding-left)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*px',re.I)


def _extract_clean_node_text(node,*,exclude_classes=()):
    if node is None:return ''
    parts=[]
    for child in node.iter(include_text=True):
        if child.tag=='-text':
            raw=child.text(strip=True)
            if raw:parts.append(raw)
        else:
            classes=set((child.attributes.get('class') or '').split())
            if child.tag=='button' or (exclude_classes and classes.intersection(exclude_classes)):
                continue
            raw=_extract_clean_node_text(child,exclude_classes=exclude_classes)
            if raw:parts.append(raw)
    return ' '.join(parts).strip()


class HTMLCommentsSource:
    block_class: str
    block_selector: str
    time_selectors: tuple = ()

    @classmethod
    def match_watch_identity(cls,safe):
        if not cls.extractor.suitable(safe):return None
        match=cls.extractor._match_valid_url(safe)
        if match is None:return None
        # Extractor regexes intentionally accept URL prefixes. A partial ID (e.g.
        # uppercase suffix outside a source alphabet) is not the same video.
        tail=safe[match.end('id'):]
        if tail and tail[0] not in '/?&#':return None
        return cls.extractor._match_id(safe)

    def watch_fetch_url(self):return self.source_url

    def next_comment_page(self,html):return None

    def comment_page_identity(self,url):raise ValueError('unsupported_comment_page')

    def parse_comment_fragment(self,html):
        tree=LexborHTMLParser(html)
        count=len(tree.css(self.block_selector))
        return self.parse(html,self.source_url,count,include_unavailable=True) if count else []

    def normalize_url(self,url,*,kind='directory'):
        safe=https_url(url)
        if self.match_watch_identity(safe)!=self.identity:
            raise ValueError('comments_context_changed')
        owner=(urlsplit(self.source_url).hostname or '').removeprefix('www.')
        target_owner=(urlsplit(safe).hostname or '').removeprefix('www.')
        if owner!=target_owner:raise ValueError('comments_context_changed')
        # The shared transport compares normalized identities on redirects.
        # Display slugs and video-route aliases may change without changing the
        # source item. Keep the caller's valid source link as the canonical key.
        return self.source_url

    def validate_watch_document(self,tree):
        canonicals=tree.css('link[rel="canonical"],meta[property="og:url"]')
        if not canonicals:raise ValueError('comments_identity_unconfirmed')
        for node in canonicals:
            value=node.attributes.get('href') or node.attributes.get('content')
            self.normalize_url(https_url(urljoin(self.source_url,value or '')))

    def own(self,block,selector):
        return next(self.owned(block,selector),None)

    def owned(self,block,selector):
        for node in block.css(selector):
            ancestor=node.parent
            while ancestor is not None and ancestor!=block:
                if self.block_class in (ancestor.attributes.get('class') or '').split():break
                ancestor=ancestor.parent
            if ancestor==block:yield node
        return None

    def _children_of_identity(self,raw):
        return f'{self.id}:{raw}'

    def parent_identity(self,block):
        for token in (block.attributes.get('class') or '').split():
            match=re.fullmatch(r'childrenOf([A-Za-z0-9_-]+)',token)
            if match:return self._children_of_identity(match[1])
        ancestor=block.parent
        while ancestor is not None:
            classes=(ancestor.attributes.get('class') or '').split()
            if self.block_class in classes:
                return self.block_identity(ancestor)
            for token in classes:
                match=re.fullmatch(r'childrenOf([A-Za-z0-9_-]+)',token)
                if match:return self._children_of_identity(match[1])
            ancestor=ancestor.parent
        return 'root'

    @staticmethod
    def _is_template_or_clone_block(block):
        node=block
        while node is not None:
            if (node.attributes.get('id') or '')=='commentClone':return True
            if 'display-none' in (node.attributes.get('class') or '').split():return True
            node=node.parent
        return False

    @staticmethod
    def _block_indent_px(block):
        style=block.attributes.get('style') or ''
        match=_INDENT_PX_RE.search(style)
        if not match:return 0
        try:return max(0,int(float(match.group(1))))
        except ValueError:return 0

    def _extract_message_payload(self,message):
        hidden_node=message.css_first('.comment-hidden-text')
        hidden_text=self.text(hidden_node) if hidden_node is not None else ''
        if hidden_text:
            return hidden_text,True
        cleaned=_extract_clean_node_text(
            message,
            exclude_classes=('actionButtonsBlock','comment-hidden-label'),
        )
        return cleaned,False

    def _extract_time_text(self,block,author_text):
        selectors=self.time_selectors or ((self.time_selector,) if getattr(self,'time_selector',None) else ())
        author_norm=(author_text or '').strip().lower()
        for sel in selectors:
            for node in self.owned(block,sel):
                candidate=self.text(node)
                if not candidate:continue
                # Guard against creator-link spans sitting inside .commboxtime
                if node.css_first('a') is not None and candidate.strip().lower()==author_norm:
                    continue
                return candidate
        return ''

    def _extract_author_node(self,block):
        selectors=getattr(self,'author_selectors',None) or (self.author_selector,)
        for sel in selectors:
            node=self.own(block,sel)
            if node is not None:return node
        return None

    @staticmethod
    def text(node):return node.text(separator=' ',strip=True) if node is not None else ''

    @staticmethod
    def avatar(node,url):
        if node is None:return ''
        attrs=node if isinstance(node,dict) else getattr(node,'attributes',None)
        if not attrs:return ''
        from .profile_hub_avatar_extractors import extract_image_url
        return extract_image_url(url,attrs) or ''

    def engagement(self,html):
        tree=LexborHTMLParser(html)
        likes=[]
        for node in tree.css(self.likes_selector):
            likes.append(node.attributes.get('data-rating') if 'data-rating' in node.attributes else self.text(node))
        comments=[self.text(node).strip('() ') for node in tree.css(self.comment_count_selector)]
        return {'like_count':unique_source_count(likes),'comment_count':unique_source_count(comments)}

    def parse(self,html,url,limit,*,include_unavailable=False):
        tree=LexborHTMLParser(html)
        records=[]
        indent_stack=[]
        for block in tree.css(self.block_selector):
            if self._is_template_or_clone_block(block):continue
            identity=self.block_identity(block)
            message=self.own(block,self.message_selector)
            if not identity or message is None:continue
            if not include_unavailable and 'moderated' in (message.attributes.get('class') or '').split():continue
            structural_parent=self.parent_identity(block)
            if structural_parent is None:continue
            indent=self._block_indent_px(block)
            if structural_parent=='root':
                while indent_stack and indent_stack[-1][0]>=indent:
                    indent_stack.pop()
                parent=indent_stack[-1][1] if indent>0 and indent_stack else 'root'
            else:
                parent=structural_parent
            # Read reaction counters before extracting message text so nested
            # .actionButtonsBlock vote nodes are preserved cleanly.
            likes=unique_source_count(self.text(node) for node in self.owned(block,self.vote_selector)) if self.vote_selector else None
            dislikes=unique_source_count(self.text(node) for node in self.owned(block,self.dislike_selector)) if self.dislike_selector else None
            scores={value for node in self.owned(block,self.score_selector) if (value:=exact_source_score(self.text(node))) is not None} if self.score_selector else set()
            text,is_hidden=self._extract_message_payload(message)
            if not text:continue
            if structural_parent=='root':
                indent_stack.append((indent,identity))
            author=self._extract_author_node(block)
            author_text=self.text(author)
            row={'id':identity,'parent':parent,'text':text,
                'author':author_text,
                'author_url':source_author_url({'author_url':author.attributes.get('href') if author is not None else None},url),
                'author_thumbnail':self.avatar(self.own(block,self.avatar_selector),url),
                '_time_text':self._extract_time_text(block,author_text),'like_count':likes,
                'reaction_kind':self.reaction_kind,'dislike_count':dislikes,
                'vote_score':next(iter(scores)) if len(scores)==1 else None}
            if is_hidden:row['hidden']=True
            records.append(row)
            if len(records)>=limit:break
        if not records:raise ValueError('comments_not_confirmed')
        # HTML may contain only a first page; unseen reply loaders/pagination
        # never imply a complete list or a known remote count.
        return records


class EpornerCommentsSource(HTMLCommentsSource):
    id='eporner'
    extractor=EpornerIE
    block_class='commbox'
    block_selector='#commentdivleft .commbox'
    message_selector='p[id^="ct"]'
    author_selector='.commboxtime a'
    avatar_selector='.commboxprofile img'
    time_selector='.commboxtime small, .commboxtime span'
    time_selectors=('.commboxtime small','.commboxtime > time','.commboxtime span')
    # Eporner's displayed vote is a net score, not a count of likes.
    vote_selector=None
    reaction_kind='score'
    score_selector='.commboxvote'
    dislike_selector=None
    likes_selector='#likeclick .likeup i, #likeclick .likeup small'
    comment_count_selector='#uvmnew .uvmspn1 small'

    def engagement(self,html):
        counts=super().engagement(html)
        if counts['comment_count'] is not None:return counts
        tree=LexborHTMLParser(html)
        if tree.css(self.comment_count_selector):return counts
        tab=tree.css_first('#uvmnew .uvmspn1')
        comments_area=tree.css_first('#commentdivleft')
        if tab is not None and comments_area is not None \
                and re.fullmatch(r'comments',self.text(tab),re.I) \
                and comments_area.css_first('.commentstitle, #commentform') is not None \
                and not tree.css(self.block_selector):
            counts['comment_count']=0
        return counts

    def _children_of_identity(self,raw):
        key=raw if raw.startswith('c') else f'c{raw}'
        return f'{self.id}:{key}'

    def block_identity(self,block):
        identity=block.attributes.get('id','')
        return f'{self.id}:{identity}' if re.fullmatch(r'c[0-9]+',identity) else None


class PornhubCommentsSource(HTMLCommentsSource):
    id='pornhub'
    extractor=PornHubIE
    _SHORTIES_PATH=re.compile(r'/shorties/([0-9a-z]+)/?\Z')
    block_class='commentBlock'

    @classmethod
    def match_watch_identity(cls,safe):
        identity=super().match_watch_identity(safe)
        if identity is not None:return identity
        parts=urlsplit(safe)
        host=(parts.hostname or '').lower()
        if not re.search(r'(?:^|\.)pornhub(?:premium)?\.(?:com|net|org)$',host):return None
        match=cls._SHORTIES_PATH.fullmatch(parts.path)
        return match[1] if match else None

    def watch_fetch_url(self):
        parts=urlsplit(self.source_url)
        if self._SHORTIES_PATH.fullmatch(parts.path):
            return f'https://{parts.netloc}/view_video.php?viewkey={self.identity}'
        return self.source_url
    block_selector='#cmtContent .commentBlock'
    message_selector='.commentMessage'
    author_selector='.usernameWrap .usernameLink'
    author_selectors=('.usernameWrap .usernameLink','.usernameWrap a')
    avatar_selector='img.commentAvatarImg'
    time_selector='.date'
    # Current source renders the number beside the voting anchor; older markup
    # nested it. Match only the own comment's typed positive/negative badges.
    vote_selector='.thumbsUp .voteTotal, .voteTotal[class*="thumbsUpVote"]'
    dislike_selector='.thumbsDown .voteTotal, .voteTotal[class*="thumbsDownVote"]'
    score_selector=None
    reaction_kind='like_dislike'
    likes_selector='.video-actions-menu .votesUp, #video-actions-menu .votesUp'
    comment_count_selector='#cmtWrapper .cmtHeader h2 span'
    _PH_COUNT_RE=re.compile(r'\(\s*([0-9][0-9,\s]*)\s*\)')

    def engagement(self,html):
        tree=LexborHTMLParser(html)
        likes=[]
        for node in tree.css(self.likes_selector):
            likes.append(node.attributes.get('data-rating') if 'data-rating' in node.attributes else self.text(node))
        count_nodes=tree.css(self.comment_count_selector) or tree.css('#cmtWrapper .cmtHeader h2')
        comments=[]
        for node in count_nodes:
            raw=self.text(node)
            match=self._PH_COUNT_RE.search(raw)
            if match:
                comments.append(match.group(1).replace(' ',''))
            else:
                cleaned=raw.strip('() ')
                if cleaned:comments.append(cleaned)
        counts={'like_count':unique_source_count(likes),'comment_count':unique_source_count(comments)}
        if counts['comment_count'] is not None:return counts
        cmt_wrapper=tree.css_first('#cmtWrapper')
        cmt_content=tree.css_first('#cmtContent')
        if cmt_wrapper is not None and cmt_content is not None and not [
            b for b in tree.css(self.block_selector) if not self._is_template_or_clone_block(b)
        ]:
            header=self.text(tree.css_first('#cmtWrapper .cmtHeader'))
            if re.search(r'\(\s*0\s*\)',header):
                counts['comment_count']=0
        return counts

    def block_identity(self,block):
        for token in block.attributes.get('class','').split():
            match=re.fullmatch(r'commentTag([A-Za-z0-9_-]+)',token)
            if match:return f'{self.id}:{match[1]}'
        return None

    def next_comment_page(self,html):
        # The source's public loader declares its current page and read URL.
        # A live probe confirmed current1 -> querypage2 -> no loader at EOF;
        # requesting page1 merely repeats the initial page (not continuation).
        tree=LexborHTMLParser(html)
        node=tree.css_first('.showMoreCommentsBtn[data-ajax-url][data-page-num]')
        if node is None:return None
        number=node.attributes['data-page-num']
        if not re.fullmatch(r'[1-9][0-9]{0,8}',number):raise ValueError('comments_invalid_page')
        target=https_url(urljoin(self.source_url,node.attributes['data-ajax-url']))
        parts=urlsplit(target)
        identity=self.comment_page_identity(target)
        pairs=parse_qsl(parts.query,keep_blank_values=True)
        pairs=[(key,value) for key,value in pairs if key!='page']+[('page',str(int(number)+1))]
        return {'url':urlunsplit((parts.scheme,parts.netloc,parts.path,urlencode(pairs),'')),'identity':identity}

    def comment_page_identity(self,url):
        parts=urlsplit(https_url(url));owner=urlsplit(self.source_url)
        pairs=parse_qsl(parts.query,keep_blank_values=True);values=dict(pairs)
        if (parts.hostname or '').removeprefix('www.')!=(owner.hostname or '').removeprefix('www.') or parts.path!='/comment/show' \
                or len(values)!=len(pairs) or not re.fullmatch('[0-9]+',values.get('id','')) or values.get('what')!='video':
            raise ValueError('comments_page_context_changed')
        return (values['id'],values['what'],values.get('popular'))

    def parse_comment_fragment(self,html):
        tree=LexborHTMLParser(html)
        scoped=html if tree.css_first('#cmtContent') else '<div id="cmtContent">'+html+'</div>'
        count=len(tree.css('.commentBlock'))
        return self.parse(scoped,self.source_url,count,include_unavailable=True) if count else []


class XHamsterCommentsSource(HTMLCommentsSource):
    """Source-owned video comments embedded in the page state."""
    id='xhamster'
    extractor=XHamsterIE
    block_selector='[data-comment-id]'
    block_class='comment'

    @classmethod
    def match_watch_identity(cls,url):
        match=cls.extractor._match_valid_url(url)
        if match is None:return None
        group='id' if match.group('id') is not None else 'id_2'
        tail=url[match.end(group):]
        return match.group(group) if not tail or tail[0] in '/?&#' else None

    def engagement(self,html):
        from .profile_hub_workers import _extract_xhamster_initials
        video=_extract_xhamster_initials(html).get('videoModel')
        video=video if isinstance(video,dict) else {}
        rating=video.get('rating') if isinstance(video.get('rating'),dict) else {}
        return {'like_count':exact_source_count(rating.get('likes')),
                'comment_count':exact_source_count(video.get('comments'))}

    def comment_page_identity(self,url):
        safe=https_url(url)
        parts=urlsplit(safe);owner=urlsplit(self.source_url)
        if (parts.hostname or '').removeprefix('www.')!=(owner.hostname or '').removeprefix('www.') \
                or self.match_watch_identity(safe)!=self.identity:
            raise ValueError('comments_page_context_changed')
        return (parts.hostname,self.identity)

    def next_comment_page(self,html):
        # Follow only an actual next link within the comments region. The
        # destination must still identify this same source video.
        tree=LexborHTMLParser(html)
        node=tree.css_first('#comments a[rel~="next"][href], [data-comments] a[rel~="next"][href]')
        if node is None:return None
        target=https_url(urljoin(self.source_url,node.attributes['href']))
        identity=self.comment_page_identity(target)
        if target==self.source_url:raise ValueError('comments_page_context_changed')
        return {'url':target,'identity':identity}

    def initial_comment_records(self,html,url):
        from .profile_hub_workers import _extract_xhamster_initials
        from .profile_hub_avatar_extractors import extract_image_url
        state=_extract_xhamster_initials(html)
        component=state.get('commentsComponent')
        if not isinstance(component,dict):return None
        rows=component.get('comments')
        listing=component.get('commentsList')
        if rows is None and isinstance(listing,dict):
            target=listing.get('target')
            video=state.get('videoModel')
            if not isinstance(target,dict) or target.get('type')!='video' or not isinstance(video,dict) \
                    or video.get('id') is None or str(target.get('id'))!=str(video['id']):
                raise ValueError('comments_context_changed')
            rows=listing.get('items')
        if isinstance(rows,dict):rows=rows.get('items')
        if not isinstance(rows,list):return None
        records=[];seen=set()
        def visit(items,parent='root'):
            for item in items:
                if not isinstance(item,dict):continue
                # Only published source content; hidden/spam text is not recovered.
                if item.get('isSpam') is True or item.get('status') not in (None,'public'):continue
                raw_id=item.get('id');message=item.get('text') or item.get('message')
                if isinstance(raw_id,bool) or not isinstance(raw_id,(str,int)) or not str(raw_id).strip() or not isinstance(message,str) or not message.strip():continue
                identity=f'{self.id}:{raw_id}'
                if identity in seen:continue
                seen.add(identity)
                author=item.get('author') or item.get('user') or {}
                author=author if isinstance(author,dict) else {}
                profile=source_author_url({'author_url':author.get('pageURL') or author.get('pageUrl') or author.get('url')},url)
                avatar=author.get('thumbURL') or author.get('thumbUrl') or author.get('avatarURL')
                reply_to=item.get('replyToId')
                row_parent=f'{self.id}:{reply_to}' if isinstance(reply_to,(str,int)) and not isinstance(reply_to,bool) and str(reply_to).strip() else parent
                records.append({'id':identity,'parent':row_parent,'text':message.strip(),
                    'author':author.get('name') if isinstance(author.get('name'),str) else '',
                    'author_url':profile,'author_thumbnail':extract_image_url(url,{'src':avatar}) if isinstance(avatar,str) else '',
                    '_time_text':item.get('time') if isinstance(item.get('time'),str) else '',
                    'reaction_kind':'like','like_count':exact_source_count(item.get('likes'))})
                replies=item.get('replies')
                if isinstance(replies,dict):replies=replies.get('items')
                if isinstance(replies,list):visit(replies,identity)
        visit(rows)
        if rows and not records:raise ValueError('comments_markup_unrecognized')
        return records

    def parse(self,html,url,limit,*,include_unavailable=False):
        records=self.initial_comment_records(html,url)
        if not records:raise ValueError('comments_not_confirmed')
        return records[:limit]

    def parse_comment_fragment(self,html):
        records=self.initial_comment_records(html,self.source_url)
        if records is None:raise ValueError('comments_not_confirmed')
        return records


HTML_COMMENT_SOURCES=(EpornerCommentsSource,PornhubCommentsSource,XHamsterCommentsSource)


def html_comment_source(url):
    safe=https_url(url)
    for source_type in HTML_COMMENT_SOURCES:
        identity=source_type.match_watch_identity(safe)
        if identity is not None:
            source=source_type()
            source.identity=identity
            source.source_url=safe
            source.normalize_url(safe)
            return source
    return None
