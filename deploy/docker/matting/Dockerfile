FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
# 国内构建环境（CVM 直连 pypi.org 仅 ~10KB/s）：默认走清华镜像，可用 --build-arg 覆盖
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
RUN pip install --no-cache-dir -r requirements.txt
# 预置模型到镜像层，避免运行时下载抖动（约 170MB）。
# 注意：compose 把 matting-models 卷挂到 /root/.u2net，空卷会遮蔽本层——
# 首启前应先把模型种进卷（见 deploy 备忘），或依赖 rembg 运行时下载。
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
