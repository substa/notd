FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server.py index.html app.js graph.js styles.css theme-config.css sw.js ./
COPY DOCUMENTATION.md DEPLOYMENT.md manifest.webmanifest ./
COPY favicon.ico favicon-16x16.png favicon-32x32.png apple-touch-icon.png ./
COPY icon-192.png icon-512.png icon-maskable-512.png ./

EXPOSE 4176

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4176/api/graph/status', timeout=3).read()"]

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "4176", "--graph", "/graph"]
