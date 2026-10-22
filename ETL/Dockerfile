FROM ghcr.io/astral-sh/uv:0.8.17 AS uv-binary

FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

COPY --from=uv-binary /uv /uvx /bin/
COPY pyproject.toml uv.lock requirements.txt ./

RUN uv sync --frozen \
    && groupadd --system --gid 10001 appuser \
    && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/appuser appuser \
    && chown -R 10001:10001 /app

COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 main.py ./

EXPOSE 8000

USER 10001:10001

CMD ["uv", "run", "--no-sync", "fastapi", "run", "main.py", "--host", "0.0.0.0", "--port", "8000"]
