"""Offline deployment-security tests using only isolated in-memory databases."""
from __future__ import annotations

import importlib
import os
import secrets
import unittest
from unittest.mock import patch

import bcrypt
from flask_jwt_extended import create_access_token

from app.db.sqlite import SqliteDatabase
from app.security import security_config


class SecurityConfigTests(unittest.TestCase):
    """Unsafe production settings must fail before serving any requests."""

    def test_production_requires_random_hex_key(self):
        """Missing, common, short, repetitive, and non-hex keys are refused."""
        weak = [None, "dev-secret", "changeme", "password", "x" * 64,
                "a" * 64, "0123456789abcdef" * 4, "f0" * 32, "not-a-random-key" * 8]
        for secret in weak:
            environment = {"QFUND_PRODUCTION": "true"}
            if secret is not None:
                environment["SECRET_KEY"] = secret
            with self.subTest(secret=secret), self.assertRaises(RuntimeError):
                security_config(environment)

    def test_production_defaults_are_closed_and_tokens_expire(self):
        """Production registration defaults off; a generated key is accepted."""
        config = security_config({"QFUND_PRODUCTION": "true", "SECRET_KEY": secrets.token_hex(32)})
        self.assertFalse(config["ALLOW_REGISTRATION"])
        self.assertEqual(config["JWT_ACCESS_TOKEN_EXPIRES"].days, 1)

    def test_invalid_flags_and_expiration_fail_closed(self):
        """Typos, NaN, unbounded, and everlasting production JWT settings fail."""
        for overrides in ({"QFUND_PRODUCTION": "tru"}, {"ALLOW_REGISTRATION": ""},
                          *({"JWT_EXPIRES_DAYS": value} for value in ("0", "-1", "NaN", "inf", "31", "oops"))):
            environment = {"QFUND_PRODUCTION": "true", "SECRET_KEY": secrets.token_hex(32), **overrides}
            with self.subTest(overrides=overrides), self.assertRaises(RuntimeError):
                security_config(environment)

    def test_local_defaults_remain_compatible(self):
        """Without the production flag, local registration and 30-day JWT remain."""
        config = security_config({})
        self.assertFalse(config["QFUND_PRODUCTION"])
        self.assertTrue(config["ALLOW_REGISTRATION"])
        self.assertEqual(config["JWT_ACCESS_TOKEN_EXPIRES"].days, 30)
        self.assertIs(security_config({"JWT_EXPIRES_DAYS": "0"})["JWT_ACCESS_TOKEN_EXPIRES"], False)


