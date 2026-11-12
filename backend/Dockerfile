FROM python:3.12-slim AS api
WORKDIR /workspace/backend
ENV PYTHONUNBUFFERED=1 SERVE_FRONTEND=false FRONTEND_DIR=/workspace/fixtures
COPY backend/requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home cloudheron
COPY backend/cloudheron ./cloudheron
COPY backend/migrations ./migrations
COPY app/public/test-cases.json /workspace/fixtures/
COPY app/public/assets/cloudheron-icon.png app/public/assets/cloudheron-login-scene.png /workspace/fixtures/assets/
USER cloudheron
EXPOSE 8000
CMD ["uvicorn", "cloudheron.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM api AS bundled
ENV SERVE_FRONTEND=true FRONTEND_DIR=/workspace/app/public
COPY app/public /workspace/app/public
