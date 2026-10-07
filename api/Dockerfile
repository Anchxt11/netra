FROM python:3.12-slim
WORKDIR /srv
# Build context: the repo root (docker-compose.yaml), so CRIE's files can come in too.
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/app ./app
COPY api/tools ./tools
# CRIE (model 2): the wrapper, the ML team's engine and model, and the D3FEND tables it reads.
COPY ml/crie ./ml/crie
COPY model_2_temp/crie_deployment ./model_2_temp/crie_deployment
COPY model_2_temp/d3fend_techniques.json model_2_temp/d3fend_action_mapping.csv ./model_2_temp/
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
