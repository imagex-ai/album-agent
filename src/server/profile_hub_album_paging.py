"""Technical request budgets for album HTML, never a catalog-size limit."""
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Bound each HTTP response's fan-out; later batches continue the same catalog.
ALBUM_HTML_PAGES_PER_BATCH = 20
ALBUM_HTML_CONCURRENCY = 4


def album_batch_bounds(batch: int) -> tuple[int, int]:
    if batch < 1:
        raise ValueError('Album batch must be positive')
    start = (batch - 1) * ALBUM_HTML_PAGES_PER_BATCH + 1
    return start, start + ALBUM_HTML_PAGES_PER_BATCH - 1


def album_query_page_url(url: str, page: int) -> str:
    """Preserve source filters/repeated query values when replacing page."""
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != 'page']
    query.append(('page', str(page)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def album_link_page_url(pages: dict[int, str], number: int) -> str | None:
    """Infer one numeric slot only when two real links prove the same template.

    Query names/routes come from source links. All other observed numbered links
    must fit; ambiguous paths/filters are not guessed.
    """
    references=sorted((index,urlsplit(url)) for index,url in pages.items() if index>1)
    if len(references)<2:return None
    (left_number,left),(right_number,right)=references[:2]
    if (left.scheme,left.netloc)!=(right.scheme,right.netloc):return None
    left_query=parse_qsl(left.query,keep_blank_values=True)
    right_query=parse_qsl(right.query,keep_blank_values=True)
    left_path=left.path.split('/');right_path=right.path.split('/')
    build=None
    if left.path==right.path and len(left_query)==len(right_query):
        differences=[index for index,pair in enumerate(zip(left_query,right_query)) if pair[0]!=pair[1]]
        if len(differences)==1:
            index=differences[0]
            if left_query[index][0]==right_query[index][0] and left_query[index][1]==str(left_number) and right_query[index][1]==str(right_number):
                def build(page):
                    query=list(left_query);query[index]=(query[index][0],str(page))
                    return left.path,urlencode(query)
    elif left_query==right_query and len(left_path)==len(right_path):
        differences=[index for index,pair in enumerate(zip(left_path,right_path)) if pair[0]!=pair[1]]
        if len(differences)==1:
            index=differences[0]
            if left_path[index]==str(left_number) and right_path[index]==str(right_number):
                def build(page):
                    path=list(left_path);path[index]=str(page)
                    return '/'.join(path),left.query
    if build is None:return None
    for page,reference in references:
        path,query=build(page)
        if (reference.scheme,reference.netloc)!=(left.scheme,left.netloc) or path!=reference.path or parse_qsl(query,keep_blank_values=True)!=parse_qsl(reference.query,keep_blank_values=True):return None
    path,query=build(number)
    return urlunsplit((left.scheme,left.netloc,path,query,''))
