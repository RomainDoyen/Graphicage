"""Calcul de distances entre coordonnées géographiques."""

import math
from typing import Sequence


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Distance à vol d'oiseau en mètres entre deux points WGS84."""
    radius = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return int(radius * c)


def build_distance_matrix(points: Sequence[dict]) -> list[list[int]]:
    """Construit une matrice de distances à partir de points {lat, lng}."""
    size = len(points)
    matrix = [[0] * size for _ in range(size)]
    for i in range(size):
        for j in range(size):
            if i == j:
                continue
            matrix[i][j] = haversine_meters(
                points[i]['lat'],
                points[i]['lng'],
                points[j]['lat'],
                points[j]['lng'],
            )
    return matrix
