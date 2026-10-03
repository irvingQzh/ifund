FROM python:3.12-slim@sha256:dddfd7e07f9d15aeeca61529320492139d21cac7f0070c00609243e51e4e0016
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
COPY ops/qfund/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir -r /tmp/requirements.txt -c /tmp/requirements.lock \
    && groupadd --gid 10001 qfund \
    && useradd --uid 10001 --gid qfund --no-create-home --shell /usr/sbin/nologin qfund
COPY --chown=root:root backend/ /app/
# mktemp-based frontend output can inherit 0700; runtime is deliberately non-root.
RUN chmod -R a+rX /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["waitress-serve", "--listen=0.0.0.0:8000", "--threads=4", "app.main:app"]
