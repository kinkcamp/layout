from __future__ import annotations

import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse

from app import __version__
from app.api import auth, files, health, layouts, projects, screenshots
from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.core.errors import AppError
from app.core.logging import configure_logging, log_event, request_id_var
from app.services.bootstrap import initialize_defaults

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        initialize_defaults(db, settings)
    finally:
        db.close()
    log_event(logger, "application.started")
    yield
    engine.dispose()
    log_event(logger, "application.stopped")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/v1/openapi.json",
    default_response_class=ORJSONResponse,
)
app.add_middleware(GZipMiddleware, minimum_size=64 * 1024, compresslevel=5)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    supplied = request.headers.get("X-Request-ID", "")
    request_id = supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else uuid.uuid4().hex
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log_event(logger, "request.failed", duration_ms=round((time.perf_counter() - started) * 1000))
        raise
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    log_event(
        logger,
        "request.completed",
        duration_ms=round((time.perf_counter() - started) * 1000),
        status_code=response.status_code,
    )
    request_id_var.reset(token)
    return response


def error_response(request: Request, status_code: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": jsonable_encoder(details),
                "request_id": request_id_var.get(),
            }
        },
    )


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return error_response(request, exc.status_code, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return error_response(request, 422, "VALIDATION_ERROR", "Request validation failed", exc.errors())


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return error_response(request, exc.status_code, f"HTTP_{exc.status_code}", str(exc.detail))


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception(
        "request.unhandled",
        extra={"event": "request.unhandled", "error_code": "INTERNAL_ERROR"},
    )
    return error_response(request, 500, "INTERNAL_ERROR", "Internal server error")


for router in (auth.router, projects.router, files.router, layouts.router, screenshots.router, health.router):
    app.include_router(router, prefix="/api/v1")
app.include_router(health.router)
