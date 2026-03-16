from fastapi import APIRouter, HTTPException
from services import fastf1_service

router = APIRouter()


@router.get("/years")
def get_years():
    return fastf1_service.get_years()


@router.get("/events/{year}")
def get_events(year: int):
    try:
        return fastf1_service.get_events(year)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{year}/{event}")
def get_sessions(year: int, event: str):
    try:
        return fastf1_service.get_sessions(year, event)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
