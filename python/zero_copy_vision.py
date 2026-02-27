#!/usr/bin/env python3
"""
Glazyr Viz — Zero-Copy Vision Backbone
Operates at hardware-speed using OS-Level Shared Memory.
Includes a graceful fallback for local development without the NeuralChromium renderer.
"""
import argparse
import json
import time
import sys
import os

def run_zero_copy_vision(url):
    # Try exact Zero-Copy on Linux where NeuralChromium renders
    SHM_NAME = 'NeuralChromium_Video'
    SHM_SIZE = 1920 * 1080 * 4 + 256

    if os.name == 'posix':
        try:
            import mmap
            import struct
            shm_path = f'/dev/shm/{SHM_NAME}'
            if os.path.exists(shm_path):
                shm_fd = os.open(shm_path, os.O_RDWR)
                shm = mmap.mmap(shm_fd, SHM_SIZE, mmap.MAP_SHARED, mmap.PROT_READ)

                t_start = time.perf_counter()

                shm.seek(0)
                header_data = shm.read(32)
                magic, width, height, stride, timestamp_us, fmt, seq_num = struct.unpack('<IIIIQII', header_data)

                if magic == 0x4E43524D:  # 'MRCN'
                    shm.seek(256)
                    pixel_data = shm.read(width * height * 4)
                    sample_blue = sum(pixel_data[0:4000:4]) / 1000.0

                    t_read = (time.perf_counter() - t_start) * 1000

                    result = {
                        "url": url,
                        "status": "zero-copy-active",
                        "resolution": f"{width}x{height}",
                        "latest_sequence": seq_num,
                        "visual_luma_metric": round(sample_blue, 2),
                        "latency_ms": round(t_read, 2),
                        "timestamp_us": timestamp_us,
                        "message": "Direct visual linkage established. The Serialization Tax is dead."
                    }
                    print(json.dumps(result, indent=2))
                    sys.exit(0)
        except Exception:
            pass  # Fall through to HTTP fallback

    # FALLBACK: HTTP contextual extraction for local dev / Windows
    import urllib.request
    from html.parser import HTMLParser

    class TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.texts = []
            self.title = ""
            self._in_title = False
            self._in_skip = False

        def handle_starttag(self, tag, attrs):
            if tag == "title":
                self._in_title = True
            if tag in ("script", "style"):
                self._in_skip = True

        def handle_endtag(self, tag):
            if tag == "title":
                self._in_title = False
            if tag in ("script", "style"):
                self._in_skip = False

        def handle_data(self, data):
            if self._in_title:
                self.title = data.strip()
            elif not self._in_skip:
                text = data.strip()
                if text:
                    self.texts.append(text)

    t_start = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'GlazyrViz/0.2.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8', errors='ignore')
            t_fetch = (time.perf_counter() - t_start) * 1000

            parser = TextExtractor()
            parser.feed(html)
            t_parse = (time.perf_counter() - t_start) * 1000

            body_text = "\n".join(parser.texts[:50])
            html_size = len(html)
            context_size = len(body_text)

            result = {
                "url": url,
                "status": "fallback-http",
                "status_code": response.getcode(),
                "title": parser.title,
                "html_bytes": html_size,
                "context_bytes": context_size,
                "token_efficiency": f"{(1 - context_size / max(html_size, 1)) * 100:.1f}%",
                "fetch_ms": round(t_fetch, 1),
                "total_ms": round(t_parse, 1),
                "message": "Zero-Copy path unavailable. Fallback HTTP contextual extraction used.",
                "body_preview": body_text[:500]
            }

            print(json.dumps(result, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e), "url": url}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="URL to validate")
    args = parser.parse_args()
    run_zero_copy_vision(args.url)
