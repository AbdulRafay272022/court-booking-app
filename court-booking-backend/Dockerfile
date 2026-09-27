FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install --no-cache-dir .

EXPOSE 8000

# --proxy-headers + --forwarded-allow-ips=*: the container is only reachable via the host nginx
# (bound to 127.0.0.1:8000, blocked by the security group), and Docker's port-forwarding makes
# every request's peer the Docker gateway rather than 127.0.0.1 -- so uvicorn's default trusted
# proxy (127.0.0.1) would never match and it would treat ALL users as one IP. Trusting the proxy
# here lets uvicorn honour nginx's X-Forwarded-For so request.client is the real client. The
# per-IP throttles additionally read nginx's X-Real-IP directly (see app/utils/client_ip.py),
# which nginx overwrites per request and a client cannot spoof. (QA re-test C.)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
