import os
import asyncio
import fastf1
from datetime import datetime
from contextlib import asynccontextmanager

# Enable FastF1 disk cache BEFORE importing anything that might use it
cache_dir = os.path.join(os.path.dirname(__file__), "fastf1_cache")
os.makedirs(cache_dir, exist_ok=True)

# Path to the FastF1 HTTP cache database
http_cache_file = os.path.join(cache_dir, "fastf1_http_cache.sqlite")


def _clear_http_cache():
    """Delete the FastF1 HTTP cache so fresh schedule data is fetched."""
    if os.path.exists(http_cache_file):
        try:
            os.remove(http_cache_file)
            print(f"[{datetime.now():%H:%M:%S}] Cleared FastF1 HTTP cache")
        except Exception as e:
            print(f"[{datetime.now():%H:%M:%S}] Failed to delete HTTP cache: {e}")


# Clear on import (server startup)
_clear_http_cache()
fastf1.Cache.enable_cache(cache_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import events, drivers, telemetry
from services import cache as app_cache

# ─── How often to auto-refresh (seconds) ─────────────────────────────────────
REFRESH_INTERVAL = 2 * 60 * 60  # 2 hours


async def _periodic_cache_refresh():
    """Background loop: every REFRESH_INTERVAL seconds, clear caches so
    the next request fetches fresh data from FastF1 / the F1 API."""
    while True:
        await asyncio.sleep(REFRESH_INTERVAL)
        print(f"[{datetime.now():%H:%M:%S}] Periodic refresh — clearing caches")
        # 1. Clear in-memory processed-data cache
        app_cache.clear()
        # 2. Delete the FastF1 HTTP cache SQLite file
        _clear_http_cache()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle: launch the background refresh task."""
    task = asyncio.create_task(_periodic_cache_refresh())
    print(f"[{datetime.now():%H:%M:%S}] Background cache refresh started (every {REFRESH_INTERVAL // 3600}h)")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="F1 Telemetry API",
    version="1.0.0",
    description="Backend for F1 Telemetry Analysis web app powered by FastF1",
    lifespan=lifespan,
)

_raw_origins = os.getenv("FRONTEND_URL", "*")
_allowed_origins = [o.strip() for o in _raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router)
app.include_router(drivers.router)
app.include_router(telemetry.router)


@app.get("/")
def root():
    return {"message": "F1 Telemetry API is running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
