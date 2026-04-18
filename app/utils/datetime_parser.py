from __future__ import annotations

from datetime import datetime, time, timedelta


TIME_BUCKETS: dict[str, time] = {
    "morning": time(hour=9, minute=0),
    "afternoon": time(hour=13, minute=0),
    "evening": time(hour=16, minute=0),
}

WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def parse_natural_date(raw_date: str, now: datetime | None = None) -> datetime.date | None:
    now = now or datetime.now()
    lowered = raw_date.strip().lower()

    if lowered == "today":
        return now.date()
    if lowered == "tomorrow":
        return (now + timedelta(days=1)).date()
    if lowered.startswith("next "):
        weekday = WEEKDAYS.get(lowered.replace("next ", "").strip())
        if weekday is not None:
            delta = (weekday - now.weekday() + 7) % 7
            delta = 7 if delta == 0 else delta
            return (now + timedelta(days=delta)).date()

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw_date, fmt).date()
        except ValueError:
            continue
    return None


def map_time_preference(raw_time: str) -> time | None:
    lowered = raw_time.strip().lower()
    if lowered in TIME_BUCKETS:
        return TIME_BUCKETS[lowered]
    for fmt in ("%H:%M", "%I:%M %p", "%I %p"):
        try:
            return datetime.strptime(raw_time, fmt).time().replace(second=0, microsecond=0)
        except ValueError:
            continue
    return None


def is_within_working_hours(candidate: datetime) -> bool:
    return (
        candidate.weekday() < 5
        and (candidate.hour > 9 or (candidate.hour == 9 and candidate.minute >= 0))
        and (candidate.hour < 17)
    )
