"""基金披露抓取的离线回归测试；仅使用内存 SQLite，不访问用户数据库或网络。"""
from __future__ import annotations

import argparse
import datetime
import io
import json
import sqlite3
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import pandas as pd

from app.common import worker_base
from app.db.sqlite import SqliteDatabase
from app.fund_holdings.crud import holdings_crud
from app.fund_holdings.fetch import worker
from cli import fetch

_SCHEMA = """
CREATE TABLE fund_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_code TEXT NOT NULL,
    quarter TEXT NOT NULL,
    holding_type TEXT NOT NULL,
    asset_code TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    hold_ratio REAL,
    hold_amount REAL,
    hold_market_value REAL,
    raw_data TEXT,
    fetch_time TEXT,
    UNIQUE(fund_code, quarter, holding_type, asset_code)
);
"""
_PARTITIONS = ("fund_code", "quarter", "holding_type")


def _holding(quarter="2025Q4", asset="600001", holding_type="stock", code="019018"):
    """生成合法入库记录。"""
    return {"fund_code": code, "quarter": quarter, "holding_type": holding_type,
            "asset_code": asset, "asset_name": "测试证券", "hold_ratio": 3.2,
            "hold_amount": 100.0, "hold_market_value": 500.0, "raw_data": "{}",
            "fetch_time": "2026-10-02T20:00:00"}


def _stock_frame(year):
    """生成与数据源同字段的合法股票披露。"""
    return pd.DataFrame([{"季度": f"{year}年4季度股票投资明细", "股票代码": "600001",
                          "股票名称": "测试证券", "占净值比例": 3.2, "持股数": 100,
                          "持仓市值": 500}])


class HoldingsStorageTests(unittest.TestCase):
    """验证分区替换的边界、历史保留和事务回滚。"""

    def setUp(self):
        self.db = SqliteDatabase(":memory:")
        self.db.init_db(_SCHEMA)
        self.addCleanup(self.db._conn().close)  # pylint: disable=protected-access
        self.db_patch = patch("app.db.get_db", return_value=self.db)
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)

    def test_preserves_unreturned_quarters_types_and_funds(self):
        """只更新返回的股票季度，债券、历史季度和其它基金原样保留。"""
        old = [_holding("2024Q4"), _holding("2025Q4"), _holding("2025Q4", "110001", "bond"),
               _holding("2025Q4", code="014805")]
        self.db.batch_insert("fund_holdings", old)
        holdings_crud.upsert("019018", [_holding("2025Q4", "600002"), _holding("2026Q2", "600003")])
        rows = self.db.select("fund_holdings")
        keys = {(row["fund_code"], row["quarter"], row["holding_type"], row["asset_code"]) for row in rows}
        self.assertEqual(keys, {
            ("019018", "2024Q4", "stock", "600001"), ("019018", "2025Q4", "stock", "600002"),
            ("019018", "2025Q4", "bond", "110001"), ("019018", "2026Q2", "stock", "600003"),
            ("014805", "2025Q4", "stock", "600001"),
        })

    def test_empty_upsert_never_deletes(self):
        """全空响应明确失败，原记录保留。"""
        self.db.batch_insert("fund_holdings", [_holding()])
        before = self.db.select("fund_holdings")
        with self.assertRaisesRegex(ValueError, "响应为空"):
            holdings_crud.upsert("019018", [])
        self.db.replace_partitions("fund_holdings", [], _PARTITIONS)
        self.assertEqual(self.db.select("fund_holdings"), before)

    def test_insert_failure_rolls_back_all_partition_deletes(self):
        """第二条插入违反唯一约束时，所有分区删除和第一条插入一起回滚。"""
        self.db.batch_insert("fund_holdings", [_holding("2025Q4"), _holding("2026Q2")])
        before = self.db.select("fund_holdings")
        incoming = [_holding("2025Q4", "600002"), _holding("2025Q4", "600002"), _holding("2026Q2", "600003")]
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.replace_partitions("fund_holdings", incoming, _PARTITIONS)
        self.assertEqual(self.db.select("fund_holdings"), before)
        self.assertFalse(self.db._conn().in_transaction)  # pylint: disable=protected-access

    def test_invalid_fund_or_record_fails_before_writing(self):
        """基金不一致、缺失标识或坏占比都不能进入事务。"""
        invalid = [{"fund_code": "014805"}, {"quarter": ""}, {"holding_type": "unknown"},
                   {"asset_code": ""}, {"asset_name": "nan"}, {"hold_ratio": None},
                   {"hold_ratio": float("inf")}, {"hold_ratio": -1}]
        with patch("app.db.replace_partitions") as replace:
            for change in invalid:
                with self.subTest(change=change), self.assertRaises(ValueError):
                    holdings_crud.upsert("019018", [{**_holding(), **change}])
            replace.assert_not_called()

    def test_duplicate_asset_rejected_before_writing(self):
        """业务层拒绝重复键，避免无意覆盖。"""
        with patch("app.db.replace_partitions") as replace:
            with self.assertRaisesRegex(ValueError, "重复"):
                holdings_crud.upsert("019018", [_holding(), _holding()])
            replace.assert_not_called()

    def test_mismatched_columns_rejected_before_delete(self):
        """不同字段集合不能悄悄填空；旧记录不能受影响。"""
        self.db.batch_insert("fund_holdings", [_holding()])
        before = self.db.select("fund_holdings")
        incomplete = _holding("2026Q2")
        del incomplete["asset_name"]
        with self.assertRaisesRegex(ValueError, "相同字段"):
            self.db.replace_partitions("fund_holdings", [_holding(), incomplete], _PARTITIONS)
        self.assertEqual(self.db.select("fund_holdings"), before)

    def test_invalid_partition_spec_rejected(self):
        """空、重复、缺失或不安全分区列均拒绝执行。"""
        for columns in ((), ("quarter", "quarter"), ("missing",), ("quarter;DELETE",)):
            with self.subTest(columns=columns), self.assertRaises(ValueError):
                self.db.replace_partitions("fund_holdings", [_holding()], columns)


