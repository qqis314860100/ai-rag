import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router as rag_router
from .core.logging_safety import safe_log_json, safe_text_summary, sha256_short
from .llm.usage_guard import set_usage_context

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(title="Enterprise RAG Knowledge Base - RAG Service", version="1.0.0")
logger = logging.getLogger("rag.request")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    start = time.perf_counter()
    request_id = request.headers.get("x-request-id") or str(uuid4())
    user_id = request.headers.get("x-user-id") or "service"
    set_usage_context(user_id)

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception(safe_log_json({
            "requestId": request_id,
            "request_id": request_id,
            "userId_hash": sha256_short(user_id),
            "route": request.url.path,
            "method": request.method,
            "status": 500,
            "duration_ms": duration_ms,
            "error_code": "INTERNAL_ERROR",
        }))
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    response.headers["X-Request-Id"] = request_id
    log_data = {
        "requestId": request_id,
        "request_id": request_id,
        "userId_hash": sha256_short(user_id),
        "route": request.url.path,
        "method": request.method,
        "status": response.status_code,
        "duration_ms": duration_ms,
        "error_code": None if response.status_code < 400 else f"HTTP_{response.status_code}",
    }
    if request.url.query:
        log_data["query"] = safe_text_summary(request.url.query, limit=0)
    message = safe_log_json(log_data)
    if response.status_code >= 500:
        logger.error(message)
    elif response.status_code >= 400:
        logger.warning(message)
    else:
        logger.info(message)
    return response


app.include_router(rag_router)
