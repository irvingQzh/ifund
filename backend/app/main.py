"""Flask 应用工厂：注册蓝图、JWT、SQLite 建表、SPA fallback。"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_jwt_extended import JWTManager

from app.security import install_api_guards, security_config


def create_app() -> Flask:
    """创建并配置 Flask 应用。"""
    # pylint: disable=import-outside-toplevel
    load_dotenv()
    backend_dir = Path(__file__).resolve().parents[1]
    static_dir = backend_dir / "static"

    application = Flask(__name__, static_folder=str(static_dir), static_url_path="")
    # Fail before touching the DB if a production security setting is unsafe.
    application.config.update(security_config())
    if application.config["QFUND_PRODUCTION"]:
        application.config["DEBUG"] = False
    JWTManager(application)
    install_api_guards(application)

    # SQLite 后端：启动时自动建表（幂等）
    from app import db as database
    if os.getenv("DB_BACKEND", "sqlite").lower() == "sqlite":
        schema_sql = (backend_dir / "schema_sqlite.sql").read_text(encoding="utf-8")
        database.init_db(schema_sql)
        # 增量迁移：portfolios 表加 cap 列（已存在则跳过）
        try:
            database.init_db("ALTER TABLE portfolios ADD COLUMN cap REAL DEFAULT 0.18;")
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc).lower():
                raise

    # 注册蓝图
    from app.routers.auth import bp as auth_bp
    from app.fund.api.router import bp as fund_bp
    from app.fund_detail.api.router import bp as fund_detail_bp
    from app.fund_holdings.api.router import bp as holdings_bp
    from app.fund_nav.api.router import bp as nav_bp
    from app.trade_calendar.api.router import bp as calendar_bp
    from app.stock_industry.api.router import bp as industry_bp
    from app.cluster.api.router import bp as cluster_bp
    from app.position.api.router import bp as position_bp
    from app.reconcile.api.router import bp as reconcile_bp
    from app.ai_analyze.router import bp as ai_analyze_bp
    for blueprint in (auth_bp, fund_bp, fund_detail_bp, holdings_bp, nav_bp,
                      calendar_bp, industry_bp, cluster_bp, position_bp, reconcile_bp,
                      ai_analyze_bp):
        application.register_blueprint(blueprint)

    @application.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @application.errorhandler(404)
    def spa_fallback(_err):
        if request.path.startswith("/api"):
            return jsonify({"detail": "not found"}), 404
        index = static_dir / "index.html"
        if index.exists():
            return send_from_directory(str(static_dir), "index.html")
        return jsonify({"detail": "frontend not built"}), 404

    return application


app = create_app()
