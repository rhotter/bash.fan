"""Download a bounded test pair from the authors' public StabStitch-D archive.

Uses ZIP range requests rather than downloading the entire 6 GB archive.
No downloaded code is executed. Dataset media is not part of this repository.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import zipfile

FILE_ID = '1De-WjMbTPUaij4rN34gisWbhAz0fA1LA'
PAGE = 'https://drive.usercontent.google.com/download'


class Form(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'input' and a.get('type') == 'hidden' and a.get('name') in ['id', 'export', 'confirm', 'uuid']:
            self.values[a['name']] = a.get('value', '')


class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos, self.downloaded = url, 0, 0
        self.cached = []
        with urlopen(Request(url, headers={'Range': 'bytes=0-0'}), timeout=30) as r:
            if r.status != 206:
                raise ValueError('Server does not support partial downloads')
            self.size = int(r.headers['Content-Range'].split('/')[-1])

    def seekable(self):
        return True

    def seek(self, n, whence=0):
        self.pos = n if whence == 0 else self.pos+n if whence == 1 else self.size+n
        return self.pos

    def tell(self):
        return self.pos

    def fetch(self, first, length):
        if length < 0 or first < 0 or first+length > self.size or self.downloaded+length > 100_000_000:
            raise ValueError('Download would exceed the 100 MB bound')
        req = Request(self.url, headers={'Range': f'bytes={first}-{first+length-1}'})
        with urlopen(req, timeout=30) as r:
            if r.status != 206 or not r.headers.get('Content-Range', '').startswith(f'bytes {first}-'):
                raise ValueError('Server ignored the requested range')
            data = r.read(length+1)
        if len(data) != length:
            raise ValueError('Partial response length mismatch')
        self.downloaded += length
        self.cached.append((first, data))
        return data

    def read(self, n=-1):
        n = min(n if n >= 0 else self.size-self.pos, self.size-self.pos)
        if n <= 0:
            return b''
        for first, data in self.cached:
            if first <= self.pos and self.pos+n <= first+len(data):
                result = data[self.pos-first:self.pos-first+n]
                break
        else:
            result = self.fetch(self.pos, n)
        self.pos += n
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pair', default='00000107')
    p.add_argument('--frames', type=int, default=90)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9]{1,32}', args.pair) or not 1 <= args.frames <= 300:
        p.error('Use an alphanumeric test pair ID and 1–300 frames')
    if args.output.exists():
        p.error('Choose a new output directory')
    params = {'id': FILE_ID, 'export': 'download'}
    with urlopen(PAGE+'?'+urlencode(params), timeout=30) as r:
        if 'text/html' in r.headers.get('Content-Type', ''):
            form = Form()
            form.feed(r.read(1_000_000).decode())
            params.update(form.values)
    remote = RemoteZip(PAGE+'?'+urlencode(params))
    manifest = {'source': 'https://github.com/nie-lang/StabStitch', 'archive_file_id': FILE_ID,
                'pair': args.pair, 'timing': 'Ordered JPEG pairs; no native PTS/audio in these files', 'files': []}
    with zipfile.ZipFile(remote) as archive:
        groups = []
        for side in ['video1', 'video2']:
            prefix = f'StabStitch-D/testing/{args.pair}/{side}/'
            entries = sorted([x for x in archive.infolist() if x.filename.startswith(prefix) and x.filename.endswith('.jpg')], key=lambda x: x.filename)[:args.frames]
            if len(entries) != args.frames:
                raise ValueError('Requested pair or frame range is not available')
            # Cache each contiguous run to avoid three HTTP requests per JPEG.
            first, last = entries[0], entries[-1]
            remote.fetch(first.header_offset, last.header_offset+30+len(last.filename.encode())+len(last.extra)+last.compress_size-first.header_offset)
            groups.append((side, entries))
        args.output.mkdir(parents=True)
        for side, entries in groups:
            (args.output/side).mkdir()
            for entry in entries:
                if entry.file_size > 10_000_000:
                    raise ValueError('Unexpectedly large frame')
                data = archive.read(entry)  # Validates ZIP CRC; never extract arbitrary paths.
                name = f'{side}/{Path(entry.filename).name}'
                (args.output/name).write_bytes(data)
                manifest['files'].append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    manifest['downloaded_bytes'] = remote.downloaded
    (args.output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'pair': args.pair, 'frames_per_view': args.frames, 'downloaded_bytes': remote.downloaded}))


if __name__ == '__main__':
    main()
