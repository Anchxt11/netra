#!/bin/bash
cd /home/anchit/Documents/Programs/netra

mkdir -p powerbi_exports

VIEWS="bi_traffic_minute bi_freshness bi_incidents bi_decisions bi_kpi_alerts bi_job_runs"

for view in $VIEWS; do
    echo "Exporting $view..."
    docker compose exec -e PGPASSWORD=netra_bi_read postgres psql -U netra_bi -d soc -c "\COPY (SELECT * FROM bi.$view) TO STDOUT WITH CSV HEADER" > powerbi_exports/$view.csv
done

echo "Done exporting CSVs to powerbi_exports/"
ls -la powerbi_exports/
