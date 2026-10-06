from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .settings import settings

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_token(user_id: int, username: str, role: str) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    ttl = timedelta(minutes=settings.jwt_ttl_minutes)
    token = jwt.encode(
        {"sub": str(user_id), "username": username, "role": role, "iat": now, "exp": now + ttl},
        settings.jwt_secret,
        algorithm=settings.jwt_alg,
    )
    return token, int(ttl.total_seconds())


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError if invalid or expired."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
