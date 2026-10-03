"""持仓 HTTPS 读取器离线回归测试；不访问网络或数据库。"""
from __future__ import annotations

import json
import unittest
from email.utils import formatdate
from unittest.mock import Mock, patch

import requests

from app.fund_holdings.fetch import provider


def response_html(kind="stock", code="000001", ratio="5.23%", year="2026"):
    """最小合法来源样本。"""
    prefix = "股票" if kind == "stock" else "债券"
    extra_head = "<th>持股数<br/>（万股）</th>" if kind == "stock" else ""
    extra_cell = "<td>12.34</td>" if kind == "stock" else ""
    content = (
        f"<h4 class='t'>基金 {year}年2季度投资明细</h4><table><thead><tr>"
        f"<th>序号</th><th>{prefix}代码</th><th>{prefix}名称</th>"
        f"<th>占净值<br/>比例</th>{extra_head}<th>持仓市值（万元人民币）</th>"
        f"</tr></thead><tbody><tr><td>1</td><td>{code}</td><td>测试资产</td>"
        f"<td>{ratio}</td>{extra_cell}<td>1,234.56</td></tr></tbody></table>"
    )
    return "var apidata=" + json.dumps({"content": content}, ensure_ascii=False) + ";"


class HoldingsParserTests(unittest.TestCase):
    """只有明确空数据可空返回，格式变化必须暴露。"""

    def test_stock_and_bond_columns(self):
        for kind in ("stock", "bond"):
            with self.subTest(kind=kind):
                frame = provider._parse_response(response_html(kind), kind, "2026")
                self.assertEqual(len(frame), 1)
                self.assertEqual(frame.iloc[0]["占净值比例"], 5.23)
                self.assertEqual(frame.iloc[0]["持仓市值"], 1234.56)
                self.assertEqual(frame.iloc[0]["季度"], "2026年2季度")
                self.assertEqual(frame.iloc[0]["股票代码" if kind == "stock" else "债券代码"], "000001")

    def test_overseas_symbol_preserved(self):
        frame = provider._parse_response(response_html(code="ASML"), "stock", "2026")
        self.assertEqual(frame.iloc[0]["股票代码"], "ASML")

    def test_mixed_tbody_and_direct_rows_are_all_preserved(self):
        extra_row = (
            "<tr><td>2</td><td>000002</td><td>第二资产</td><td>1.2%</td>"
            "<td>5</td><td>6</td></tr>"
        )
        sample = response_html().replace("</tbody></table>", "</tbody>" + extra_row + "</table>")
        frame = provider._parse_response(sample, "stock", "2026")
        self.assertEqual(frame["股票代码"].tolist(), ["000001", "000002"])

    def test_direct_rows_without_tbody_are_preserved(self):
        sample = response_html().replace("<tbody>", "").replace("</tbody>", "")
        frame = provider._parse_response(sample, "stock", "2026")
        self.assertEqual(frame["股票代码"].tolist(), ["000001"])

    def test_header_and_footer_data_cells_are_not_holdings(self):
        non_holding = "<tr><td>注释或合计</td></tr>"
        sample = response_html().replace("</thead>", non_holding + "</thead>")
        sample = sample.replace("</table>", "<tfoot>" + non_holding + "</tfoot></table>")
        frame = provider._parse_response(sample, "stock", "2026")
        self.assertEqual(frame["股票代码"].tolist(), ["000001"])

    def test_nested_table_is_rejected(self):
        sample = response_html().replace("测试资产", "测试资产<table><tr><td>非持仓</td></tr></table>")
        with self.assertRaises(provider.HoldingsProviderError):
            provider._parse_response(sample, "stock", "2026")

    def test_explicit_empty_returns_standard_columns(self):
        for content in ("", " ", "<p>暂无数据</p>", "暂无持仓数据。"):
            for kind in ("stock", "bond"):
                with self.subTest(content=content, kind=kind):
                    frame = provider._parse_response(json.dumps({"content": content}), kind, "2026")
                    self.assertTrue(frame.empty)
                    self.assertIn("季度", frame.columns)
                    self.assertIn("占净值比例", frame.columns)

    def test_invalid_response_fails_closed(self):
        samples = (
            "<html>请登录</html>", "var apidata={", "{}", '{"content":null}',
            json.dumps({"content": "请完成安全验证"}),
            json.dumps({"content": "<p>登录后暂无数据</p>"}),
            response_html(year="2025"), response_html(ratio="oops"),
            response_html(ratio="NaN"), response_html(ratio="--"),
            response_html().replace("占净值", "缺失字段"),
            response_html().replace("<td>12.34</td>", ""),
        )
        for sample in samples:
            with self.subTest(sample=sample[:80]):
                with self.assertRaises(provider.HoldingsProviderError):
                    provider._parse_response(sample, "stock", "2026")


