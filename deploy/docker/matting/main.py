from fastapi import FastAPI, Request, Response
from rembg import remove, new_session
from io import BytesIO
from PIL import Image

app = FastAPI()
# isnet-general-use：通用主体分割，首次调用下载到 ~/.u2net（volume 持久化）
session = new_session("isnet-general-use")

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/matting")
async def matting(req: Request):
    raw = await req.body()
    out = remove(Image.open(BytesIO(raw)), session=session)
    buf = BytesIO()
    out.save(buf, "PNG")
    return Response(content=buf.getvalue(), media_type="image/png")
