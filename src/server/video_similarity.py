"""Conservative frame-based suggestions for local videos; not identity proof."""
import re
import shutil
import subprocess
import time


def ffmpeg_path():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def run_ffmpeg(args, cancel, timeout=15):
    if cancel.is_set():
        return None
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    try:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
    except OSError:
        return None
    deadline = time.monotonic() + timeout
    try:
        while True:
            if cancel.is_set() or time.monotonic() >= deadline:
                process.kill()
                process.communicate()
                return None
            try:
                out, err = process.communicate(timeout=.25)
                return process.returncode, out, err
            except subprocess.TimeoutExpired:
                continue
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def probe_duration(exe, path, cancel):
    result = run_ffmpeg([exe, '-hide_banner', '-i', str(path)], cancel)
    if not result:
        return None
    match = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', result[2].decode('utf-8', errors='replace'))
    if not match:
        return None
    return int(match.group(1))*3600 + int(match.group(2))*60 + float(match.group(3))


def frame_hash(exe, path, seconds, cancel):
    result = run_ffmpeg([exe, '-hide_banner', '-loglevel', 'error', '-ss', str(seconds), '-i', str(path),
                         '-frames:v', '1', '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', '-'], cancel)
    if not result or result[0] != 0 or len(result[1]) != 72:
        return None
    pixels = result[1]
    # Flat frames such as black lead to common false matches.
    if max(pixels) - min(pixels) < 24:
        return None
    value = 0
    for row in range(8):
        for col in range(8):
            value = (value << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return value


def fingerprints_close(first, second):
    distances = [(a ^ b).bit_count() for a, b in zip(first, second)]
    return len(distances) == 3 and max(distances) <= 6 and sum(distances) <= 12
