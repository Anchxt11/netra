FROM python:3.12-slim
WORKDIR /app
COPY processor/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY processor /app/processor
COPY rules /app/rules
CMD ["python","-m","processor.main"]
