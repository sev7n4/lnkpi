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

    class Config:
        env_prefix = "LNKPI_"
        # Also map AGENT-less aliases in README; nest token: NEST_SERVICE_TOKEN via model_config env

    @property
    def effective_runtime_auth_token(self) -> str:
        return (self.runtime_auth_token or self.nest_service_token).strip()


settings = Settings()
