# Build context is the repository root (see docker-compose.yml and fly.toml).
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app app
COPY frontend frontend
COPY library library
ENV FRONTEND_DIR=/srv/frontend LIBRARY_DIR=/srv/library
EXPOSE 8000
# The Hub edits the company library: when LIBRARY_DIR is on a volume, it starts as a copy of the one in the image.
CMD ["sh", "-c", "[ -e \"$LIBRARY_DIR\" ] || cp -r /srv/library \"$LIBRARY_DIR\"; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
