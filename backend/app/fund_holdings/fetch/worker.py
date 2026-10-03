#!/usr/bin/env python3
"""fund_holdings worker：完整抓取成功后，原子更新实际返回的持仓报告期。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND_DIR = os.getenv("IFUND_BACKEND_DIR") or str(Path(__file__).resolve().parents[3])
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
os.chdir(_BACKEND_DIR)

# pylint: disable=wrong-import-position
import datetime
import re

from app.common import worker_base
from app.fund_holdings.crud import holdings_crud
from app.fund_holdings.fetch import provider

_QUARTER_RE = re.compile(r"(\d{4}).*?([1-4])\s*季度")


def _normalize_quarter(text: str) -> str:
    """「2024年1季度」→「2024Q1」。"""
    match = _QUARTER_RE.search(text or "")
    return f"{match.group(1)}Q{match.group(2)}" if match else (text or "").strip()


def _stock_rows(code, year, now):
    frame = provider.fund_portfolio_hold_em(symbol=code, date=str(year))
    return _rows_from_frame(code, year, now, "stock", frame)


def _bond_rows(code, year, now):
    frame = provider.fund_portfolio_bond_hold_em(symbol=code, date=str(year))
    return _rows_from_frame(code, year, now, "bond", frame)


def _rows_from_frame(code, year, now, holding_type, frame):
    """允许来源明确返回空表，但非空表缺列或错误报告期必须失败。"""
    if frame.empty:
        return []
    prefix = "股票" if holding_type == "stock" else "债券"
    required = {"季度", f"{prefix}代码", f"{prefix}名称", "占净值比例", "持仓市值"}
    if not required.issubset(frame.columns):
        raise ValueError(f"持仓响应缺少字段：{', '.join(sorted(required - set(frame.columns)))}")
    rows = []
    for _, row in frame.iterrows():
        quarter = _normalize_quarter(str(row["季度"]))
        if not re.fullmatch(rf"{year}Q[1-4]", quarter):
            raise ValueError(f"持仓响应报告期不属于请求年份 {year}: {quarter}")
        rows.append({
            "fund_code": code,
            "quarter": quarter,
            "holding_type": holding_type,
            "asset_code": str(row[f"{prefix}代码"]).strip(),
            "asset_name": str(row[f"{prefix}名称"]).strip(),
            "hold_ratio": worker_base.safe_float(row.get("占净值比例")),
            "hold_amount": worker_base.safe_float(row.get("持股数")) if holding_type == "stock" else None,
            "hold_market_value": worker_base.safe_float(row.get("持仓市值")),
            "raw_data": "{}",
            "fetch_time": now,
        })
    return rows


def _dedup(rows):
    """仅合并完全一致的重复行；同一披露键的冲突不能静默覆盖。"""
    seen = {}
    for row in rows:
        key = (row["fund_code"], row["quarter"], row["holding_type"], row["asset_code"])
        if key in seen and seen[key] != row:
            raise ValueError(f"{row['fund_code']} {row['quarter']} {row['asset_code']} 持仓披露存在冲突")
        seen[key] = row
    return list(seen.values())


def _process_one(code):
    if holdings_crud.is_fresh(code):
        return "skip"
    now = datetime.datetime.now().isoformat()
    year = datetime.date.today().year
    rows = []
    for target_year in (year - 1, year):
        for holding_type, fetch_rows in (("stock", _stock_rows), ("bond", _bond_rows)):
            try:
                rows += fetch_rows(code, target_year, now)
            except Exception as exc:  # pylint: disable=broad-exception-caught
                raise RuntimeError(f"{code} {target_year} {holding_type} 持仓抓取失败：{exc}") from exc
    if not rows:
        raise ValueError(f"{code} 未返回任何持仓披露，未更新已有数据")
    holdings_crud.upsert(code, _dedup(rows))
    return "success"


if __name__ == "__main__":
    worker_base.main(_process_one)
