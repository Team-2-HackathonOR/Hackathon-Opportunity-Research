import os
import smtplib
from email.message import EmailMessage

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()

CALLER_HEADER = "x-gateway-caller"
SECRET_HEADER = "x-gateway-secret"
GATEWAY_CALLER = "team-2-gateway"


class SendBody(BaseModel):
    to: str = Field(min_length=3)
    subject: str = Field(min_length=1)
    text: str = Field(min_length=1)


def setting(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def smtp_host() -> str:
    return setting("SMTP_HOST")


def authorize(caller: str | None, secret: str | None) -> JSONResponse | None:
    expected = setting("GATEWAY_INTERNAL_SECRET")
    if not expected:
        return JSONResponse(
            status_code=503,
            content={"error": "Gateway secret is not configured.", "env": "GATEWAY_INTERNAL_SECRET"},
        )
    if caller != GATEWAY_CALLER or secret != expected:
        return JSONResponse(
            status_code=403,
            content={"error": "mail-service only accepts requests from the team-2 gateway."},
        )
    return None


@app.get("/health/live")
def live() -> dict[str, object]:
    return {"ok": True, "check": "liveness", "service": "mail-service"}


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "mail-service"}


@app.get("/health/ready", response_model=None)
def ready() -> JSONResponse | dict[str, object]:
    if not smtp_host():
        return JSONResponse(
            status_code=503,
            content={"ok": False, "check": "readiness", "service": "mail-service", "smtp": "unavailable"},
        )
    return {"ok": True, "check": "readiness", "service": "mail-service", "smtp": "ok"}


@app.post("/send", response_model=None)
def send(
    body: SendBody,
    x_gateway_caller: str | None = Header(default=None),
    x_gateway_secret: str | None = Header(default=None),
) -> JSONResponse | dict[str, object]:
    denied = authorize(x_gateway_caller, x_gateway_secret)
    if denied:
        return denied
    if not smtp_host():
        return JSONResponse(status_code=503, content={"error": "SMTP is not configured.", "env": "SMTP_HOST"})

    message = EmailMessage()
    message["From"] = setting("SMTP_FROM", "research@localhost")
    message["To"] = body.to
    message["Subject"] = body.subject
    message.set_content(body.text)
    deliver(message)
    return {"sent": True}


def deliver(message: EmailMessage) -> None:
    host = smtp_host()
    port = int(setting("SMTP_PORT", "587") or "587")
    username = setting("SMTP_USER")
    password = setting("SMTP_PASSWORD")
    use_tls = setting("SMTP_TLS", "true").lower() in {"1", "true", "yes"}
    with smtplib.SMTP(host, port, timeout=10) as client:
        if use_tls:
            client.starttls()
        if username:
            client.login(username, password)
        client.send_message(message)
