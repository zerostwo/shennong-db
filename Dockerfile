FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md /app/
COPY shennong_db /app/shennong_db
COPY sql /app/sql

RUN chmod -R a+rX /app \
    && pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "shennong_db.main:app", "--host", "0.0.0.0", "--port", "8000"]
