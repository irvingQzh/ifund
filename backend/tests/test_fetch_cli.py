"""CLI 拉取状态测试；不访问网络或真实数据库。"""
from __future__ import annotations

import contextlib
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from cli import fetch


class FetchCliTests(unittest.TestCase):
    """只有明确成功/缓存命中可返回零退出码。"""

    def run_fetch(self, results):
        """捕获 JSON 和退出码，基金集合由 mock 提供。"""
        args = SimpleNamespace(codes="000001,000002", types=None, json=True)
        stream = io.StringIO()
        exit_code = 0
        with patch("app.common.worker_base.resolve_codes", return_value=["000001", "000002"]):
            with contextlib.redirect_stdout(stream):
                try:
                    fetch._run_per_fund(args, Mock(side_effect=results))
                except SystemExit as exc:
                    exit_code = exc.code
        return exit_code, json.loads(stream.getvalue())

    def test_success_and_cached_skip(self):
        """缓存命中不是抓取失败。"""
        status, result = self.run_fetch(["success", "skip"])
        self.assertEqual(status, 0)
        self.assertEqual((result["success"], result["skip"], result["fail"]), (1, 1, 0))

    def test_exception_is_reported_and_exits_nonzero(self):
        """单只失败仍处理剩余基金，但最终不能向调度器误报成功。"""
        status, result = self.run_fetch([ValueError("无有效披露"), "success"])
        self.assertEqual(status, 1)
        self.assertEqual(result["success"], 1)
        self.assertEqual(result["fail"], 1)
        self.assertEqual(result["fails"], ["000001:无有效披露"])

    def test_explicit_failure_is_not_silent(self):
        """返回 fail 时也必须记录基金代码。"""
        status, result = self.run_fetch(["fail", "skip"])
        self.assertEqual(status, 1)
        self.assertIn("000001", result["fails"][0])

    def test_missing_status_is_not_assumed_success(self):
        """未返回状态不能算抓取成功。"""
        status, result = self.run_fetch([None, "success"])
        self.assertEqual(status, 1)
        self.assertEqual(result["fail"], 1)


if __name__ == "__main__":
    unittest.main()
