"""天天基金持仓 HTTPS 读取器；仅由独立抓取进程调用，不读写数据库。"""
from __future__ import annotations

import math
import random
import re
import time
from datetime import timezone
from email.utils import parsedate_to_datetime

import pandas as pd
import requests
from akshare.utils import demjson
from bs4 import BeautifulSoup

_URL = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx"
# Cloud egress TLS setup can exceed 5 seconds; keep both phases bounded.
_TIMEOUT = (20, 20)
_MIN_INTERVAL = 1.5
_RETRY_STATUSES = {429, 500, 502, 503, 504, 514}
_QUARTER_RE = re.compile(r"(\d{4})\s*年\s*([1-4])\s*季度")
_EMPTY_MESSAGES = {"暂无数据", "暂无持仓", "暂无持仓数据", "没有数据", "无持仓数据"}
_STOCK_COLUMNS = ["序号", "股票代码", "股票名称", "占净值比例", "持股数", "持仓市值", "季度"]
_BOND_COLUMNS = ["序号", "债券代码", "债券名称", "占净值比例", "持仓市值", "季度"]


class HoldingsProviderError(RuntimeError):
    """网络或响应结构错误；调用方必须保留原有披露数据。"""


def _retry_delay(value):
    """兼容 Retry-After 秒数或 HTTP-date，不提前重试长时间限流。"""
    value = value.strip()
    if value.isdigit():
        delay = int(value)
    else:
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            delay = math.ceil(retry_at.timestamp() - time.time())
        except (TypeError, ValueError, OverflowError):
            delay = 3
    if delay > 30:
        raise HoldingsProviderError("持仓接口限流，请稍后再试")
    return max(3, delay)


class _ArchivesClient:
    """进程内专用会话；代理链路失败后仅此 HTTPS 来源回退直连。"""

    def __init__(self):
        self._session = requests.Session()
        self._direct_session = requests.Session()
        self._direct_session.trust_env = False
        self._use_direct = False
        self._last_request = 0.0

    def _request(self, session, params, headers):
        for attempt in range(2):
            wait = _MIN_INTERVAL - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()
            response = session.get(
                _URL, params=params, headers=headers, timeout=_TIMEOUT,
                allow_redirects=False,
            )
            try:
                if response.status_code in _RETRY_STATUSES and attempt == 0:
                    # 尊重来源限流，不轮换身份；最多重试一次。
                    delay = _retry_delay(response.headers.get("Retry-After", ""))
                elif response.status_code != 200:
                    raise HoldingsProviderError(f"持仓接口返回 HTTP {response.status_code}")
                else:
                    return response.text
            finally:
                response.close()
            time.sleep(delay)
        raise HoldingsProviderError("持仓接口重试失败")  # pragma: no cover

    def get(self, symbol, date, holding_type):
        """有限超时、节流和 HTTPS 直连回退；不修改环境或全局 requests。"""
        if not re.fullmatch(r"\d{6}", symbol) or not re.fullmatch(r"\d{4}", date):
            raise ValueError("基金代码须为六位数字，年份须为四位数字")
        page = "ccmx" if holding_type == "stock" else "ccmx1"
        params = {
            "type": "jjcc" if holding_type == "stock" else "zqcc",
            "code": symbol, "year": date, "rt": f"{random.random():.16f}",
        }
        if holding_type == "stock":
            params.update(topline="10000", month="")
        headers = {
            "Accept": "*/*", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": f"https://fundf10.eastmoney.com/{page}_{symbol}.html",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
            "X-Requested-With": "XMLHttpRequest",
        }
        session = self._direct_session if self._use_direct else self._session
        try:
            return self._request(session, params, headers)
        except requests.exceptions.ConnectionError as exc:
            # 包括 SSLError / ProxyError / ConnectTimeout；TLS 校验始终保留。
            if self._use_direct:
                raise HoldingsProviderError("持仓接口 HTTPS 直连失败") from exc
            try:
                data = self._request(self._direct_session, params, headers)
            except requests.exceptions.RequestException as direct_exc:
                raise HoldingsProviderError("持仓接口代理和 HTTPS 直连均失败") from direct_exc
            self._use_direct = True
            return data
        except requests.exceptions.RequestException as exc:
            raise HoldingsProviderError("持仓接口请求失败或超时") from exc


