"""Deployment security configuration and fail-closed API perimeter."""
from __future__ import annotations

import datetime
import logging
import math
import os
import re
from collections.abc import Mapping

from flask import Flask, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from app import db as database

_PUBLIC_ENDPOINTS = {"health", "auth.login", "auth.register", "auth.exchange_token"}
_REMOTE_TERMINATE = {
    "fund_detail.remote", "fund_holdings.remote", "fund_nav.remote",
    "stock_industry.remote_terminate",
}
_PRODUCTION_DISABLED = _REMOTE_TERMINATE | {"ai_analyze.ai_analyze"}


def _boolean(environ: Mapping[str, str], name: str, default: bool) -> bool:
    """Reject misspelled booleans instead of silently weakening production mode."""
    value = environ.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    raise RuntimeError(f"{name} 必须明确设置为 true 或 false")


def _production_secret_valid(secret: str) -> bool:
    """Require the deployment's 32-byte hex key format; reject obvious patterns.

    Randomness cannot be proven from a string. Operators must generate the key
    with secrets.token_hex(32), never use a human-chosen example or password.
    """
    if not re.fullmatch(r"[0-9a-fA-F]{64}", secret) or len(set(secret.lower())) < 12:
        return False
    normalized = secret.lower()
    return not any(normalized == normalized[:length] * (64 // length)
                   for length in range(1, 33) if 64 % length == 0)


def security_config(environ: Mapping[str, str] | None = None) -> dict:
    """Read environment without logging secrets; validate before DB initialization."""
    environ = os.environ if environ is None else environ
    production = _boolean(environ, "QFUND_PRODUCTION", False)
    allow_registration = _boolean(environ, "ALLOW_REGISTRATION", not production)
    secret = environ.get("SECRET_KEY", "dev-secret")
    if production and not _production_secret_valid(secret):
        raise RuntimeError("生产模式要求 SECRET_KEY 为强随机的 64 位十六进制字符串；"
                           "请使用 secrets.token_hex(32) 生成，不能使用示例或重复模式")
    if not production and len(secret.encode()) < 32:
        logging.warning("本地 SECRET_KEY 较弱；对外部署必须启用 QFUND_PRODUCTION 并生成随机密钥")
    try:
        expires_days = float(environ.get("JWT_EXPIRES_DAYS", "1" if production else "30"))
    except ValueError as exc:
        if production:
            raise RuntimeError("生产模式 JWT_EXPIRES_DAYS 必须是 0 到 30 之间的正数") from exc
        expires_days = 30
    if production and (not math.isfinite(expires_days) or not 0 < expires_days <= 30):
        raise RuntimeError("生产模式 JWT_EXPIRES_DAYS 必须是 0 到 30 之间的正数，不允许永不过期")
    return {
        "QFUND_PRODUCTION": production,
        "ALLOW_REGISTRATION": allow_registration,
        "JWT_SECRET_KEY": secret,
        "JWT_TOKEN_LOCATION": ["headers"],
        "JWT_HEADER_TYPE": "Bearer",
        "JWT_ACCESS_TOKEN_EXPIRES": False if expires_days <= 0 else datetime.timedelta(days=expires_days),
    }


def install_api_guards(app: Flask) -> None:
    """Protect every production API, including future routes missing decorators.

    Nginx strips /qfund/; the application still receives /api/... paths. Do not
    trust forwarded headers or infer production from the request's remote IP.
    """
    @app.before_request
    def private_api_guard():
        if not request.path.startswith("/api/") or request.endpoint in _PUBLIC_ENDPOINTS:
            return None
        # Flask's automatic OPTIONS returns method metadata, never route data.
        # JWT verification intentionally skips OPTIONS, so don't ask it for an
        # identity afterward (that would turn a harmless preflight into a 500).
        if request.method == "OPTIONS":
            return None
        production = app.config["QFUND_PRODUCTION"]
        # Close unauthenticated arbitrary-PID termination in local mode too.
        if not production and request.endpoint not in _REMOTE_TERMINATE:
            return None
        verify_jwt_in_request()
        user = database.select_one("users", {"username": f"eq.{get_jwt_identity()}"})
        if not user:
            return jsonify({"detail": "invalid account"}), 401
        if production and request.endpoint in _PRODUCTION_DISABLED:
            return jsonify({"detail": "此执行入口在生产模式禁用"}), 403
        return None

    @app.after_request
    def private_api_headers(response):
        if app.config["QFUND_PRODUCTION"] and request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response
