from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    pass


class EventFormat(StrEnum):
    IN_PERSON = "in_person"
    VIRTUAL = "virtual"
    HYBRID = "hybrid"
    UNKNOWN = "unknown"


class OperationalStatus(StrEnum):
    VERIFIED_APPLY_NOW = "verified_apply_now"
    VERIFIED_REGISTRATION_UPCOMING = "verified_registration_upcoming"
    MONITOR = "monitor"
    NEEDS_CONFIRMATION = "needs_confirmation"
    NOT_ELIGIBLE = "not_eligible"
    CLOSED_EXPIRED = "closed_expired"
    REJECTED_UNRELIABLE = "rejected_unreliable"


class EvidenceConfidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SupportStatus(StrEnum):
    PROVIDED = "provided"
    PARTIALLY_REIMBURSED = "partially_reimbursed"
    APPLICATION_BASED = "application_based"
    NOT_PROVIDED = "not_provided"
    NOT_CONFIRMED = "not_confirmed"


class SourceKind(StrEnum):
    OFFICIAL_SITE = "official_site"
    REGISTRATION_PAGE = "registration_page"
    RULES_FAQ = "rules_faq"
    ORGANIZER_PAGE = "organizer_page"
    OFFICIAL_SOCIAL = "official_social"
    DIRECTORY = "directory"
    EMAIL_RESPONSE = "email_response"
    PDF = "pdf"
    OTHER = "other"


class TrackKind(StrEnum):
    THEME = "theme"
    TRACK = "track"
    SPONSOR_CHALLENGE = "sponsor_challenge"
    REQUIRED_TECHNOLOGY = "required_technology"
    API_PLATFORM_REQUIREMENT = "api_platform_requirement"


class BenefitType(StrEnum):
    PRIZE = "prize"
    SPONSOR_PRIZE = "sponsor_prize"
    WORKSHOP = "workshop"
    MENTOR = "mentor"
    RECRUITER = "recruiter"
    NETWORKING = "networking"
    CERTIFICATE = "certificate"
    CREDIT = "credit"
    INCUBATOR = "incubator"
    HARDWARE = "hardware"
    PARTICIPANT_BENEFIT = "participant_benefit"
    CAREER_EXPOSURE = "career_exposure"
    OTHER = "other"


class MilestoneType(StrEnum):
    REGISTRATION_DEADLINE = "registration_deadline"
    TRAVEL_GRANT_DEADLINE = "travel_grant_deadline"
    ACCEPTANCE_DATE = "acceptance_date"
    CONFIRMATION_DEADLINE = "confirmation_deadline"
    PRE_EVENT_REQUIREMENT = "pre_event_requirement"
    REGISTRATION_OPEN = "registration_open"
    EVENT_START = "event_start"
    EVENT_END = "event_end"
    OTHER = "other"


class QueueType(StrEnum):
    APPLY_NOW = "apply_now"
    PREPARE_BEFORE_OPENING = "prepare_before_opening"


class ApplicationMaterialType(StrEnum):
    REGISTRATION_ACCOUNT = "registration_account"
    RESUME = "resume"
    PORTFOLIO_GITHUB = "portfolio_github"
    STUDENT_VERIFICATION = "student_verification"
    ESSAY_QUESTIONS = "essay_questions"
    TEAM_INFORMATION = "team_information"
    PROJECT_IDEA = "project_idea"
    REFERRAL_INVITE = "referral_invite"
    DEADLINE = "deadline"
    POST_ACCEPTANCE_STEP = "post_acceptance_step"
    OTHER = "other"


class ReadinessStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    READY = "ready"
    SUBMITTED = "submitted"
    NOT_APPLICABLE = "not_applicable"


class ResponseStatus(StrEnum):
    DRAFT = "draft"
    SENT = "sent"
    RESPONDED = "responded"
    CLOSED = "closed"
    NO_RESPONSE = "no_response"


class VerificationResult(StrEnum):
    CONFIRMED = "confirmed"
    PARTIALLY_CONFIRMED = "partially_confirmed"
    NEEDS_FOLLOW_UP = "needs_follow_up"
    CONFLICTING = "conflicting"


class ContributionType(StrEnum):
    DISCOVERY = "discovery"
    RESEARCH = "research"
    VERIFICATION = "verification"
    SHORTLIST = "shortlist"
    FOLLOW_UP = "follow_up"
    DEADLINE_TRACKING = "deadline_tracking"
    QA = "qa"
    OTHER = "other"

