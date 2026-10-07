import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import consumers, crie, db, kpi, models, ops
from .routes import auth, config, events, freshness, incidents, ws
from .routes import kpi as kpi_routes
from .routes import ops as ops_routes
from .routes import models as models_routes
from .routes import crie as crie_routes
from .settings import settings
from .ws import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    tasks = consumers.start_all() + [kpi.start(), ops.start(), models.start(), crie.start()]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await db.close_pool()


app = FastAPI(title="SOC Dashboard API", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (auth.router, events.router, incidents.router, freshness.router, config.router, kpi_routes.router, ops_routes.router, models_routes.router, crie_routes.router, ws.router):
    app.include_router(r)


@app.get("/health", tags=["health"])
async def health():
    try:
        await db.get_pool().fetchval("SELECT 1")
        pg = True
    except Exception:
        pg = False
    return {
        "status": "ok" if pg and all(consumers.state.values()) else "degraded",
        "postgres": pg,
        "consumers": consumers.state,
        "ws_clients": len(manager.clients),
    }
