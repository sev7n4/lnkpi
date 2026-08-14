from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    skills_dir: str = "skills"
    nest_base_url: str = "http://127.0.0.1:3000/api"
    nest_service_token: str = "dev-token"
    # Nest → Runtime auth for POST /v1/runs; empty falls back to nest_service_token
    runtime_auth_token: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_chat_model: str = "gpt-4o"
    image_gen_concurrency: int = 3
    image_gen_timeout_sec: int = 180
    # Video upstream (Agnes) can poll up to ~600s; Nest wait must outlive server poll.
    video_gen_timeout_sec: int = 660
    # W21: per-tool HTTP timeouts (seconds)
    canvas_tool_timeout_sec: float = 10.0
    thread_lock_timeout_sec: float = 5.0
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_cooldown_sec: float = 60.0
    # Checkpoint persistence (G1 decision)
    checkpoint_path: str = "data/checkpoints.db"
    # W17: History window for conversation context pruning
    history_window: int = 20  # Keep last N messages; anchors preserved separately
    history_token_budget: int = 8000  # Approx token cap for loaded history (0 = disabled)
    # W23: OTLP tracing via Collector → Tempo. Empty = disabled.
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "lnkpi-agent-runtime"
    otel_simple_processor: bool = False  # True for tests / low-volume dev
    # LangSmith OTel: auto-instruments LangGraph/LLM (gen_ai.* spans). Production: OTEL_ONLY + Collector.
    langsmith_otel_enabled: bool = True
    langsmith_api_key: str = ""  # Optional — dev/staging LangSmith Cloud
    langsmith_project: str = "lnkpi-agent"
    # W19: JSON map skill_id -> pinned prompt version for rollback, e.g.
    # {"enterprise-marketing-campaign":"1.0.0"}
    prompt_version_overrides: str = "{}"
    # Phase C: LLM structured intent parse (default off until C4)
    intent_llm_parse: bool = Field(default=False, validation_alias="INTENT_LLM_PARSE")
    intent_llm_parse_shadow: bool = Field(default=False, validation_alias="INTENT_LLM_PARSE_SHADOW")
    agent_thinking_ui: bool = Field(default=False, validation_alias="AGENT_THINKING_UI")
    # Product visual scheme v2: prose SSOT + macro/shot decomposition (spec 2026-08-11)
    # Env: LNKPI_PRODUCT_VISUAL_SCHEME_V2 (no validation_alias — prefix applies correctly)
    product_visual_scheme_v2: bool = False
    # UX-PV-10: merge await_shot_confirm + await_topo into one gate
    pv_merged_shot_topo_gate: bool = False
    # UX-PV-10 optional: secondary「少确认，直接出图」on merged gate when eligible
    pv_fast_mode_gate: bool = False

    class Config:
        env_prefix = "LNKPI_"
        # Also map AGENT-less aliases in README; nest token: NEST_SERVICE_TOKEN via model_config env

    @property
    def effective_runtime_auth_token(self) -> str:
        return (self.runtime_auth_token or self.nest_service_token).strip()


settings = Settings()
