from fastapi import FastAPI

app = FastAPI(title="lnkpi-agent-runtime")

@app.get("/health")
def health():
    return {"ok": True, "service": "agent-runtime"}
