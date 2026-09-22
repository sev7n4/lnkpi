FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# 预置模型到镜像层，避免运行时下载抖动（约 170MB）
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
