from app.graph.plan_clean import strip_plan_preamble


def test_strip_from_first_heading():
    raw = "好的，我将根据您的需求输出一份方案 Markdown。\n\n# 卫生洁具方案\n\n正文"
    assert strip_plan_preamble(raw).startswith("# 卫生洁具方案")


def test_strip_chitchat_without_heading():
    raw = "好的，下面给出方案。\n定位：极简\n卖点：静音"
    out = strip_plan_preamble(raw)
    assert not out.startswith("好的")
    assert "定位" in out


def test_already_clean():
    raw = "# 方案\n\n内容"
    assert strip_plan_preamble(raw) == raw
