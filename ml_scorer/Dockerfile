FROM python:3.12-slim
WORKDIR /srv
COPY ml_scorer/requirements.txt ml_scorer/requirements.txt
RUN pip install --no-cache-dir -r ml_scorer/requirements.txt
COPY ml/model1 ./ml/model1
COPY ml/atde ./ml/atde
COPY ml_scorer ./ml_scorer
CMD ["python", "-m", "ml_scorer.main"]
