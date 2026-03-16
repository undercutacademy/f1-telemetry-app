from fastapi import APIRouter, HTTPException
from services import fastf1_service

router = APIRouter()


@router.get("/drivers/{year}/{event}/{session}")
def get_drivers(year: int, event: str, session: str):
    try:
        return fastf1_service.get_drivers(year, event, session)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/laps/{year}/{event}/{session}/{driver}")
def get_laps(year: int, event: str, session: str, driver: str):
    try:
        return fastf1_service.get_laps(year, event, session, driver)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