class HoldingsNetworkTests(unittest.TestCase):
    """模拟代理故障与限流；不猴子补丁全局 requests，也不改变环境。"""

    def setUp(self):
        self.client = provider._ArchivesClient()
        self.client._session = Mock()
        self.client._direct_session = Mock()
        self.sleep_patch = patch.object(provider.time, "sleep")
        self.sleep = self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    @staticmethod
    def response(status=200, retry_after=""):
        return Mock(status_code=status, text="ok", headers={"Retry-After": retry_after})

    def test_respects_environment_by_default(self):
        real = provider._ArchivesClient()
        self.assertTrue(real._session.trust_env)
        self.assertFalse(real._direct_session.trust_env)
        self.client._session.get.return_value = self.response()
        self.assertEqual(self.client.get("019018", "2026", "stock"), "ok")
        self.client._direct_session.get.assert_not_called()
        args, kwargs = self.client._session.get.call_args
        self.assertTrue(args[0].startswith("https://fundf10.eastmoney.com/"))
        # Cloud TLS handshakes need a bounded 20-second connect window.
        self.assertEqual(kwargs["timeout"], (20, 20))
        self.assertFalse(kwargs["allow_redirects"])
        self.assertNotIn("verify", kwargs)

    def test_ssl_failure_switches_to_reusable_direct_session(self):
        self.client._session.get.side_effect = requests.exceptions.SSLError("proxy TLS failure")
        self.client._direct_session.get.return_value = self.response()
        self.assertEqual(self.client.get("019018", "2026", "stock"), "ok")
        self.assertEqual(self.client.get("019018", "2025", "bond"), "ok")
        self.assertEqual(self.client._session.get.call_count, 1)
        self.assertEqual(self.client._direct_session.get.call_count, 2)

    def test_both_connections_failing_is_not_empty_success(self):
        self.client._session.get.side_effect = requests.exceptions.ProxyError("proxy")
        self.client._direct_session.get.side_effect = requests.exceptions.ConnectionError("direct")
        with self.assertRaises(provider.HoldingsProviderError):
            self.client.get("019018", "2026", "stock")
        self.assertFalse(self.client._use_direct)

    def test_rate_limit_retries_only_once(self):
        self.client._session.get.return_value = self.response(514)
        with self.assertRaises(provider.HoldingsProviderError):
            self.client.get("019018", "2026", "stock")
        self.assertEqual(self.client._session.get.call_count, 2)
        self.client._direct_session.get.assert_not_called()
        self.sleep.assert_any_call(3)

    def test_long_retry_after_stops_instead_of_retrying_early(self):
        self.client._session.get.return_value = self.response(429, "120")
        with self.assertRaises(provider.HoldingsProviderError):
            self.client.get("019018", "2026", "stock")
        self.assertEqual(self.client._session.get.call_count, 1)
        self.client._session.get.return_value.close.assert_called_once()

    def test_http_date_retry_after_is_respected(self):
        fixed_now = 1800000000
        limited = self.response(429, formatdate(fixed_now + 20, usegmt=True))
        success = self.response()
        self.client._session.get.side_effect = [limited, success]
        with patch.object(provider.time, "time", return_value=fixed_now):
            self.assertEqual(self.client.get("019018", "2026", "stock"), "ok")
        self.sleep.assert_any_call(20)
        limited.close.assert_called_once()
        success.close.assert_called_once()

    def test_long_http_date_retry_after_does_not_retry_early(self):
        fixed_now = 1800000000
        self.client._session.get.return_value = self.response(514, formatdate(fixed_now + 120, usegmt=True))
        with patch.object(provider.time, "time", return_value=fixed_now):
            with self.assertRaises(provider.HoldingsProviderError):
                self.client.get("019018", "2026", "stock")
        self.assertEqual(self.client._session.get.call_count, 1)
        self.client._session.get.return_value.close.assert_called_once()

    def test_retry_after_invalid_or_past_date_uses_minimum_delay(self):
        with patch.object(provider.time, "time", return_value=1800000000):
            self.assertEqual(provider._retry_delay("garbage"), 3)
            self.assertEqual(provider._retry_delay(formatdate(1700000000, usegmt=True)), 3)
            self.assertEqual(provider._retry_delay(" 10 "), 10)

    def test_redirect_does_not_downgrade_https(self):
        self.client._session.get.return_value = self.response(302)
        with self.assertRaises(provider.HoldingsProviderError):
            self.client.get("019018", "2026", "stock")
        self.client._direct_session.get.assert_not_called()
        self.client._session.get.return_value.close.assert_called_once()

    def test_read_timeout_is_reported(self):
        self.client._session.get.side_effect = requests.exceptions.ReadTimeout("timeout")
        with self.assertRaises(provider.HoldingsProviderError):
            self.client.get("019018", "2026", "stock")


if __name__ == "__main__":
    unittest.main()
