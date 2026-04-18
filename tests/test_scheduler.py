from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.database import Base
from app.models.schemas import IntentSchema
from app.services.scheduler import book_appointment, check_availability, get_alternatives


def _test_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, future=True)
    return maker()


def test_scheduler_books_and_blocks_conflict():
    db = _test_db()
    intent = IntentSchema(
        patient_name="Alice Johnson",
        appointment_type="general consultation",
        doctor="dr-smith",
        date="2026-05-04",
        time_preference="10:00",
        urgency="medium",
    )
    response, start, _ = book_appointment(db, intent=intent, patient_email="alice@example.com")
    assert response.status == "booked"
    assert start is not None
    assert check_availability(db, "dr-smith", start) is False


def test_scheduler_suggests_three_alternatives():
    db = _test_db()
    base = datetime(2026, 5, 4, 10, 0)
    intent = IntentSchema(
        patient_name="Alice Johnson",
        appointment_type="general consultation",
        doctor="dr-smith",
        date="2026-05-04",
        time_preference="10:00",
        urgency="medium",
    )
    book_appointment(db, intent=intent, patient_email="alice@example.com")
    alternatives = get_alternatives(db, "dr-smith", base)
    assert len(alternatives) == 3
