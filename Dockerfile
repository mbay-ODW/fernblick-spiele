# Fernblick-Spiele: Oberfläche (Vite/three.js) + Server (FastAPI) in einem kleinen Image
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
ARG GIT_SHA=dev
WORKDIR /app
COPY server/pyproject.toml ./
COPY server/spiele ./spiele
RUN pip install --no-cache-dir .
COPY --from=web /web/dist /app/web
ENV SPIELE_WEB=/app/web SPIELE_DATA=/data SPIELE_BUILD=${GIT_SHA} PYTHONUNBUFFERED=1 TZ=Europe/Berlin
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"
CMD ["uvicorn", "spiele.app:app", "--host", "0.0.0.0", "--port", "8000"]