def _canonical_header(value):
    name = re.sub(r"\s+", "", value).replace("(", "（").replace(")", "）")
    if name.startswith("持仓市值（万元"):
        return "持仓市值"
    if name == "持股数（万股）":
        return "持股数"
    return name


def _number(value, column):
    text = value.strip().replace(",", "").removesuffix("%")
    if text in {"", "--", "---", "-"}:
        return None
    try:
        result = float(text)
    except ValueError as exc:
        raise HoldingsProviderError(f"持仓接口 {column} 含无效数字") from exc
    if not math.isfinite(result) or result < 0:
        raise HoldingsProviderError(f"持仓接口 {column} 含非有限值或负数")
    return result


def _parse_table(table, columns, quarter):
    if table.find("table") is not None:
        raise HoldingsProviderError("持仓接口出现嵌套表格")
    headers = [_canonical_header(th.get_text("", strip=True)) for th in table.select("thead th")]
    required = columns[1:-1]
    if any(headers.count(column) != 1 for column in required):
        raise HoldingsProviderError("持仓接口表头缺失或重复")
    rows = []
    for tr in table.find_all("tr"):
        if tr.find_parent("table") is not table or tr.find_parent(["thead", "tfoot"]) is not None:
            continue
        data_cells = tr.find_all("td", recursive=False)
        if not data_cells:
            continue
        cells = [td.get_text("", strip=True) for td in data_cells]
        if len(cells) != len(headers):
            raise HoldingsProviderError("持仓接口行列数量不一致")
        source = dict(zip(headers, cells))
        code_column, name_column = columns[1:3]
        if not source[code_column] or not source[name_column]:
            raise HoldingsProviderError("持仓接口股票或债券标识为空")
        row = {column: source[column] for column in required}
        for column in ("占净值比例", "持股数", "持仓市值"):
            if column in row:
                row[column] = _number(row[column], column)
        if row["占净值比例"] is None:
            raise HoldingsProviderError("持仓接口缺少持仓比例")
        row["季度"] = quarter
        rows.append(row)
    if not rows:
        raise HoldingsProviderError("持仓接口表格为空但未明确标记无数据")
    return rows


def _parse_response(text, holding_type, year):
    columns = _STOCK_COLUMNS if holding_type == "stock" else _BOND_COLUMNS
    # 只接受数据对象，不将登录页、风控页或任意 HTML 当作空持仓。
    match = re.fullmatch(r"\s*(?:var\s+apidata\s*=\s*)?(\{.*\})\s*;?\s*", text, flags=re.S)
    if not match:
        raise HoldingsProviderError("持仓接口未返回预期的数据对象")
    try:
        payload = demjson.decode(match.group(1))
    except (ValueError, demjson.JSONDecodeError) as exc:
        raise HoldingsProviderError("持仓接口数据对象解析失败") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("content"), str):
        raise HoldingsProviderError("持仓接口缺少 content 字段")
    content = payload["content"]
    if not content.strip():
        return pd.DataFrame(columns=columns)
    soup = BeautifulSoup(content, "lxml")
    visible_text = soup.get_text("", strip=True).strip("。.!！")
    if not soup.find("table") and visible_text in _EMPTY_MESSAGES:
        return pd.DataFrame(columns=columns)
    tables = soup.find_all("table")
    headings = soup.select("h4.t")
    if not tables or len(tables) != len(headings):
        raise HoldingsProviderError("持仓接口缺少报告标题或表格")
    rows = []
    for table, heading in zip(tables, headings):
        quarter = _QUARTER_RE.search(heading.get_text("", strip=True))
        if not quarter or quarter.group(1) != year:
            raise HoldingsProviderError("持仓接口报告期缺失或不属于请求年份")
        label = f"{quarter.group(1)}年{quarter.group(2)}季度"
        rows.extend(_parse_table(table, columns, label))
    frame = pd.DataFrame(rows)
    frame["序号"] = range(1, len(frame) + 1)
    return frame[columns]


_CLIENT = _ArchivesClient()


def fund_portfolio_hold_em(symbol, date):
    """获取指定年度的披露股票持仓，返回与 AKShare worker 相容的列。"""
    return _parse_response(_CLIENT.get(symbol, str(date), "stock"), "stock", str(date))


def fund_portfolio_bond_hold_em(symbol, date):
    """获取指定年度的披露债券持仓，明确无数据时返回标准空表。"""
    return _parse_response(_CLIENT.get(symbol, str(date), "bond"), "bond", str(date))
