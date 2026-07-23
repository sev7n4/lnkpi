from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    skills_dir: str = "skills"
    nest_base_url: str = "http://127.0.0.1:3000/api"
    nest_service_token: str = "dev-token"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    image_gen_concurrency: int = 3
    image_gen_timeout_sec: int = 180

    class Config:
        env_prefix = "LNKPI_"
        # Also map AGENT-less aliases in README; nest token: NEST_SERVICE_TOKEN via model_config env

settings = Settings()
