"""Materialize a complete, unencrypted VOD playlist with bounded public reads.

Only local filenames reach FFmpeg. Live windows, encryption, ranges and gaps
remain unsupported rather than pretending to represent a complete timeline.
"""
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit
from .profile_hub_execution import https_url

MAX_HLS_MANIFEST_BYTES = 64 * 1024  # Metadata response bound, not catalog length.
MAX_HLS_MANIFEST_DEPTH = 4  # Prevent cyclic/nested master graphs.


def attributes(line):
    return {key: quoted or plain for key, quoted, plain in re.findall(
        r'([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))', line.split(':', 1)[1])}


async def materialize_hls(client, root_url, text, directory, headers, remaining_bytes):
    directory = Path(directory)
    serial = 0

    async def asset(url, suffix, manifest=False):
        nonlocal remaining_bytes, serial
        target = https_url(url)
        path = directory / f'hls-{serial}{suffix}'
        serial += 1
        count = 0
        async with client.stream('GET', target, headers=headers(target)) as response:
            if response.status_code != 200:
                raise ValueError('Complete original HLS asset unavailable')
            declared = response.headers.get('content-length')
            limit = min(remaining_bytes, MAX_HLS_MANIFEST_BYTES) if manifest else remaining_bytes
            if declared and int(declared) > limit:
                raise ValueError('HLS analysis byte budget exceeded')
            with path.open('wb') as output:
                async for chunk in response.aiter_bytes():
                    count += len(chunk)
                    if count > limit:
                        raise ValueError('HLS analysis byte budget exceeded')
                    output.write(chunk)
        if not count or (declared and count != int(declared)):
            raise ValueError('Incomplete HLS asset')
        remaining_bytes -= count
        return path

    current = https_url(root_url)
    for _ in range(MAX_HLS_MANIFEST_DEPTH):
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines or lines[0] != '#EXTM3U':
            raise ValueError('Invalid HLS manifest')
        variants = []
        for index, line in enumerate(lines[:-1]):
            if line.startswith('#EXT-X-STREAM-INF:'):
                options = attributes(line)
                uri = lines[index + 1]
                if uri.startswith('#'):
                    raise ValueError('Invalid HLS variant')
                variants.append((int(options.get('BANDWIDTH', '0')), uri, options))
        if not variants:
            break
        _, uri, chosen = min(variants, key=lambda item: item[0])
        audio = [attributes(line) for line in lines if line.startswith('#EXT-X-MEDIA:')]
        audio = [item for item in audio if item.get('TYPE') == 'AUDIO'
                 and item.get('GROUP-ID') == chosen.get('AUDIO') and item.get('URI')]
        if audio:
            defaults = [item for item in audio if item.get('DEFAULT') == 'YES']
            if len(defaults) == 1:
                uri = defaults[0]['URI']
            elif len(audio) == 1:
                uri = audio[0]['URI']
            else:
                raise ValueError('Original HLS audio language is ambiguous')
        current = https_url(urljoin(current, uri))
        manifest = await asset(current, '.m3u8', manifest=True)
        text = manifest.read_text(encoding='utf-8-sig')
    else:
        raise ValueError('HLS master nesting limit exceeded')

    if '#EXT-X-ENDLIST' not in lines or '#EXT-X-PLAYLIST-TYPE:VOD' not in lines:
        raise ValueError('Live HLS window is not a complete original')
    local, segments = [], 0
    for line in lines:
        if line.startswith(('#EXT-X-BYTERANGE:', '#EXT-X-GAP')):
            raise ValueError('HLS timeline contains ranges or missing segments')
        if line.startswith('#EXT-X-KEY:'):
            if attributes(line).get('METHOD') != 'NONE':
                raise ValueError('Encrypted HLS analysis is not installed')
        if line.startswith('#EXT-X-MAP:'):
            options = attributes(line)
            if options.get('BYTERANGE') or not options.get('URI'):
                raise ValueError('HLS init range is unsupported')
            path = await asset(urljoin(current, options['URI']), '.mp4')
            line = f'#EXT-X-MAP:URI="{path.name}"'
        elif line.startswith('#'):
            if 'URI=' in line:
                raise ValueError('Unresolved nested HLS reference')
        else:
            target = https_url(urljoin(current, line))
            suffix = Path(urlsplit(target).path).suffix.lower()
            if suffix not in ('.ts', '.aac', '.m4s', '.mp4'):
                suffix = '.ts'
            line = (await asset(target, suffix)).name
            segments += 1
        local.append(line)
    if not segments:
        raise ValueError('No complete HLS audio/video segments')
    result = directory / 'original-local.m3u8'
    result.write_text('\n'.join(local)+'\n', encoding='utf-8')
    return result
