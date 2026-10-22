from __future__ import annotations


class AppError(Exception):
    """Base application error."""


class ConfigurationError(AppError):
    """Raised when required configuration is missing."""


class UnsupportedFileTypeError(AppError):
    """Raised when an uploaded file type is unsupported."""


class NormalizationError(AppError):
    """Raised when normalization fails."""