class HoldingsWorkerTests(unittest.TestCase):
    """用 mock 验证请求错误不会写入，也不会计入成功。"""

    def setUp(self):
        self.year = datetime.date.today().year
        fresh = patch.object(holdings_crud, "is_fresh", return_value=False)
        fresh.start()
        self.addCleanup(fresh.stop)
        writer = patch.object(holdings_crud, "upsert")
        self.writer = writer.start()
        self.addCleanup(writer.stop)

    def test_request_error_propagates_with_context(self):
        """网络异常包含基金、年份和类别，不再吞为成功。"""
        with patch.object(worker.provider, "fund_portfolio_hold_em", side_effect=TimeoutError("timeout")):
            with self.assertRaisesRegex(RuntimeError, f"019018 {self.year - 1} stock.*timeout"):
                worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_partial_year_failure_writes_nothing(self):
        """上一年成功、当年失败时，本基金整批不写。"""
        with patch.object(worker.provider, "fund_portfolio_hold_em",
                          side_effect=[_stock_frame(self.year - 1), TimeoutError("timeout")]), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", return_value=pd.DataFrame()):
            with self.assertRaisesRegex(RuntimeError, f"{self.year} stock"):
                worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_bond_parse_failure_does_not_become_empty_success(self):
        """债券解析 KeyError 也是真实错误，不能当作无债券。"""
        with patch.object(worker.provider, "fund_portfolio_hold_em", return_value=_stock_frame(self.year - 1)), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", side_effect=KeyError("占净值比例")):
            with self.assertRaisesRegex(RuntimeError, "bond"):
                worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_all_empty_is_failure(self):
        """无任何有效披露不能标为同步成功。"""
        with patch.object(worker.provider, "fund_portfolio_hold_em", return_value=pd.DataFrame()), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", return_value=pd.DataFrame()):
            with self.assertRaisesRegex(ValueError, "未返回任何持仓披露"):
                worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_legitimate_empty_type_or_year_preserves_missing_groups(self):
        """明确无数据的债券/年份不阻断成功；只交付存在的股票季度。"""
        with patch.object(worker.provider, "fund_portfolio_hold_em",
                          side_effect=[pd.DataFrame(), _stock_frame(self.year)]), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", return_value=pd.DataFrame()):
            self.assertEqual(worker._process_one("019018"), "success")  # pylint: disable=protected-access
        self.writer.assert_called_once()
        code, rows = self.writer.call_args.args
        self.assertEqual(code, "019018")
        self.assertEqual([(row["quarter"], row["holding_type"]) for row in rows], [(f"{self.year}Q4", "stock")])

    def test_bad_schema_and_wrong_year_are_failures(self):
        """列缺失或报告年份错误必须阻止写入。"""
        frames = [pd.DataFrame([{"季度": "2025Q1"}]), _stock_frame(self.year - 2)]
        for frame in frames:
            with self.subTest(columns=list(frame.columns)), \
                    patch.object(worker.provider, "fund_portfolio_hold_em", return_value=frame):
                with self.assertRaises(RuntimeError):
                    worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_conflicting_duplicate_prevents_writing(self):
        """相同证券、季度但占比冲突的披露不能被最后一行静默覆盖。"""
        frame = pd.concat([_stock_frame(self.year - 1)] * 2, ignore_index=True)
        frame.loc[1, "占净值比例"] = 4.5
        with patch.object(worker.provider, "fund_portfolio_hold_em", side_effect=[frame, pd.DataFrame()]), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", return_value=pd.DataFrame()):
            with self.assertRaisesRegex(ValueError, f"019018 {self.year - 1}Q4 600001.*冲突"):
                worker._process_one("019018")  # pylint: disable=protected-access
        self.writer.assert_not_called()

    def test_identical_duplicate_is_safely_deduplicated(self):
        """完全相同的重复行仅写入一次，保持原有去重兼容性。"""
        frame = pd.concat([_stock_frame(self.year - 1)] * 2, ignore_index=True)
        with patch.object(worker.provider, "fund_portfolio_hold_em", side_effect=[frame, pd.DataFrame()]), \
                patch.object(worker.provider, "fund_portfolio_bond_hold_em", return_value=pd.DataFrame()):
            self.assertEqual(worker._process_one("019018"), "success")  # pylint: disable=protected-access
        self.writer.assert_called_once()
        code, rows = self.writer.call_args.args
        self.assertEqual(code, "019018")
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["asset_code"], rows[0]["hold_ratio"]), ("600001", 3.2))

    def test_cached_fund_does_not_fetch_or_write(self):
        """兼容原有新鲜数据跳过行为。"""
        with patch.object(holdings_crud, "is_fresh", return_value=True), \
                patch.object(worker.provider, "fund_portfolio_hold_em") as provider:
            self.assertEqual(worker._process_one("019018"), "skip")  # pylint: disable=protected-access
            provider.assert_not_called()
        self.writer.assert_not_called()

    def test_cli_and_background_worker_report_failure(self):
        """CLI 保留异常文字，后台任务失败计数收到 fail。"""
        args = argparse.Namespace(codes="019018", types="", json=True)
        output = io.StringIO()
        with patch.object(worker.provider, "fund_portfolio_hold_em", side_effect=TimeoutError("timeout")), \
                redirect_stdout(output):
            with self.assertRaises(SystemExit) as exited:
                fetch._run_per_fund(args, worker._process_one)  # pylint: disable=protected-access
            status = worker_base._safe_process(worker._process_one, "019018")  # pylint: disable=protected-access
        self.assertEqual(exited.exception.code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual((result["success"], result["fail"], status), (0, 1, "fail"))
        self.assertIn("timeout", result["fails"][0])
        self.writer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
