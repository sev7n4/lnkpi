# Debug Session: workflow-interrupt-bug

## Bug Description
**症状**: 用户选择"确认方案/换方向/自己说明修改"后，工作流程截断，无法继续进入图片生成阶段
**复现步骤**:
1. 创建新会话
2. 输入营销需求（如"咖啡品牌营销方案"）
3. AI返回方案，展示"确认方案/换方向/自己说明修改"按钮
4. 点击任意按钮 → 工作流截断，无后续响应

## Hypotheses
1. **interrupt_before机制未正确恢复** - checkpoint中next节点错误，用户决策未写入state
2. **前端未发送user_decision** - POST /v1/runs请求缺少user_decision字段
3. **route_entry路由逻辑缺陷** - 无法识别用户确认意图，路由到错误节点
4. **split节点执行失败** - split_manifest未生成或为空
5. **W5重构后路径死循环** - phase状态转换陷入循环或锁死

## Instrumentation Plan
- [ ] runs.py: 记录POST /v1/runs请求体（user_input, thread_id, user_decision）
- [ ] runs.py: 记录route_entry返回的next节点和当前phase
- [ ] builder.py: 记录interrupt恢复时的状态
- [ ] split.py: 记录split_manifest生成结果

## Evidence Collection
Status: [OPEN]
Session ID: workflow-interrupt-bug
Created: 2026-07-28