class ProductionApiTests(unittest.TestCase):
    """Use the real app factory and routes, but never touch live env or data.db."""

    def setUp(self):
        self.db = SqliteDatabase(":memory:")
        self.addCleanup(self.db._conn().close)  # pylint: disable=protected-access
        for patcher in (patch("app.db.get_db", return_value=self.db),
                        patch("dotenv.load_dotenv", return_value=False),
                        patch.dict(os.environ, {"QFUND_PRODUCTION": "true",
                                               "SECRET_KEY": secrets.token_hex(32),
                                               "DB_BACKEND": "sqlite"}, clear=True)):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.main = importlib.import_module("app.main")
        # main may already be imported by another test; patch its bound loader too.
        loader = patch.object(self.main, "load_dotenv", return_value=False)
        loader.start()
        self.addCleanup(loader.stop)
        self.app = self.main.create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.db.insert("users", {"username": "owner", "hashed_password": bcrypt.hashpw(
            b"test-password", bcrypt.gensalt(rounds=4)).decode()})

    def headers(self):
        """Obtain a real token by password login."""
        response = self.client.post("/api/auth/login", json={"username": "owner", "password": "test-password"})
        self.assertEqual(response.status_code, 200)
        return {"Authorization": "Bearer " + response.get_json()["access_token"]}

    def test_registration_closed_before_validation_or_insert(self):
        """No implicit first-user bootstrap, even with valid registration data."""
        count = self.db.count("users")
        for body in ({"username": "outsider", "password": "some-password"}, [], {}):
            response = self.client.post("/api/auth/register", json=body)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.db.count("users"), count)

    def test_all_private_api_routes_require_token(self):
        """Enumerate routes so an omitted decorator cannot silently open an API."""
        public = {"health", "auth.login", "auth.register", "auth.exchange_token"}
        for rule in self.app.url_map.iter_rules():
            if not rule.rule.startswith("/api/") or rule.endpoint in public:
                continue
            path = rule.rule
            for argument in rule.arguments:
                converter = rule._converters[argument]  # pylint: disable=protected-access
                replacement = "1" if converter.__class__.__name__ == "IntegerConverter" else "019018"
                for placeholder in (f"<{argument}>", f"<int:{argument}>"):
                    path = path.replace(placeholder, replacement)
            method = sorted(rule.methods - {"HEAD", "OPTIONS"})[0]
            with self.subTest(endpoint=rule.endpoint, method=method):
                response = self.client.open(path, method=method, json={"pid": "12345"})
                self.assertEqual(response.status_code, 401)

    def test_login_and_owner_only_holdings_work(self):
        """Existing login works; a different user's portfolio stays inaccessible."""
        headers = self.headers()
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).get_json(), {"username": "owner"})
        other = self.db.insert("users", {"username": "other", "hashed_password": "unused"})
        portfolio = self.db.insert("portfolios", {"user_id": other["id"], "name": "private"})
        response = self.client.get(f"/api/reconcile/holdings?portfolio_id={portfolio['id']}", headers=headers)
        self.assertEqual(response.status_code, 404)
        own = self.client.get("/api/reconcile/portfolios", headers=headers)
        self.assertEqual(own.status_code, 200)
        self.assertNotIn("private", own.get_data(as_text=True))
        self.assertEqual(own.headers["Cache-Control"], "no-store")

    def test_web_ai_and_arbitrary_pid_termination_disabled(self):
        """Even an authenticated owner cannot execute these production routes."""
        headers = self.headers()
        for path in ("/api/fund/019018/ai-analyze", "/api/fund_detail/terminate",
                     "/api/fund_holdings/terminate", "/api/fund_nav/terminate", "/api/stock_industry/terminate"):
            with self.subTest(path=path):
                self.assertEqual(self.client.post(path, headers=headers, json={"pid": "12345"}).status_code, 403)

    def test_invalid_and_deleted_account_tokens_are_rejected(self):
        """A token for a removed account must not fall through to user id zero."""
        response = self.client.get("/api/fund/list", headers={"Authorization": "Bearer garbage"})
        self.assertIn(response.status_code, {401, 422})
        with self.app.app_context():
            token = create_access_token(identity="deleted-user")
        response = self.client.get("/api/fund/list", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 401)

    def test_bad_login_inputs_do_not_crash(self):
        """Oversized bcrypt passwords and non-object payloads are rejected."""
        for body in (["bad"], {"username": "owner", "password": "x" * 100},
                     {"username": "owner", "password": "wrong"}):
            self.assertEqual(self.client.post("/api/auth/login", json=body).status_code, 401)

    def test_options_contains_no_private_data(self):
        """Automatic method discovery must not execute the private route or 500."""
        response = self.client.open("/api/reconcile/holdings", method="OPTIONS")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_data(), b"")

    def test_local_mode_preserves_public_market_reads(self):
        """Only the formerly unauthenticated process-kill path changes locally."""
        with patch.dict(os.environ, {"QFUND_PRODUCTION": "false", "ALLOW_REGISTRATION": "true"}):
            app = self.main.create_app()
        client = app.test_client()
        self.assertEqual(client.get("/api/fund/types").status_code, 200)
        self.assertEqual(client.post("/api/fund_nav/terminate", json={"pid": "12345"}).status_code, 401)
        self.assertEqual(client.post("/api/auth/register", json={
            "username": "new-local", "password": "safe-local-password"}).status_code, 201)

    def test_weak_production_configuration_fails_before_database_init(self):
        """Starting with the development secret cannot mutate or serve the DB."""
        with patch.dict(os.environ, {"SECRET_KEY": "dev-secret"}), patch("app.db.init_db") as initialize:
            with self.assertRaises(RuntimeError):
                self.main.create_app()
        initialize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
