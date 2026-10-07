FROM python:3.12-slim
WORKDIR /srv
COPY ops/requirements.txt ops/requirements.txt
RUN pip install --no-cache-dir -r ops/requirements.txt
COPY ops ./ops
CMD ["python", "-m", "ops.main"]
