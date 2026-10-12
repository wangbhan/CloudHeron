FROM python:3.12-slim
WORKDIR /workspace/backend
COPY backend/requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY backend .
COPY app/public /workspace/app/public
RUN useradd --create-home cloudheron && chown -R cloudheron:cloudheron /workspace
USER cloudheron
EXPOSE 8000
CMD ["uvicorn", "cloudheron.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
