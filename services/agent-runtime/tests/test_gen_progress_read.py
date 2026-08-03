import json

import pytest

from app.graph.gen_progress_read import parse_gen_progress_record, stats_from_progress_lines


def test_stats_from_progress_lines():
    lines = [
        "· Banner：出图成功",
        "· 场景图：失败（timeout）",
        "· 主图：待确认平台兜底",
    ]
    assert stats_from_progress_lines(lines) == (1, 1, 1)


def test_parse_gen_progress_record():
    record = {
        "id": "gp-1",
        "lines": json.dumps(["· n1：出图成功"]),
        "summary": None,
    }
    lines, success_n, fail_n, fallback_n = parse_gen_progress_record(record)
    assert lines == ["· n1：出图成功"]
    assert (success_n, fail_n, fallback_n) == (1, 0, 0)
