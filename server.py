#!/usr/bin/env python3
"""Serve markd and an optional writable graph over HTTP.

Use only on a trusted network. The graph API intentionally has no authentication.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import queue
import re
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse

MAX_BODY = 32 * 1024 * 1024
MARKDOWN_SUFFIXES = {".md", ".markdown"}


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[queue.Queue] = set()
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue:
        subscriber: queue.Queue = queue.Queue(maxsize=100)
        with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: queue.Queue) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def publish(self, event: dict) -> None:
        event["timestamp"] = time.time()
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(event)
            except queue.Full:
                try:
                    subscriber.get_nowait()
                    subscriber.put_nowait(event)
                except (queue.Empty, queue.Full):
                    pass


class GraphWatcher(threading.Thread):
    def __init__(self, graph: Path, broker: EventBroker) -> None:
        super().__init__(name="markd-graph-watcher", daemon=True)
        self.graph = graph
        self.broker = broker
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.snapshot = self._scan()

    def _scan(self) -> dict[str, str]:
        result: dict[str, str] = {}
        candidates = [path for path in self.graph.iterdir() if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES]
        for folder_name in ("pages", "journals"):
            folder = self.graph / folder_name
            if folder.is_dir():
                candidates.extend(path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES)
        for path in candidates:
            try:
                result[path.relative_to(self.graph).as_posix()] = str(path.stat().st_mtime_ns)
            except OSError:
                pass
        return result

    def run(self) -> None:
        while not self.stopped.wait(0.75):
            with self.lock:
                current = self._scan()
                previous = self.snapshot
                self.snapshot = current
            for path, revision in current.items():
                if path not in previous:
                    self.broker.publish({"type": "created", "path": path, "revision": revision})
                elif previous[path] != revision:
                    self.broker.publish({"type": "changed", "path": path, "revision": revision})
            for path in previous.keys() - current.keys():
                self.broker.publish({"type": "deleted", "path": path})

    def stop(self) -> None:
        self.stopped.set()


def journal_config(graph: Path) -> dict[str, str]:
    defaults = {"fileNameFormat": "yyyy_MM_dd", "pageTitleFormat": "MMM do, yyyy"}
    try:
        content = (graph / "logseq" / "config.edn").read_text(encoding="utf-8")
    except OSError:
        return defaults
    page = re.search(r':journal/page-title-format\s+"([^"]+)"', content)
    filename = re.search(r':journal/file-name-format\s+"([^"]+)"', content)
    return {
        "fileNameFormat": filename.group(1) if filename else defaults["fileNameFormat"],
        "pageTitleFormat": page.group(1) if page else defaults["pageTitleFormat"],
    }


class MarkdHandler(SimpleHTTPRequestHandler):
    server_version = "markd/1"
    protocol_version = "HTTP/1.1"

    @property
    def graph(self) -> Path | None:
        return self.server.graph  # type: ignore[attr-defined]

    @property
    def broker(self) -> EventBroker:
        return self.server.broker  # type: ignore[attr-defined]

    @property
    def watcher(self) -> GraphWatcher | None:
        return self.server.watcher  # type: ignore[attr-defined]

    def end_headers(self) -> None:
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_head(self):
        """Serve the SPA shell for clean graph-page routes."""
        original_path = self.path
        route = urlparse(original_path).path
        if re.match(r"^/(?:pages|journals)/[^/].*", route):
            self.path = "/index.html"
        try:
            return super().send_head()
        finally:
            self.path = original_path

    def json_response(self, payload: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error_json(self, status: int, message: str) -> None:
        self.json_response({"error": message}, status)

    def graph_path(self, raw_path: str, markdown_only: bool = False) -> Path:
        if not self.graph:
            raise FileNotFoundError("No graph configured")
        relative = PurePosixPath(unquote(raw_path))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ValueError("Invalid graph path")
        target = (self.graph / Path(*relative.parts)).resolve()
        target.relative_to(self.graph)
        if markdown_only and target.suffix.lower() not in MARKDOWN_SUFFIXES:
            raise ValueError("Only Markdown files can be modified")
        return target

    def request_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def scan_graph(self) -> list[dict]:
        assert self.graph
        candidates: list[Path] = []
        candidates.extend(path for path in self.graph.iterdir() if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES)
        for folder_name in ("pages", "journals"):
            folder = self.graph / folder_name
            if folder.is_dir():
                candidates.extend(path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES)
        files = []
        for path in sorted(set(candidates)):
            try:
                stat = path.stat()
                files.append({
                    "path": path.relative_to(self.graph).as_posix(),
                    "name": path.name,
                    "folder": path.parent.relative_to(self.graph).as_posix() if path.parent != self.graph else "",
                    "content": path.read_text(encoding="utf-8"),
                    "revision": str(stat.st_mtime_ns),
                })
            except (OSError, UnicodeError):
                continue
        return files

    def stream_events(self) -> None:
        subscriber = self.broker.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    event = subscriber.get(timeout=15)
                    payload = json.dumps(event, ensure_ascii=False).encode("utf-8")
                    self.wfile.write(b"data: " + payload + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.broker.unsubscribe(subscriber)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/graph"):
            return super().do_GET()
        if not self.graph:
            return self.error_json(HTTPStatus.NOT_FOUND, "No graph configured")
        try:
            if parsed.path == "/api/graph/events":
                return self.stream_events()
            if parsed.path == "/api/graph/status":
                return self.json_response({"enabled": True, "name": self.graph.name, "config": journal_config(self.graph)})
            if parsed.path == "/api/graph/stats":
                files = 0
                size = 0
                last_modified = 0.0
                skipped = 0
                for root, _, names in os.walk(self.graph, onerror=lambda _: None):
                    for name in names:
                        try:
                            stat = (Path(root) / name).stat()
                        except OSError:
                            skipped += 1
                            continue
                        files += 1
                        size += stat.st_size
                        last_modified = max(last_modified, stat.st_mtime)
                return self.json_response({"files": files, "size": size, "lastModified": round(last_modified * 1000), "partial": skipped > 0})
            if parsed.path == "/api/graph/files":
                return self.json_response({"files": self.scan_graph(), "config": journal_config(self.graph)})
            query = parse_qs(parsed.query)
            raw_path = query.get("path", [""])[0]
            if parsed.path == "/api/graph/file":
                target = self.graph_path(raw_path, markdown_only=True)
                stat = target.stat()
                return self.json_response({"path": raw_path, "content": target.read_text(encoding="utf-8"), "revision": str(stat.st_mtime_ns)})
            if parsed.path == "/api/graph/asset":
                target = self.graph_path(raw_path)
                if not target.is_file():
                    raise FileNotFoundError(raw_path)
                content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(target.stat().st_size))
                self.end_headers()
                with target.open("rb") as source:
                    while chunk := source.read(64 * 1024):
                        self.wfile.write(chunk)
                return
            self.error_json(HTTPStatus.NOT_FOUND, "Unknown graph endpoint")
        except FileNotFoundError:
            self.error_json(HTTPStatus.NOT_FOUND, "Graph file not found")
        except (ValueError, OSError, UnicodeError) as error:
            self.error_json(HTTPStatus.BAD_REQUEST, str(error))

    def atomic_write(self, target: Path, content: str) -> int:
        target.parent.mkdir(parents=True, exist_ok=True)
        mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
        descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
        try:
            os.chmod(temporary, mode)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        return target.stat().st_mtime_ns

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/api/graph/file":
            return self.error_json(HTTPStatus.NOT_FOUND, "Unknown graph endpoint")
        try:
            payload = self.request_json()
            target = self.graph_path(str(payload.get("path", "")), markdown_only=True)
            exists = target.exists()
            if not exists and not payload.get("create"):
                return self.error_json(HTTPStatus.NOT_FOUND, "Graph file not found")
            expected = payload.get("expectedRevision")
            if exists and not payload.get("force") and expected is not None and target.stat().st_mtime_ns != int(expected):
                return self.error_json(HTTPStatus.CONFLICT, "The file changed on disk")
            relative = target.relative_to(self.graph).as_posix()
            if self.watcher:
                with self.watcher.lock:
                    revision = self.atomic_write(target, str(payload.get("content", "")))
                    self.watcher.snapshot[relative] = str(revision)
            else:
                revision = self.atomic_write(target, str(payload.get("content", "")))
            self.broker.publish({"type": "changed" if exists else "created", "path": relative, "revision": str(revision), "clientId": payload.get("clientId")})
            self.json_response({"path": relative, "revision": str(revision)})
        except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as error:
            self.error_json(HTTPStatus.BAD_REQUEST, str(error))

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/graph/rename":
            return self.error_json(HTTPStatus.NOT_FOUND, "Unknown graph endpoint")
        try:
            payload = self.request_json()
            source = self.graph_path(str(payload.get("source", "")), markdown_only=True)
            target = self.graph_path(str(payload.get("target", "")), markdown_only=True)
            if target.exists() and target != source:
                return self.error_json(HTTPStatus.CONFLICT, "A page with this name already exists")
            expected = payload.get("expectedRevision")
            if expected is not None and source.stat().st_mtime_ns != int(expected):
                return self.error_json(HTTPStatus.CONFLICT, "The file changed on disk")
            source_relative = source.relative_to(self.graph).as_posix(); target_relative = target.relative_to(self.graph).as_posix()
            if self.watcher:
                with self.watcher.lock:
                    revision = self.atomic_write(target, str(payload.get("content", "")))
                    if source != target:
                        source.unlink(); self.watcher.snapshot.pop(source_relative, None)
                    self.watcher.snapshot[target_relative] = str(revision)
            else:
                revision = self.atomic_write(target, str(payload.get("content", "")))
                if source != target:
                    source.unlink()
            self.broker.publish({"type": "renamed", "path": target_relative, "oldPath": source_relative, "revision": str(revision), "clientId": payload.get("clientId")})
            self.json_response({"path": target_relative, "revision": str(revision)})
        except FileNotFoundError:
            self.error_json(HTTPStatus.NOT_FOUND, "Graph file not found")
        except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as error:
            self.error_json(HTTPStatus.BAD_REQUEST, str(error))


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve markd and a writable local graph")
    parser.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to make markd reachable on the LAN")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--graph", type=Path, help="Path to a Logseq graph exposed through the API")
    arguments = parser.parse_args()

    app_directory = Path(__file__).resolve().parent
    graph = arguments.graph.expanduser().resolve() if arguments.graph else None
    if graph and not graph.is_dir():
        parser.error(f"Graph directory does not exist: {graph}")

    def handler(*args, **kwargs):
        return MarkdHandler(*args, directory=str(app_directory), **kwargs)

    server = ThreadingHTTPServer((arguments.host, arguments.port), handler)
    server.graph = graph  # type: ignore[attr-defined]
    server.broker = EventBroker()  # type: ignore[attr-defined]
    server.watcher = GraphWatcher(graph, server.broker) if graph else None  # type: ignore[attr-defined]
    if server.watcher:
        server.watcher.start()
    location = f"http://{arguments.host}:{arguments.port}"
    print(f"markd: {location}")
    print(f"graph: {graph if graph else 'disabled'}")
    if arguments.host not in {"127.0.0.1", "localhost", "::1"}:
        print("warning: the writable graph is available without authentication; use only on a trusted LAN")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server.watcher:
            server.watcher.stop()
        server.server_close()


if __name__ == "__main__":
    main()
