from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from sqlalchemy import ColumnElement, cast
from sqlalchemy.sql import func


def make_point(latitude: float, longitude: float):
    return ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)


def distance_meters(column: ColumnElement, latitude: float, longitude: float):
    """Great-circle distance in meters between a geometry column and a point.

    `location` columns are GEOMETRY(POINT, 4326), not GEOGRAPHY, so distance
    must go through an explicit ::geography cast (planar ST_Distance on a bare
    geometry would be in degrees, not meters) -- same cast the raw-SQL schema
    verification in the spec uses.
    """
    return func.ST_Distance(cast(column, Geography), cast(make_point(latitude, longitude), Geography))


def within_radius(column: ColumnElement, latitude: float, longitude: float, radius_meters: float):
    return ST_DWithin(
        cast(column, Geography), cast(make_point(latitude, longitude), Geography), radius_meters
    )
