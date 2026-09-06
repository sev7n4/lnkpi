# Task 4 Report: Clarify 回复别名（生成 / 解读侧栏）

## 实现

- 为生成侧栏补充「生成一张图」「直接生成」「生图」「只要图」别名。
- 为解读侧栏补充「解读侧栏图片」「解读侧栏」「看看图」「描述图片」「看图问答」别名。
- choice 1 在原始请求非空时始终原样继承为图片 prompt；仅在原始请求为空时回落为「生成一张图」，移除蓝牙耳机硬编码污染。

## TDD 证据

- RED：`python3 -m pytest tests/test_clarify_reply_media.py -v`，10 failed，失败原因分别为别名返回 `none` 及 choice 1 错误回落蓝牙耳机 prompt。
- GREEN：`python3 -m pytest tests/test_clarify_reply.py tests/test_clarify_reply_media.py tests/test_route_clarify_followup.py -v`，19 passed。
- IDE lint：修改文件无诊断。

## 关注点

- 测试环境仍输出既有 `pytest-asyncio` 配置和 Pydantic class-based config 弃用警告；与本任务修改无关。
